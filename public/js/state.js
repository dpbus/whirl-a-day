// This device's data: the list of wheels, settings, saving, snapshots and backup files.
//
// Every wheel has the shape described in rules.js, and every change to one goes through act(),
// which applies a named rules action. A local wheel is changed and saved right here. An online
// wheel (one with an `online` pointer) is a last-known copy of a wheel that lives on the server:
// act() applies the change to the copy straight away and hands it to the online connection,
// which sends it on; the server's reply then replaces the copy (see store/online.js).
import { THEMES, TICK_STYLES, DEFAULT_THEME_ID } from './themes.js';
import { getPreset, wheelFromPreset } from './presets.js';
import * as rules from './rules.js';
import { displayName, todayKey, uid } from './util.js';

export {
  MAX_LABEL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_OPTIONS,
  MAX_PLAYERS,
  MAX_SPINS_PER_DAY,
  MAX_SURPRISE_LENGTH,
  MAX_TITLE_LENGTH,
  optionRoom,
  spinPool,
  spinStatus,
  spinsLeftToday,
  spinsToday,
  bonusToday,
  openedOptions,
  spinsFor,
  wheelTitle,
  findPlayer,
  findOption,
} from './rules.js';

export const STORAGE_KEY = 'whirladay.state';
const SNAPSHOT_KEY = 'whirladay.snapshots';
const UNREADABLE_PREFIX = 'whirladay.state.unreadable.';
const MAX_SNAPSHOTS = 10;
const MAX_UNREADABLE_COPIES = 3;
const SAVE_DELAY_MS = 400;

// Versions 1–3 were the app before online wheels (saved under 'spinner.*' keys, a different
// shape). They aren't converted; numbering carries on from 4 so they can be told apart.
export const SCHEMA_VERSION = 4;
const FIRST_SUPPORTED_VERSION = 4;
// Limits on how much this device keeps, so a huge or crafted backup can't freeze the app.
export const MAX_WHEELS = 50;

/** Thrown for data saved by a newer version of the app, which this version must not overwrite. */
export class NewerVersionError extends Error {
  constructor() {
    super('This was saved by a newer version of Whirl-a-Day. Reload the app to update it, then try again.');
    this.name = 'NewerVersionError';
  }
}

let state = emptyState();
let lastRaw = null; // exactly what we last read from / wrote to storage
let saveOk = true;
let loadProblem = null; // null | 'unavailable' | 'unreadable' | 'unreadable-readonly' | 'newer-version'
let recoveredFrom = null; // ISO time of the snapshot loaded after unreadable data, if any
let readOnly = false; // true when stored data must not be overwritten (see load())
let saveTimer = 0;
let sendOnline = () => Promise.resolve(); // set by the online connection (setOnlineSender)

function defaultSettings() {
  return { theme: DEFAULT_THEME_ID, spinSeconds: 6, sound: true, tickSound: 'auto', confetti: true, pin: '', lastBackup: null };
}

function emptyState() {
  return { version: SCHEMA_VERSION, activeWheelId: null, settings: defaultSettings(), wheels: [] };
}

// ================================================================ Load / save

export function load() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  saveOk = true;
  clearLoadProblem();
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.error('Storage is unavailable.', err);
    loadProblem = 'unavailable';
    saveOk = false;
    state = emptyState();
    return state;
  }
  lastRaw = raw;
  if (!raw) {
    state = emptyState();
    return state;
  }
  try {
    state = normalize(JSON.parse(raw));
  } catch (err) {
    if (err instanceof NewerVersionError) {
      // An older copy of the app (e.g. an out-of-date home-screen install) must not save over
      // newer data. Show nothing and save nothing until the app is reloaded and updated.
      loadProblem = 'newer-version';
      readOnly = true;
      state = emptyState();
      return state;
    }
    console.error('Saved data could not be read; keeping a copy and loading the latest snapshot.', err);
    const setAside = keepUnreadableCopy(raw);
    loadProblem = setAside ? 'unreadable' : 'unreadable-readonly';
    readOnly = !setAside; // if the original couldn't be copied somewhere safe, never write over it
    state = emptyState();
    for (const snapshot of readSnapshots()) {
      try {
        state = normalize(snapshot.state);
        recoveredFrom = snapshot.at;
        break;
      } catch {}
    }
    save();
  }
  return state;
}

