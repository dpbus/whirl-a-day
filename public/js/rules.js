// The wheel and its spin rules, shared by the app (local wheels) and the server (online wheels).
//
// Plain functions over plain wheel objects: no DOM, no storage, no network. Both sides run the
// same code, so a spin is judged the same way whether the phone or the server decides it.
//
// A wheel:
//   { version, id, title, theme, options: [{ id, label, surprise }],
//     sharedWheel,            true: one wheel for everyone; false: each player has their own copy
//     removeAfterSpin,        a spun option comes off (the spinner's copy, or the shared wheel)
//     spinsPerDay?,           missing = unlimited
//     sharedDailyLimit?,      shared wheels: the whole group shares the day's spins
//     timeZone?,              decides when a day starts (missing = this device's zone)
//     showSpinsToEveryone?,   online individual wheels: players see each other's spins
//     players: [{ id, name, tokenHash?, claimed? }],
//     spins: [{ id, playerId, optionId, at }],      the log everything else is worked out from
//     bonusSpins: [{ playerId, at }] }              extra spins a grown-up granted
//
// `playerId` is null for a spin by nobody in particular (a shared wheel with no players).
// Times (`at`) are ISO 8601 strings in UTC.
import { THEMES, DEFAULT_THEME_ID } from './themes.js';
import { randomInt, uid } from './util.js';

export const WHEEL_VERSION = 1;
export const MAX_SPINS_PER_DAY = 10;
export const MAX_LABEL_LENGTH = 40;
export const MAX_SURPRISE_LENGTH = 200;
export const MAX_NAME_LENGTH = 24;
export const MAX_TITLE_LENGTH = 60;
export const MAX_OPTIONS = 200;
export const MAX_PLAYERS = 20;
export const MAX_SPINS = 3000; // per wheel; the oldest are dropped beyond this
const MAX_BONUS_SPINS = 500;
const MAX_ID_LENGTH = 64;

/** Why a spin or a change was refused. `code` is stable; `message` is for people. */
export class RuleError extends Error {
  constructor(code, message = RULE_MESSAGES[code] ?? 'That didn’t work.') {
    super(message);
    this.name = 'RuleError';
    this.code = code;
  }
}

export const RULE_MESSAGES = {
  empty: 'This wheel has no options yet.',
  done: 'Every option on this wheel has been spun.',
  locked: 'That’s all the spins for today.',
  'no-player': 'That player isn’t on this wheel.',
  'bad-request': 'That request didn’t make sense.',
  'unknown-action': 'The app and the server disagree. Reload the page to update the app.',
  'too-many-options': `A wheel can have up to ${MAX_OPTIONS} options.`,
  'too-many-players': `A wheel can have up to ${MAX_PLAYERS} players.`,
  'name-needed': 'Type a name first.',
  'name-taken': 'Someone already has that name. Pick another.',
  'join-closed': 'Joining is closed. Ask the host to open it.',
  'slow-down': 'Slow down a little and try again.',
};

// ================================================================ Days

const dayFormats = new Map();
const dayCache = new Map(); // `${zone}|${time}` -> day: renders ask about the same spins again and again
const DAY_CACHE_SIZE = 20_000;

