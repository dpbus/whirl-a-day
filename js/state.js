// All app data lives here and is saved to localStorage.
// Every function that changes data saves it; the UI re-renders separately.
//
// Shape (version 3):
// {
//   version: 3,
//   activeWheelId: string|null,
//   settings: { theme, spinSeconds, sound, tickSound, confetti, pin, lastBackup },
//                // `theme` is the default for new wheels and the setup screen
//   wheels: [{
//     id, title, theme,
//     options: [{ id, label, surprise }],
//     removeAfterSpin: boolean,
//     spinsPerDay: number,              // 0 = no limit
//     players: [{ id, name, ...progress }],
//     activePlayerId: string|null,
//     shared: progress                  // used when the wheel has no players
//   }]
// }
// progress = {
//   remaining: [optionId],              // options still on the wheel (when removeAfterSpin)
//   history: [{ optionId, label, date: 'YYYY-MM-DD', at: ISO }],
//   bonus: { date: 'YYYY-MM-DD', count }|null   // extra spins a grown-up granted for that day
// }
//
// Older saves (v1/v2: one wheel per player) are converted by migratePlayersToWheels().
//
// Safety nets against losing progress:
//  - Saved data that can't be read is never overwritten: it's copied aside and the newest
//    automatic snapshot is loaded. If it can't be copied aside, saving stops instead.
//  - Automatic snapshots: one at the start of each day, plus one before every destructive
//    action (reset, remove, load preset, restore, erase). Restorable from Settings → Backup.
//  - storageChangedElsewhere() lets the UI reload when another tab/window changed the data,
//    so a stale copy never overwrites newer progress.
//  - saveHealthy() reports whether the last save actually worked.
//  - Anything read from storage, snapshots or backup files goes through normalize(), which
//    type-checks and bounds every field, so damaged or crafted data can't break the app.
import { displayName, todayKey, uid } from './util.js';
import { wheelFromPreset, getPreset } from './presets.js';
import { THEMES, TICK_STYLES, DEFAULT_THEME_ID } from './themes.js';

// Keys keep the original 'spinner.' prefix: renaming them would orphan existing saves.
export const STORAGE_KEY = 'spinner.state';
const SNAPSHOT_KEY = 'spinner.snapshots';
const UNREADABLE_PREFIX = 'spinner.state.unreadable.';
const MAX_SNAPSHOTS = 10;
const MAX_UNREADABLE_COPIES = 3;
const SAVE_DELAY_MS = 400;

export const SCHEMA_VERSION = 3;
export const MAX_SPINS_PER_DAY = 10;
export const MAX_LABEL_LENGTH = 40;
export const MAX_SURPRISE_LENGTH = 200;
export const MAX_NAME_LENGTH = 24;
export const MAX_TITLE_LENGTH = 60;
// Limits on how much data a wheel can hold, so a huge or crafted backup can't freeze the app.
export const MAX_WHEELS = 50;
export const MAX_OPTIONS = 200;
export const MAX_PLAYERS = 20;
const MAX_HISTORY = 1000; // per player; the oldest entries are dropped beyond this

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