/** Save after a short pause (for typing). save() or flushSave() writes immediately. */
export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

export function flushSave() {
  if (saveTimer) save();
}

export function save() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (readOnly) {
    saveOk = false;
    return false;
  }
  const raw = JSON.stringify(state);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
    lastRaw = raw;
    saveOk = true;
  } catch (err) {
    console.error('Could not save data.', err);
    saveOk = false;
  }
  return saveOk;
}

function clearLoadProblem() {
  loadProblem = null;
  recoveredFrom = null;
  readOnly = false;
}

export const getState = () => state;
export const isReadOnly = () => readOnly;
export const saveHealthy = () => saveOk;
export const getLoadProblem = () => loadProblem;
export const getRecoveredFrom = () => recoveredFrom;

/** True if storage holds something other than what this page last read or wrote. */
export function storageChangedElsewhere() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== lastRaw;
  } catch {
    return false;
  }
}

/** Ask the browser not to evict our storage (best effort; mostly helps Chrome/Firefox). */
export function requestPersistentStorage() {
  navigator.storage?.persist?.().catch(() => {});
}

// ================================================================ Unreadable data

/** Copy unreadable data under its own key. Returns false if storage refused. */
function keepUnreadableCopy(raw) {
  try {
    localStorage.setItem(UNREADABLE_PREFIX + new Date().toISOString(), raw);
  } catch {
    return false;
  }
  for (const key of listUnreadableKeys().slice(MAX_UNREADABLE_COPIES)) localStorage.removeItem(key);
  return true;
}

function listUnreadableKeys() {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(UNREADABLE_PREFIX))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Raw copies of saved data that couldn't be read (newest first), for manual recovery. */
export function listUnreadableData() {
  const items = listUnreadableKeys().map((key) => ({ savedAt: key.slice(UNREADABLE_PREFIX.length), raw: localStorage.getItem(key) }));
  if (readOnly && lastRaw) items.unshift({ savedAt: 'current', raw: lastRaw });
  return items.filter((item) => item.raw);
}

// ================================================================ Backup files

/**
 * Backup file contents. The PIN and online sign-in tokens stay on this device and are never
 * written to a file: an online wheel is backed up as its last-known copy only.
 */
export function exportJson() {
  const { pin, ...settings } = state.settings;
  const wheels = state.wheels.map((w) => (w.online ? { ...w, online: { ...w.online, token: '' } } : w));
  return JSON.stringify({ ...state, settings, wheels, exportedAt: new Date().toISOString() }, null, 2);
}

/** Validate a parsed backup without applying it. Throws if it isn't one. */
export function parseBackup(data) {
  return normalize(data);
}

/** Replace everything with a validated backup. This device's PIN is kept. */
export function replaceState(next) {
  adopt(next, 'Before restoring a backup file');
}

/** Delete everything, including the PIN. A snapshot is kept. */
export function eraseAll() {
  takeSnapshot('Before erasing everything');
  state = emptyState();
  clearLoadProblem(); // the user chose to start over, so saving may resume
  save();
}

/**
 * Switch to a whole new state (from a backup or snapshot), keeping this device's PIN.
 * The user chose this, so it also ends read-only mode: any unreadable data is replaced.
 */
function adopt(next, reason) {
  takeSnapshot(reason);
  next.settings.pin = state.settings.pin;
  state = next;
  clearLoadProblem();
  save();
}

// ================================================================ Automatic snapshots

function readSnapshots() {
  try {
    const list = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((s) => isObject(s) && s.state && typeof s.at === 'string') : [];
  } catch {
    return [];
  }
}

function writeSnapshots(list) {
  // If storage is tight, keep fewer snapshots rather than failing.
  for (let keep = MAX_SNAPSHOTS; keep >= 1; keep = Math.floor(keep / 2)) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list.slice(0, keep)));
      return;
    } catch {}
  }
}

export function takeSnapshot(reason, { daily = false } = {}) {
  if (!state.wheels.length) return;
  const list = readSnapshots();
  list.unshift({ at: new Date().toISOString(), reason, ...(daily && { daily }), state: structuredClone(state) });
  writeSnapshots(list);
}