/** The calendar day ('YYYY-MM-DD') of `at` in `timeZone` (default: this device's zone). */
export function dayKey(at = new Date(), timeZone) {
  const zone = timeZone || '';
  const cacheKey = typeof at === 'string' ? `${zone}|${at}` : null;
  if (cacheKey && dayCache.has(cacheKey)) return dayCache.get(cacheKey);
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  let format = dayFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormats.set(zone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (cacheKey) {
    if (dayCache.size >= DAY_CACHE_SIZE) dayCache.clear();
    dayCache.set(cacheKey, day);
  }
  return day;
}

export function isTimeZone(value) {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** This device's time zone, e.g. 'America/Chicago'. */
export function deviceTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isTimeZone(zone) ? zone : 'UTC';
}

// ================================================================ Reading a wheel

export const wheelTitle = (wheel) => wheel?.title?.trim() || 'Untitled wheel';
export const findPlayer = (wheel, playerId) => wheel.players.find((p) => p.id === playerId) ?? null;
export const findOption = (wheel, optionId) => wheel.options.find((o) => o.id === optionId) ?? null;

const samePlayer = (a, b) => (a ?? null) === (b ?? null);

/** The spins that shape this player's wheel: everyone's on a shared wheel, their own otherwise. */
export function spinsFor(wheel, playerId) {
  return wheel.sharedWheel ? wheel.spins : wheel.spins.filter((s) => samePlayer(s.playerId, playerId));
}

/** Options currently on the wheel for this player. */
export function spinPool(wheel, playerId) {
  if (!wheel.removeAfterSpin) return wheel.options;
  const spun = new Set(spinsFor(wheel, playerId).map((s) => s.optionId));
  return wheel.options.filter((o) => !spun.has(o.id));
}

/**
 * Options that have been spun and are now off the wheel, each with its latest spin.
 * Only options that still exist (one can be deleted after it was spun).
 */
export function openedOptions(wheel, playerId) {
  const opened = new Map();
  if (!wheel.removeAfterSpin) return opened;
  const exists = new Set(wheel.options.map((o) => o.id));
  for (const spin of spinsFor(wheel, playerId)) {
    if (exists.has(spin.optionId)) opened.set(spin.optionId, spin);
  }
  return opened;
}

/** Does the day's limit count the whole group's spins, rather than this player's? */
const limitIsWheelWide = (wheel) => wheel.sharedWheel && wheel.sharedDailyLimit === true;

function countToday(wheel, entries, playerId, now) {
  const today = dayKey(now, wheel.timeZone);
  const everyone = limitIsWheelWide(wheel);
  return entries.filter((e) => (everyone || samePlayer(e.playerId, playerId)) && dayKey(e.at, wheel.timeZone) === today).length;
}

export const spinsToday = (wheel, playerId, now = new Date()) => countToday(wheel, wheel.spins, playerId, now);

/** Extra spins a grown-up granted for today. */
export const bonusToday = (wheel, playerId, now = new Date()) => countToday(wheel, wheel.bonusSpins, playerId, now);

/** Spins left today, or Infinity when the wheel has no daily limit. */
export function spinsLeftToday(wheel, playerId, now = new Date()) {
  if (!wheel.spinsPerDay) return Infinity;
  return Math.max(0, wheel.spinsPerDay + bonusToday(wheel, playerId, now) - spinsToday(wheel, playerId, now));
}

/** { ok: true } or { ok: false, reason: 'empty' | 'done' | 'locked' | 'no-player' } */
export function spinStatus(wheel, playerId, now = new Date()) {
  if (playerId != null ? !findPlayer(wheel, playerId) : !wheel.sharedWheel) return { ok: false, reason: 'no-player' };
  if (!wheel.options.length) return { ok: false, reason: 'empty' };
  if (!spinPool(wheel, playerId).length) return { ok: false, reason: 'done' };
  if (spinsLeftToday(wheel, playerId, now) === 0) return { ok: false, reason: 'locked' };
  return { ok: true };
}

// ================================================================ Spinning

/**
 * Pick a result for this player and log it. Returns { spin, option, index } where `index` is
 * the option's position in the pool the wheel showed. A repeated `spinId` (a resend after a
 * reconnect) returns the spin already logged, with `repeated: true`, instead of spinning again.
 */
export function applySpin(wheel, playerId, { spinId, now = new Date(), pick = randomInt } = {}) {
  playerId = playerId ?? null;
  const existing = spinId ? wheel.spins.find((s) => s.id === spinId) : null;
  if (existing) return { spin: existing, option: findOption(wheel, existing.optionId), index: -1, repeated: true };

  const status = spinStatus(wheel, playerId, now);
  if (!status.ok) throw new RuleError(status.reason);
  const pool = spinPool(wheel, playerId);
  const index = pick(pool.length);
  const option = pool[index];
  const spin = { id: isId(spinId) ? spinId : uid(), playerId, optionId: option.id, at: now.toISOString() };
  wheel.spins.push(spin);
  if (wheel.spins.length > MAX_SPINS) wheel.spins.splice(0, wheel.spins.length - MAX_SPINS);
  return { spin, option, index };
}

// ================================================================ Changes (host / owner)
//
// Every change to a wheel is a named action with plain arguments, so the same change can be
// applied on this device, sent to the server, and applied there identically. New things (options,
// players) carry ids made by the caller, so both copies agree on them.

const ACTIONS = {
  /** Title, theme and rules. */
  'set-props'(wheel, args) {
    const patch = {};
    if ('title' in args) patch.title = text(args.title, MAX_TITLE_LENGTH);
    if ('theme' in args) {
      if (!isTheme(args.theme)) throw new RuleError('bad-request');
      patch.theme = args.theme;
    }
    if ('removeAfterSpin' in args) patch.removeAfterSpin = args.removeAfterSpin === true;
    if ('sharedWheel' in args) patch.sharedWheel = args.sharedWheel === true;
    Object.assign(wheel, patch);
    if ('spinsPerDay' in args) setOptional(wheel, 'spinsPerDay', clampInt(args.spinsPerDay, 0, MAX_SPINS_PER_DAY) || undefined);
    if ('sharedDailyLimit' in args) setOptional(wheel, 'sharedDailyLimit', args.sharedDailyLimit === true || undefined);
    if ('showSpinsToEveryone' in args) setOptional(wheel, 'showSpinsToEveryone', args.showSpinsToEveryone === true || undefined);
    if ('timeZone' in args) {
      if (args.timeZone != null && !isTimeZone(args.timeZone)) throw new RuleError('bad-request');
      setOptional(wheel, 'timeZone', args.timeZone ?? undefined);
    }
  },

  /** Add options (as many as fit). `options`: [{ id, label }]. Returns the ones added. */
  'add-options'(wheel, { options }) {
    if (!Array.isArray(options)) throw new RuleError('bad-request');
    if (options.length && !optionRoom(wheel)) throw new RuleError('too-many-options');
    const used = new Set(wheel.options.map((o) => o.id));
    const added = options
      .filter(isObject)
      .slice(0, optionRoom(wheel))
      .map((o) => ({ id: freshId(o.id, used), label: text(o.label, MAX_LABEL_LENGTH), surprise: text(o.surprise, MAX_SURPRISE_LENGTH) }));
    wheel.options.push(...added);
    return added;
  },

  'update-option'(wheel, { id, label, surprise }) {
    const option = findOption(wheel, id);
    if (!option) return;
    if (label !== undefined) option.label = text(label, MAX_LABEL_LENGTH);
    if (surprise !== undefined) option.surprise = text(surprise, MAX_SURPRISE_LENGTH);
  },

  /** Spins of a removed option stay in the history; they just no longer affect the wheel. */
  'remove-option'(wheel, { id }) {
    wheel.options = wheel.options.filter((o) => o.id !== id);
  },

  'add-player'(wheel, { id, name }) {
    if (wheel.players.length >= MAX_PLAYERS) throw new RuleError('too-many-players');
    const player = { id: freshId(id, new Set(wheel.players.map((p) => p.id))), name: text(name, MAX_NAME_LENGTH) };
    wheel.players.push(player);
    return player;
  },

  'rename-player'(wheel, { id, name }) {
    const player = findPlayer(wheel, id);
    if (player) player.name = text(name, MAX_NAME_LENGTH);
  },

  /**
   * Removes the player. On their own copy of the wheel, their spins go with them. On a shared
   * wheel their spins stay (what they spun stays off the wheel and in the history), just no
   * longer under their name.
   */
  'remove-player'(wheel, { id }) {
    wheel.players = wheel.players.filter((p) => p.id !== id);
    if (wheel.sharedWheel) {
      for (const spin of wheel.spins) if (spin.playerId === id) spin.playerId = null;
    } else wheel.spins = wheel.spins.filter((s) => s.playerId !== id);
    wheel.bonusSpins = wheel.bonusSpins.filter((b) => b.playerId !== id);
  },

  /**
   * Take back a spin: `spinId` if given (so a change sent late can't undo a newer spin by
   * mistake), otherwise the latest (the player's own, or the wheel's latest when shared).
   */
  undo(wheel, { playerId, spinId }) {
    const own = spinsFor(wheel, playerId ?? null);
    const spin = spinId !== undefined ? own.find((s) => s.id === spinId) : own.at(-1);
    if (!spin) return null;
    wheel.spins = wheel.spins.filter((s) => s !== spin);
    return spin;
  },

  'extra-spin'(wheel, { playerId }, now) {
    wheel.bonusSpins.push({ playerId: playerId ?? null, at: now.toISOString() });
    if (wheel.bonusSpins.length > MAX_BONUS_SPINS) wheel.bonusSpins.splice(0, wheel.bonusSpins.length - MAX_BONUS_SPINS);
  },

  /** Start a player over (or the whole wheel, if it's shared). */
  reset(wheel, { playerId }) {
    if (wheel.sharedWheel) {
      wheel.spins = [];
      wheel.bonusSpins = [];
    } else {
      wheel.spins = wheel.spins.filter((s) => !samePlayer(s.playerId, playerId));
      wheel.bonusSpins = wheel.bonusSpins.filter((b) => !samePlayer(b.playerId, playerId));
    }
  },
};

export const ACTION_NAMES = Object.freeze(Object.keys(ACTIONS));

/** Apply a named change. Throws RuleError for an unknown action or bad arguments. */
export function applyAction(wheel, name, args, { now = new Date() } = {}) {
  if (typeof name !== 'string' || !Object.hasOwn(ACTIONS, name)) throw new RuleError('unknown-action');
  return ACTIONS[name](wheel, isObject(args) ? args : {}, now);
}

export const optionRoom = (wheel) => MAX_OPTIONS - wheel.options.length;

// ================================================================ Validation

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const clampInt = (v, lo, hi) => clamp(Math.trunc(Number(v)) || 0, lo, hi);
export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTheme = (v) => typeof v === 'string' && Object.hasOwn(THEMES, v);
export const text = (v, max) => (v == null ? '' : String(v)).slice(0, max);
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH && /^[\w-]+$/.test(v);
const isTime = (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const isHash = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const list = (v) => (Array.isArray(v) ? v.filter(isObject) : []);

/** The caller's id if it's well-formed and unused, otherwise a new one. Marks it used. */
function freshId(raw, used) {
  const id = isId(raw) && !used.has(raw) ? raw : uid();
  used.add(id);
  return id;
}

function setOptional(target, key, value) {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

/**
 * Build a clean wheel from untrusted data (storage, a backup file, a phone). Every field is
 * checked and size-capped; ids are repaired; spins of unknown players are dropped.
 */
export function normalizeWheel(raw, { defaultTheme = DEFAULT_THEME_ID } = {}) {
  const w = isObject(raw) ? raw : {};
  const optionIds = new Set();
  const options = list(w.options)
    .slice(0, MAX_OPTIONS)
    .map((o) => ({ id: freshId(o.id, optionIds), label: text(o.label, MAX_LABEL_LENGTH), surprise: text(o.surprise, MAX_SURPRISE_LENGTH) }));

  const playerIds = new Set();
  const players = list(w.players)
    .slice(0, MAX_PLAYERS)
    .map((p) => {
      const player = { id: freshId(p.id, playerIds), name: text(p.name, MAX_NAME_LENGTH) };
      if (isHash(p.tokenHash)) player.tokenHash = p.tokenHash;
      if (p.claimed === true) player.claimed = true;
      return player;
    });
  const knownPlayer = (id) => id == null || playerIds.has(id);

  const spinIds = new Set();
  const spins = list(w.spins)
    .filter((s) => isId(s.optionId) && isTime(s.at) && knownPlayer(s.playerId))
    .slice(-MAX_SPINS)
    .map((s) => ({ id: freshId(s.id, spinIds), playerId: s.playerId ?? null, optionId: s.optionId, at: s.at }));

  const bonusSpins = list(w.bonusSpins)
    .filter((b) => isTime(b.at) && knownPlayer(b.playerId))
    .slice(-MAX_BONUS_SPINS)
    .map((b) => ({ playerId: b.playerId ?? null, at: b.at }));

  const wheel = {
    version: WHEEL_VERSION,
    id: isId(w.id) ? w.id : uid(),
    title: text(w.title, MAX_TITLE_LENGTH),
    theme: isTheme(w.theme) ? w.theme : isTheme(defaultTheme) ? defaultTheme : DEFAULT_THEME_ID,
    options,
    sharedWheel: w.sharedWheel === true,
    removeAfterSpin: w.removeAfterSpin !== false,
    players,
    spins,
    bonusSpins,
  };
  const perDay = clampInt(w.spinsPerDay, 0, MAX_SPINS_PER_DAY);
  if (perDay) wheel.spinsPerDay = perDay;
  if (w.sharedDailyLimit === true) wheel.sharedDailyLimit = true;
  if (w.showSpinsToEveryone === true) wheel.showSpinsToEveryone = true;
  if (isTimeZone(w.timeZone)) wheel.timeZone = w.timeZone;
  return wheel;
}

/** A new, empty-progress wheel with these options and rules. */
export function newWheel({ id, title = '', theme, options = [], removeAfterSpin = true, spinsPerDay = 0, players = [] } = {}) {
  return normalizeWheel({
    id,
    title,
    theme,
    options: options.map((label) => ({ id: uid(), label, surprise: '' })),
    removeAfterSpin,
    spinsPerDay,
    sharedWheel: players.length === 0,
    players: players.map((name) => ({ id: uid(), name })),
  });
}