/** Backup file contents. The PIN stays on this device and is never written to a file. */
export function exportJson() {
  const { pin, ...settings } = state.settings;
  return JSON.stringify({ ...state, settings, exportedAt: new Date().toISOString() }, null, 2);
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

/** Short description of a saved state (any version), e.g. "12 Days: Ava 3, Ben 1 · Dinner: 5 spins". */
function summarize(data) {
  const count = (p) => (Array.isArray(p?.history) ? p.history.length : 0);
  const name = (p) => displayName({ name: text(p?.name, MAX_NAME_LENGTH) });
  if (Array.isArray(data?.wheels)) {
    return data.wheels
      .filter(isObject)
      .map((w) => {
        const title = text(w.title, 30).trim() || 'Wheel';
        const players = Array.isArray(w.players) ? w.players.filter(isObject) : [];
        return players.length
          ? `${title}: ${players.map((p) => `${name(p)} ${count(p)}`).join(', ')}`
          : `${title}: ${plural(count(w.shared), 'spin')}`;
      })
      .join(' · ');
  }
  if (Array.isArray(data?.players)) {
    return data.players.filter(isObject).map((p) => `${name(p)}: ${plural(count(p), 'spin')}`).join(', ');
  }
  return '';
}

// ================================================================ Validation & migration

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTheme = (v) => typeof v === 'string' && Object.hasOwn(THEMES, v);
const text = (v, max) => (v == null ? '' : String(v)).slice(0, max);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Keep an imported id if it's a sensible, unused string; otherwise make a new one. */
function uniqueId(raw, used) {
  let id = typeof raw === 'string' || typeof raw === 'number' ? String(raw).slice(0, 64) : '';
  if (!id || used.has(id)) id = uid();
  used.add(id);
  return id;
}

// Build a clean state from untrusted data (storage, backup file, snapshot) of any version.
function normalize(data) {
  if (isObject(data) && Number(data.version) > SCHEMA_VERSION) throw new NewerVersionError();
  if (isObject(data) && Array.isArray(data.wheels)) return normalizeV3(data);
  if (isObject(data) && Array.isArray(data.players)) return normalizeV3(migratePlayersToWheels(data));
  throw new Error("This doesn't look like a Whirl-a-Day backup file.");
}

function normalizeV3(data) {
  const next = emptyState();
  next.settings = normalizeSettings(data.settings);
  const wheelIds = new Set();
  next.wheels = data.wheels
    .filter(isObject)
    .slice(0, MAX_WHEELS)
    .map((w) => normalizeWheel(w, wheelIds, next.settings.theme));
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

function normalizeWheel(w, usedIds, defaultTheme) {
  const optionIds = new Set();
  const options = (Array.isArray(w.options) ? w.options : []).filter(isObject).slice(0, MAX_OPTIONS).map((o) => ({
    id: uniqueId(o.id, optionIds),
    label: text(o.label, MAX_LABEL_LENGTH),
    surprise: text(o.surprise, MAX_SURPRISE_LENGTH),
  }));
  const playerIds = new Set();
  const players = (Array.isArray(w.players) ? w.players : []).filter(isObject).slice(0, MAX_PLAYERS).map((p) => ({
    id: uniqueId(p.id, playerIds),
    name: text(p.name ?? 'Player', MAX_NAME_LENGTH),
    ...normalizeProgress(p, optionIds),
  }));
  return {
    id: uniqueId(w.id, usedIds),
    title: text(w.title, MAX_TITLE_LENGTH),
    theme: isTheme(w.theme) ? w.theme : defaultTheme,
    options,
    removeAfterSpin: w.removeAfterSpin !== false,
    spinsPerDay: readSpinsPerDay(w),
    players,
    activePlayerId: players.some((p) => p.id === w.activePlayerId) ? w.activePlayerId : (players[0]?.id ?? null),
    shared: normalizeProgress(isObject(w.shared) ? w.shared : {}, optionIds),
  };
}

function normalizeProgress(p, optionIds) {
  const remaining = Array.isArray(p.remaining) ? p.remaining.map(String).filter((id) => optionIds.has(id)) : [...optionIds];
  const history = (Array.isArray(p.history) ? p.history : [])
    .filter((h) => isObject(h) && h.optionId != null)
    .slice(-MAX_HISTORY)
    .map((h) => ({
      optionId: String(h.optionId),
      label: text(h.label, MAX_LABEL_LENGTH),
      date: isDateKey(h.date) ? h.date : '',
      at: typeof h.at === 'string' ? h.at.slice(0, 40) : '',
    }));
  return { remaining: [...new Set(remaining)], history, bonus: readBonus(p) };
}

/** v1 had an on/off `dailyLock`; v2+ has a number. Accept either. */
function readSpinsPerDay(wheel) {
  const n = Number(wheel?.spinsPerDay);
  if (wheel?.spinsPerDay != null && wheel.spinsPerDay !== '' && Number.isFinite(n)) {
    return clamp(Math.trunc(n), 0, MAX_SPINS_PER_DAY);
  }
  return wheel?.dailyLock ? 1 : 0;
}

function readBonus(p) {
  if (isObject(p.bonus) && isDateKey(p.bonus.date)) {
    return { date: p.bonus.date, count: clamp(Math.trunc(Number(p.bonus.count)) || 0, 0, 50) };
  }
  // v1: a single granted extra spin
  return isDateKey(p.extraSpinDate) ? { date: p.extraSpinDate, count: 1 } : null;
}

/**
 * v1/v2 → v3. Before v3 every player had their own copy of a wheel. Players whose wheels are
 * identical (title, options, surprises, rules) become one wheel with those players; anyone
 * whose wheel differs gets a wheel of their own. Option ids are remapped by position so each
 * player's history and remaining options point at the shared wheel's options.
 * Returns raw v3-shaped data; normalizeV3() validates it afterwards.
 */
function migratePlayersToWheels(data) {
  const theme = isTheme(data.settings?.theme) ? data.settings.theme : DEFAULT_THEME_ID;
  const groups = new Map(); // signature → wheel
  let activeWheelId = null;

  for (const p of data.players.filter(isObject)) {
    const old = isObject(p.wheel) ? p.wheel : {};
    const options = (Array.isArray(old.options) ? old.options : []).filter(isObject);
    const removeAfterSpin = old.removeAfterSpin !== false;
    const spinsPerDay = readSpinsPerDay(old);
    const signature = JSON.stringify([
      text(old.title, MAX_TITLE_LENGTH),
      options.map((o) => [text(o.label, MAX_LABEL_LENGTH), text(o.surprise, MAX_SURPRISE_LENGTH)]),
      removeAfterSpin,
      spinsPerDay,
    ]);

    let wheel = groups.get(signature);
    if (!wheel) {
      const ids = new Set();
      wheel = {
        id: uid(),
        title: old.title,
        theme,
        options: options.map((o) => ({ id: uniqueId(o.id, ids), label: o.label, surprise: o.surprise })),
        removeAfterSpin,
        spinsPerDay,
        players: [],
        activePlayerId: null,
        shared: {},
      };
      groups.set(signature, wheel);
    }

    const idMap = new Map(options.map((o, i) => [String(o.id), wheel.options[i].id]));
    const mapId = (id) => idMap.get(String(id)) ?? String(id);
    wheel.players.push({
      id: p.id,
      name: p.name,
      remaining: Array.isArray(p.remaining) ? p.remaining.map(mapId) : undefined,
      history: (Array.isArray(p.history) ? p.history : []).filter(isObject).map((h) => ({ ...h, optionId: mapId(h.optionId) })),
      bonus: p.bonus,
      extraSpinDate: p.extraSpinDate,
    });
    if (p.id === data.activePlayerId) {
      activeWheelId = wheel.id;
      wheel.activePlayerId = p.id;
    }
  }
  return { version: SCHEMA_VERSION, settings: data.settings, activeWheelId, wheels: [...groups.values()] };
}

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

export const wheelTitle = (wheel) => wheel?.title?.trim() || 'Untitled wheel';
export const isShared = (wheel) => wheel.players.length === 0;

/** The selected player on a wheel, or null for a shared wheel. */
export function activePlayer(wheel) {
  if (!wheel?.players.length) return null;
  return wheel.players.find((p) => p.id === wheel.activePlayerId) ?? wheel.players[0];
}

/** Whose progress the wheel shows: the selected player's, or the shared progress. */
export function activeProgress(wheel) {
  return activePlayer(wheel) ?? wheel.shared;
}

const allProgress = (wheel) => [...wheel.players, wheel.shared];

const freshProgress = (wheel) => ({ remaining: wheel.options.map((o) => o.id), history: [], bonus: null });

export function setActiveWheel(id) {
  if (getWheel(id)) {
    state.activeWheelId = id;
    save();
  }
}

export const canAddWheel = () => state.wheels.length < MAX_WHEELS;

/** Create a wheel from a preset and make it the active one. */
export function addWheel({ presetId, title, theme, playerNames = [] }) {
  if (!canAddWheel()) throw new Error(`You can have up to ${MAX_WHEELS} wheels.`);
  const base = wheelFromPreset(presetId);
  const preset = getPreset(presetId);
  const wheel = {
    id: uid(),
    title: text(title?.trim() || base.title, MAX_TITLE_LENGTH),
    theme: isTheme(theme) ? theme : isTheme(preset.theme) ? preset.theme : state.settings.theme,
    options: base.options,
    removeAfterSpin: base.removeAfterSpin,
    spinsPerDay: base.spinsPerDay,
    players: [],
    activePlayerId: null,
    shared: null,
  };
  wheel.shared = freshProgress(wheel);
  for (const name of playerNames.slice(0, MAX_PLAYERS)) wheel.players.push({ id: uid(), name: text(name, MAX_NAME_LENGTH), ...freshProgress(wheel) });
  wheel.activePlayerId = wheel.players[0]?.id ?? null;
  state.wheels.push(wheel);
  state.activeWheelId = wheel.id;
  save();
  return wheel;
}

export function removeWheel(id) {
  const wheel = getWheel(id);
  if (!wheel) return;
  takeSnapshot(`Before removing the “${wheelTitle(wheel)}” wheel`);
  state.wheels = state.wheels.filter((w) => w.id !== id);
  if (state.activeWheelId === id) state.activeWheelId = state.wheels[0]?.id ?? null;
  save();
}

export function moveWheel(id, delta) {
  moveItem(state.wheels, id, delta);
  save();
}

/** Title, theme, removeAfterSpin or spinsPerDay. */
export function setWheelProps(wheel, patch) {
  const turningRemovalOn = patch.removeAfterSpin === true && !wheel.removeAfterSpin;
  Object.assign(wheel, patch);
  if (turningRemovalOn) {
    // Anything already spun comes off the wheel.
    for (const progress of allProgress(wheel)) {
      const spun = new Set(progress.history.map((h) => h.optionId));
      progress.remaining = wheel.options.filter((o) => !spun.has(o.id)).map((o) => o.id);
    }
  }
  // Typing the title saves after a pause; everything else saves right away.
  if (Object.keys(patch).every((k) => k === 'title')) scheduleSave();
  else save();
}

/** How many more options this wheel can take. */
export const optionRoom = (wheel) => MAX_OPTIONS - wheel.options.length;

/** Add options (as many as fit). Returns the ones added. */
export function addOptions(wheel, labels) {
  const added = labels.slice(0, optionRoom(wheel)).map((label) => ({ id: uid(), label: text(label, MAX_LABEL_LENGTH), surprise: '' }));
  wheel.options.push(...added);
  for (const progress of allProgress(wheel)) progress.remaining.push(...added.map((o) => o.id));
  save();
  return added;
}

export function updateOption(wheel, optionId, patch) {
  const option = wheel.options.find((o) => o.id === optionId);
  if (option) {
    Object.assign(option, patch);
    scheduleSave(); // called while typing
  }
}

export function removeOption(wheel, optionId) {
  wheel.options = wheel.options.filter((o) => o.id !== optionId);
  for (const progress of allProgress(wheel)) progress.remaining = progress.remaining.filter((id) => id !== optionId);
  save();
}

/** Replace a wheel's options and rules with a preset, and start everyone's progress over. */
export function loadPreset(wheel, presetId) {
  takeSnapshot(`Before loading a preset on “${wheelTitle(wheel)}”`);
  const base = wheelFromPreset(presetId);
  Object.assign(wheel, { options: base.options, removeAfterSpin: base.removeAfterSpin, spinsPerDay: base.spinsPerDay });
  for (const progress of allProgress(wheel)) Object.assign(progress, freshProgress(wheel));
  save();
}

/** Drop never-spun options left with an empty label (called when settings close). */
export function pruneBlankOptions() {
  let changed = false;
  for (const wheel of state.wheels) {
    const spun = new Set(allProgress(wheel).flatMap((p) => p.history.map((h) => h.optionId)));
    const blank = new Set(wheel.options.filter((o) => !o.label.trim() && !spun.has(o.id)).map((o) => o.id));
    if (!blank.size) continue;
    wheel.options = wheel.options.filter((o) => !blank.has(o.id));
    for (const progress of allProgress(wheel)) progress.remaining = progress.remaining.filter((id) => !blank.has(id));
    changed = true;
  }
  if (changed) save();
}

// ================================================================ Players (on a wheel)

export const canAddPlayer = (wheel) => wheel.players.length < MAX_PLAYERS;

/**
 * Add a player. A shared wheel's spins belong to nobody in particular, so when its first
 * player is added the shared progress is cleared (after a snapshot) rather than kept hidden.
 */
export function addPlayer(wheel, name) {
  if (!canAddPlayer(wheel)) throw new Error(`A wheel can have up to ${MAX_PLAYERS} players.`);
  if (isShared(wheel) && wheel.shared.history.length) {
    takeSnapshot(`Before adding the first player to “${wheelTitle(wheel)}”`);
  }
  if (isShared(wheel)) Object.assign(wheel.shared, freshProgress(wheel));
  const player = { id: uid(), name: text(name, MAX_NAME_LENGTH), ...freshProgress(wheel) };
  wheel.players.push(player);
  wheel.activePlayerId = player.id;
  save();
  return player;
}

export function renamePlayer(wheel, id, name) {
  const player = wheel.players.find((p) => p.id === id);
  if (player) {
    player.name = text(name, MAX_NAME_LENGTH);
    scheduleSave(); // called while typing
  }
}

export function removePlayer(wheel, id) {
  const player = wheel.players.find((p) => p.id === id);
  if (!player) return;
  takeSnapshot(`Before removing ${displayName(player)} from “${wheelTitle(wheel)}”`);
  wheel.players = wheel.players.filter((p) => p.id !== id);
  if (wheel.activePlayerId === id) wheel.activePlayerId = wheel.players[0]?.id ?? null;
  if (isShared(wheel)) Object.assign(wheel.shared, freshProgress(wheel)); // now shared: start fresh
  save();
}

export function movePlayer(wheel, id, delta) {
  moveItem(wheel.players, id, delta);
  save();
}

export function setActivePlayer(wheel, id) {
  if (wheel.players.some((p) => p.id === id)) {
    wheel.activePlayerId = id;
    save();
  }
}

function moveItem(list, id, delta) {
  const i = list.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

// ================================================================ Spinning
// `progress` is a player on the wheel, or wheel.shared for a wheel without players.

export function spinsToday(progress, today = todayKey()) {
  return progress.history.filter((h) => h.date === today).length;
}

/** Extra spins a grown-up granted for today. */
export function bonusToday(progress, today = todayKey()) {
  return progress.bonus?.date === today ? progress.bonus.count : 0;
}

/** Spins left today, or Infinity when the wheel has no daily limit. */
export function spinsLeftToday(wheel, progress, today = todayKey()) {
  if (!wheel.spinsPerDay) return Infinity;
  return Math.max(0, wheel.spinsPerDay + bonusToday(progress, today) - spinsToday(progress, today));
}

/** Options currently on the wheel for this progress. */
export function spinPool(wheel, progress) {
  if (!wheel.removeAfterSpin) return wheel.options;
  const remaining = new Set(progress.remaining);
  return wheel.options.filter((o) => remaining.has(o.id));
}

/**
 * Options that have been spun and are now off the wheel, each with its latest history entry.
 * Only counts options that still exist (an option can be deleted after it was spun).
 */
export function openedOptions(wheel, progress) {
  const onWheel = new Set(spinPool(wheel, progress).map((o) => o.id));
  const exists = new Set(wheel.options.map((o) => o.id));
  const opened = new Map();
  for (const entry of progress.history) {
    if (exists.has(entry.optionId) && !onWheel.has(entry.optionId)) opened.set(entry.optionId, entry);
  }
  return opened;
}

/** { ok: true } or { ok: false, reason: 'empty' | 'done' | 'locked' } */
export function spinStatus(wheel, progress) {
  if (!wheel.options.length) return { ok: false, reason: 'empty' };
  if (!spinPool(wheel, progress).length) return { ok: false, reason: 'done' };
  if (spinsLeftToday(wheel, progress) === 0) return { ok: false, reason: 'locked' };
  return { ok: true };
}

export function recordSpin(wheel, progress, option) {
  progress.history.push({ optionId: option.id, label: option.label, date: todayKey(), at: new Date().toISOString() });
  if (wheel.removeAfterSpin) progress.remaining = progress.remaining.filter((id) => id !== option.id);
  return save();
}

export function undoLastSpin(wheel, progress) {
  const last = progress.history.pop();
  if (!last) return null;
  const stillExists = wheel.options.some((o) => o.id === last.optionId);
  if (stillExists && !progress.remaining.includes(last.optionId)) progress.remaining.push(last.optionId);
  save();
  return last;
}

export function allowExtraSpin(progress) {
  const today = todayKey();
  progress.bonus = { date: today, count: bonusToday(progress, today) + 1 };
  save();
}

export function resetProgress(wheel, progress) {
  const who = progress === wheel.shared ? `“${wheelTitle(wheel)}”` : `${displayName(progress)} on “${wheelTitle(wheel)}”`;
  takeSnapshot(`Before resetting ${who}`);
  Object.assign(progress, freshProgress(wheel));
  save();
}