/** Once per day, remember how things looked at the start of the day. */
export function dailySnapshot() {
  const today = todayKey();
  if (readSnapshots().some((s) => s.daily && todayKey(new Date(s.at)) === today)) return;
  takeSnapshot('Start of the day', { daily: true });
}

export function listSnapshots() {
  return readSnapshots().map((s) => ({ at: s.at, reason: text(s.reason, 120), summary: summarize(s.state) }));
}

/** Restore the snapshot taken at `at` (its timestamp is its id). This device's PIN is kept. */
export function restoreSnapshot(at) {
  const snapshot = readSnapshots().find((s) => s.at === at);
  if (!snapshot) throw new Error('That snapshot no longer exists.');
  adopt(normalize(snapshot.state), 'Before restoring a snapshot');
}

/** Short description of a saved state, e.g. "12 Days: Ava 3, Ben 1 · Dinner: 5 spins". */
function summarize(data) {
  if (!Array.isArray(data?.wheels)) return '';
  return data.wheels
    .filter(isObject)
    .map((w) => {
      const title = text(w.title, 30).trim() || 'Wheel';
      const players = Array.isArray(w.players) ? w.players.filter(isObject) : [];
      const spins = Array.isArray(w.spins) ? w.spins.filter(isObject) : [];
      const name = (p) => displayName({ name: text(p?.name, rules.MAX_NAME_LENGTH) });
      return players.length && !w.sharedWheel
        ? `${title}: ${players.map((p) => `${name(p)} ${spins.filter((s) => s.playerId === p.id).length}`).join(', ')}`
        : `${title}: ${plural(spins.length, 'spin')}`;
    })
    .join(' · ');
}

// ================================================================ Validation

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTheme = (v) => typeof v === 'string' && Object.hasOwn(THEMES, v);
const text = (v, max) => (v == null ? '' : String(v)).slice(0, max);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Build a clean state from untrusted data (storage, backup file, snapshot).
function normalize(data) {
  const version = Number(data?.version);
  if (isObject(data) && (Array.isArray(data.players) || version < FIRST_SUPPORTED_VERSION)) {
    throw new Error("This backup is from an older version of Whirl-a-Day and can't be restored.");
  }
  if (!isObject(data) || !Array.isArray(data.wheels)) throw new Error("This doesn't look like a Whirl-a-Day backup file.");
  if (version > SCHEMA_VERSION) throw new NewerVersionError();
  const next = emptyState();
  next.settings = normalizeSettings(data.settings);
  const ids = new Set();
  next.wheels = data.wheels
    .filter(isObject)
    .slice(0, MAX_WHEELS)
    .map((w) => normalizeDeviceWheel(w, ids, next.settings.theme));
  next.activeWheelId = next.wheels.some((w) => w.id === data.activeWheelId) ? data.activeWheelId : (next.wheels[0]?.id ?? null);
  return next;
}

function normalizeSettings(raw) {
  const s = isObject(raw) ? raw : {};
  const defaults = defaultSettings();
  return {
    theme: isTheme(s.theme) ? s.theme : defaults.theme,
    spinSeconds: clamp(Math.round(Number(s.spinSeconds)) || defaults.spinSeconds, 2, 15),
    sound: typeof s.sound === 'boolean' ? s.sound : defaults.sound,
    tickSound: typeof s.tickSound === 'string' && Object.hasOwn(TICK_STYLES, s.tickSound) ? s.tickSound : defaults.tickSound,
    confetti: typeof s.confetti === 'boolean' ? s.confetti : defaults.confetti,
    pin: typeof s.pin === 'string' && /^\d{4,8}$/.test(s.pin) ? s.pin : '',
    lastBackup: isDateKey(s.lastBackup) ? s.lastBackup : null,
  };
}

/** A wheel as this device keeps it: the rules shape, plus the selected tab and any online pointer. */
function normalizeDeviceWheel(raw, usedIds, defaultTheme) {
  const wheel = rules.normalizeWheel(raw, { defaultTheme });
  if (usedIds.has(wheel.id)) wheel.id = uid();
  usedIds.add(wheel.id);
  for (const player of wheel.players) delete player.tokenHash; // only the server holds these
  const online = normalizeOnline(raw.online, wheel);
  if (online) wheel.online = online;
  else wheel.sharedWheel = wheel.players.length === 0; // on one device, a wheel without players is shared
  wheel.activePlayerId = wheel.players.some((p) => p.id === raw.activePlayerId) ? raw.activePlayerId : (wheel.players[0]?.id ?? null);
  return wheel;
}

/** The pointer from this device's copy to a wheel on the server. */
function normalizeOnline(raw, wheel) {
  if (!isObject(raw) || !isWheelId(raw.wheelId) || (raw.role !== 'host' && raw.role !== 'player')) return null;
  return {
    wheelId: raw.wheelId,
    role: raw.role,
    token: isToken(raw.token) ? raw.token : '', // empty: signed out (e.g. restored from a backup)
    playerId: raw.role === 'player' && wheel.players.some((p) => p.id === raw.playerId) ? raw.playerId : null,
    joinCode: isJoinCode(raw.joinCode) ? raw.joinCode : '',
    joinOpen: raw.joinOpen !== false,
    // The host's own name, when they play too (host devices only).
    hostPlayerId: raw.role === 'host' && wheel.players.some((p) => p.id === raw.hostPlayerId) ? raw.hostPlayerId : null,
    lastActiveAt: typeof raw.lastActiveAt === 'string' && !Number.isNaN(Date.parse(raw.lastActiveAt)) ? raw.lastActiveAt.slice(0, 40) : '',
  };
}

export const isWheelId = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
export const isToken = (v) => typeof v === 'string' && /^[\w-]{16,64}$/.test(v);
export const isJoinCode = (v) => typeof v === 'string' && /^[0-9A-Z]{4,12}$/.test(v);

// ================================================================ Settings

/** Change settings. Pass { soon: true } for rapid changes (e.g. dragging a slider). */
export function updateSettings(patch, { soon = false } = {}) {
  Object.assign(state.settings, patch);
  if (soon) scheduleSave();
  else save();
}

// ================================================================ Wheels

export const getWheel = (id) => state.wheels.find((w) => w.id === id) ?? null;

export function activeWheel() {
  return getWheel(state.activeWheelId) ?? state.wheels[0] ?? null;
}

export const isShared = (wheel) => wheel.sharedWheel;

/** 'owner' for a wheel that lives on this device; 'host' or 'player' for an online one. */
export const roleOf = (wheel) => wheel?.online?.role ?? 'owner';

/** Can this device change the wheel's options, rules and players? */
export const canManage = (wheel) => roleOf(wheel) !== 'player';

/** Has this device lost its sign-in to an online wheel (restored from a backup, released)? */
export const isSignedOut = (wheel) => Boolean(wheel?.online && !wheel.online.token);

/** Is this the host's own name on a wheel they host (they play too)? */
export const isHostPlayer = (wheel, playerId) => Boolean(playerId) && wheel?.online?.role === 'host' && wheel.online.hostPlayerId === playerId;

/**
 * Who spins on this device right now: the player this phone joined as, the selected tab, or
 * null (a shared wheel with nobody selected).
 */
export function activePlayer(wheel) {
  if (!wheel) return null;
  if (roleOf(wheel) === 'player') return rules.findPlayer(wheel, wheel.online.playerId);
  if (!wheel.players.length) return null;
  return rules.findPlayer(wheel, wheel.activePlayerId) ?? wheel.players[0];
}

export const activePlayerId = (wheel) => activePlayer(wheel)?.id ?? null;

/**
 * Show this wheel. `save: false` keeps the choice to this tab of the app (used after reloading
 * what another tab saved, so each tab stays on its own wheel).
 */
export function setActiveWheel(id, { save: persist = true } = {}) {
  if (getWheel(id)) {
    state.activeWheelId = id;
    if (persist) save();
  }
}

export const canAddWheel = () => state.wheels.length < MAX_WHEELS;

/** Create a wheel from a preset and make it the active one. */
export function addWheel({ presetId, title, theme, playerNames = [] }) {
  if (!canAddWheel()) throw new Error(`You can have up to ${MAX_WHEELS} wheels.`);
  const base = wheelFromPreset(presetId);
  const preset = getPreset(presetId);
  const wheel = rules.newWheel({
    title: title?.trim() || base.title,
    theme: isTheme(theme) ? theme : isTheme(preset.theme) ? preset.theme : state.settings.theme,
    options: base.options.map((o) => o.label),
    removeAfterSpin: base.removeAfterSpin,
    spinsPerDay: base.spinsPerDay,
    players: playerNames.slice(0, rules.MAX_PLAYERS),
  });
  wheel.activePlayerId = wheel.players[0]?.id ?? null;
  state.wheels.push(wheel);
  state.activeWheelId = wheel.id;
  save();
  return wheel;
}

/** Take a wheel off this device. (An online wheel stays on the server until it expires.) */
export function removeWheel(id) {
  const wheel = getWheel(id);
  if (!wheel) return;
  takeSnapshot(`Before removing the “${rules.wheelTitle(wheel)}” wheel`);
  state.wheels = state.wheels.filter((w) => w.id !== id);
  if (state.activeWheelId === id) state.activeWheelId = state.wheels[0]?.id ?? null;
  save();
}

// ================================================================ Changing a wheel

/**
 * Apply a named rules action (see rules.js) to a wheel. Local wheels save here; online wheels
 * update their copy now and send the change to the server. `soon` delays both, for typing.
 * Returns what the action returns. Throws rules.RuleError if the action is refused.
 */
export function act(wheel, name, args = {}, { soon = false } = {}) {
  const result = rules.applyAction(wheel, name, args);
  if (wheel.online) sendOnline(wheel, name, args, { soon }).catch(() => {}); // the connection reports problems
  if (soon) scheduleSave();
  else save();
  return result;
}

/** The online connection registers how to send a change to the server. */
export function setOnlineSender(send) {
  sendOnline = send;
}

/** Title, theme and rules. */
export function setWheelProps(wheel, patch) {
  // Typing the title waits for a pause; everything else saves right away.
  act(wheel, 'set-props', patch, { soon: Object.keys(patch).every((k) => k === 'title') });
}

/** Add options (as many as fit). Returns the ones added. */
export function addOptions(wheel, labels) {
  const options = labels.slice(0, rules.optionRoom(wheel)).map((label) => ({ id: uid(), label }));
  return options.length ? act(wheel, 'add-options', { options }) : [];
}

export function updateOption(wheel, optionId, patch) {
  act(wheel, 'update-option', { id: optionId, ...patch }, { soon: true }); // called while typing
}

export function removeOption(wheel, optionId) {
  act(wheel, 'remove-option', { id: optionId });
}

/** Drop never-spun options left with an empty label (called when settings close). */
export function pruneBlankOptions() {
  for (const wheel of state.wheels) {
    if (!canManage(wheel)) continue;
    const spun = new Set(wheel.spins.map((s) => s.optionId));
    for (const option of wheel.options.filter((o) => !o.label.trim() && !spun.has(o.id))) {
      act(wheel, 'remove-option', { id: option.id });
    }
  }
}

/** Snapshots cover wheels on this device; an online wheel's history lives on the server. */
function snapshotFirst(wheel, reason) {
  if (!wheel.online) takeSnapshot(reason);
}

// ================================================================ Players (on a wheel)

export const canAddPlayer = (wheel) => wheel.players.length < rules.MAX_PLAYERS;

/**
 * Add a player. On this device a wheel without players is shared, and its spins belong to
 * nobody in particular, so adding the first player clears them (after a snapshot) rather
 * than keeping them hidden. Online wheels keep their kind; this just adds a name to claim.
 */
export function addPlayer(wheel, name) {
  if (!wheel.online && wheel.sharedWheel) {
    if (wheel.spins.length) takeSnapshot(`Before adding the first player to “${rules.wheelTitle(wheel)}”`);
    act(wheel, 'reset', { playerId: null });
    act(wheel, 'set-props', { sharedWheel: false });
  }
  const player = act(wheel, 'add-player', { id: uid(), name });
  wheel.activePlayerId = player.id;
  save();
  return player;
}

export function renamePlayer(wheel, id, name) {
  act(wheel, 'rename-player', { id, name }, { soon: true }); // called while typing
}

export function removePlayer(wheel, id) {
  const player = rules.findPlayer(wheel, id);
  if (!player) return;
  snapshotFirst(wheel, `Before removing ${displayName(player)} from “${rules.wheelTitle(wheel)}”`);
  act(wheel, 'remove-player', { id });
  if (wheel.activePlayerId === id) wheel.activePlayerId = wheel.players[0]?.id ?? null;
  if (!wheel.online && !wheel.players.length) {
    act(wheel, 'reset', { playerId: null }); // now shared: start fresh
    act(wheel, 'set-props', { sharedWheel: true });
  }
  save();
}

export function setActivePlayer(wheel, id) {
  if (wheel.players.some((p) => p.id === id)) {
    wheel.activePlayerId = id;
    save();
  }
}

// ================================================================ Spinning & progress

/** Spin a wheel on this device: pick, save, and return { spin, option, index }. */
export function spinLocal(wheel, playerId) {
  const result = rules.applySpin(wheel, playerId);
  save(); // saved before the wheel moves, so refreshing mid-spin can't re-roll
  return result;
}

export function undoLastSpin(wheel, playerId) {
  const last = rules.spinsFor(wheel, playerId ?? null).at(-1);
  return last ? act(wheel, 'undo', { playerId, spinId: last.id }) : null;
}

export function allowExtraSpin(wheel, playerId) {
  act(wheel, 'extra-spin', { playerId });
}

export function resetProgress(wheel, playerId) {
  const player = rules.findPlayer(wheel, playerId);
  const who = wheel.sharedWheel || !player ? `“${rules.wheelTitle(wheel)}”` : `${displayName(player)} on “${rules.wheelTitle(wheel)}”`;
  snapshotFirst(wheel, `Before resetting ${who}`);
  act(wheel, 'reset', { playerId });
}

// ================================================================ Online wheels

/**
 * Add (or refresh) an online wheel on this device from the server's copy, and make it active.
 * If this device already has the same online wheel, that entry is updated instead.
 */
export function addOnlineWheel(serverWheel, online) {
  const existing = state.wheels.find((w) => w.online?.wheelId === online.wheelId);
  const ids = new Set(state.wheels.filter((w) => w !== existing).map((w) => w.id));
  const wheel = normalizeDeviceWheel({ ...serverWheel, id: existing?.id ?? uid(), online }, ids, state.settings.theme);
  if (existing) Object.assign(clearWheel(existing), wheel);
  else {
    if (!canAddWheel()) throw new Error(`You can have up to ${MAX_WHEELS} wheels.`);
    state.wheels.push(wheel);
  }
  state.activeWheelId = (existing ?? wheel).id;
  save();
  return existing ?? wheel;
}

/**
 * Replace an online wheel's copy with the server's, in place (screens keep their reference).
 * `meta` carries the host-only details (join code, joining open, last activity).
 */
export function applyServerWheel(wheel, serverWheel, meta = {}) {
  const fresh = normalizeDeviceWheel(
    { ...serverWheel, id: wheel.id, activePlayerId: wheel.activePlayerId, online: { ...wheel.online, ...pick(meta, ['joinCode', 'joinOpen', 'hostPlayerId', 'lastActiveAt']) } },
    new Set(),
    state.settings.theme,
  );
  Object.assign(clearWheel(wheel), fresh);
  // If another tab saved meanwhile, don't write over it: this page reloads from storage soon
  // (main.js), and the server sends its copy again when it reconnects.
  if (!storageChangedElsewhere()) save();
}

/** Forget this device's sign-in to an online wheel (keeps the last-known copy). */
export function signOut(wheel) {
  if (!wheel.online) return;
  wheel.online.token = '';
  save();
}

/** Turn an online wheel back into one on this device (after it was deleted from the server). */
export function makeLocal(wheel) {
  delete wheel.online;
  // On one device a shared wheel has no players, so its spins become nobody's in particular.
  if (wheel.sharedWheel || !wheel.players.length) {
    wheel.players = [];
    wheel.activePlayerId = null;
    wheel.spins = wheel.spins.map((s) => ({ ...s, playerId: null }));
    wheel.bonusSpins = wheel.bonusSpins.map((b) => ({ ...b, playerId: null }));
    wheel.sharedWheel = true;
  }
  save();
}

function clearWheel(wheel) {
  for (const key of Object.keys(wheel)) delete wheel[key];
  return wheel;
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]));
