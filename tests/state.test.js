// This device's data (public/js/state.js): wheels, saving, snapshots, backups, online pointers.
// Run with: npm test   (or: node --test tests/)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshStorage } from './helpers.js';

let storage = freshStorage();
const store = await import('../public/js/state.js');

const KEY = store.STORAGE_KEY;
const raw = () => JSON.parse(storage.data.get(KEY));
const WHEEL_ID = 'a'.repeat(64);
const TOKEN = 'abcdefghijklmnopqrstuv';

beforeEach(() => {
  storage = freshStorage();
  store.load();
});

/** The usual setup: a 12 Days wheel for Ava and Ben (their player ids). */
function advent({ spinsPerDay } = {}) {
  const wheel = store.addWheel({ presetId: 'twelve-days', playerNames: ['Ava', 'Ben'] });
  if (spinsPerDay !== undefined) store.setWheelProps(wheel, { spinsPerDay });
  const [ava, ben] = wheel.players.map((p) => p.id);
  return { wheel, ava, ben };
}

const spinFirst = (wheel, playerId) => store.spinLocal(wheel, playerId);
const spinsOf = (wheel, playerId) => wheel.spins.filter((s) => s.playerId === playerId).length;

// ------------------------------------------------------------ wheels & players

test('a new wheel from a preset gets the preset theme, options and rules', () => {
  const { wheel } = advent();
  assert.equal(wheel.title, '12 Days of Christmas');
  assert.equal(wheel.theme, 'christmas');
  assert.equal(wheel.options.length, 12);
  assert.equal(wheel.spinsPerDay, 1);
  assert.equal(wheel.sharedWheel, false);
  assert.equal(store.activeWheel(), wheel);
  assert.equal(store.activePlayer(wheel).name, 'Ava');
});

test('several wheels: each keeps its own options, players and theme', () => {
  const { wheel: xmas } = advent();
  const dinner = store.addWheel({ presetId: 'dinner' });
  assert.equal(store.getState().wheels.length, 2);
  assert.equal(store.activeWheel(), dinner);
  assert.ok(store.isShared(dinner));
  assert.equal(dinner.theme, 'classic'); // no preset theme → app default
  store.setActiveWheel(xmas.id);
  assert.equal(store.activeWheel(), xmas);
});

test('a shared wheel (no players) logs spins by nobody in particular', () => {
  const dinner = store.addWheel({ presetId: 'dinner' });
  assert.equal(store.activePlayerId(dinner), null);
  spinFirst(dinner, null);
  spinFirst(dinner, null);
  assert.equal(dinner.spins.length, 2);
  assert.ok(dinner.spins.every((s) => s.playerId === null));
  assert.ok(store.spinStatus(dinner, null).ok); // dinner: no daily limit, nothing removed
});

test("adding options puts them on everyone's wheel; removing takes them off", () => {
  const { wheel, ava, ben } = advent();
  spinFirst(wheel, ava);
  const [added] = store.addOptions(wheel, ['13']);
  assert.ok(store.spinPool(wheel, ava).includes(added) && store.spinPool(wheel, ben).includes(added));
  store.removeOption(wheel, added.id);
  assert.ok(!store.spinPool(wheel, ava).includes(added));
});

test('removing a wheel or player can be undone from a snapshot', () => {
  const { wheel, ava } = advent();
  spinFirst(wheel, ava);
  store.removePlayer(wheel, ava);
  assert.equal(wheel.players.length, 1);
  assert.equal(wheel.spins.length, 0); // their spins go with them
  store.restoreSnapshot(store.listSnapshots()[0].at);
  assert.equal(store.activeWheel().players.length, 2);

  store.removeWheel(store.activeWheel().id);
  assert.equal(store.getState().wheels.length, 0);
  store.restoreSnapshot(store.listSnapshots()[0].at);
  assert.equal(store.getState().wheels.length, 1);
  assert.equal(store.activeWheel().spins.length, 1);
});

// ------------------------------------------------------------ spinning

test('a spin removes the result from that player only', () => {
  const { wheel, ava, ben } = advent();
  const { option } = spinFirst(wheel, ava);
  assert.equal(store.spinPool(wheel, ava).length, 11);
  assert.ok(!store.spinPool(wheel, ava).includes(option));
  assert.equal(store.spinPool(wheel, ben).length, 12);
});

test('one spin per day locks, an extra spin unlocks once, undo gives it back', () => {
  const { wheel, ava } = advent();
  spinFirst(wheel, ava);
  assert.equal(store.spinStatus(wheel, ava).reason, 'locked');
  store.allowExtraSpin(wheel, ava);
  assert.ok(store.spinStatus(wheel, ava).ok);
  spinFirst(wheel, ava);
  assert.equal(store.spinStatus(wheel, ava).reason, 'locked');
  store.undoLastSpin(wheel, ava);
  assert.equal(store.spinsLeftToday(wheel, ava), 1);
});

test('adding the first player clears shared spins (after a snapshot); removing the last starts fresh', () => {
  const wheel = store.addWheel({ presetId: 'twelve-days' });
  spinFirst(wheel, null);
  store.addPlayer(wheel, 'Ava');
  assert.equal(wheel.sharedWheel, false);
  assert.equal(wheel.spins.length, 0);
  assert.match(store.listSnapshots()[0].reason, /first player/);
  spinFirst(wheel, wheel.players[0].id);
  store.removePlayer(wheel, wheel.players[0].id);
  assert.equal(wheel.sharedWheel, true);
  assert.equal(wheel.spins.length, 0);
  assert.equal(store.spinPool(wheel, null).length, 12);
});

// ------------------------------------------------------------ persistence & backups

test('progress survives a reload', () => {
  const { wheel, ava } = advent();
  spinFirst(wheel, ava);
  store.load();
  assert.equal(spinsOf(store.activeWheel(), ava), 1);
});

test('typing edits are saved after a pause, or immediately on flush', () => {
  const { wheel } = advent();
  store.updateOption(wheel, wheel.options[0].id, { surprise: 'Hot cocoa' });
  assert.equal(raw().wheels[0].options[0].surprise, '');
  store.flushSave();
  assert.equal(raw().wheels[0].options[0].surprise, 'Hot cocoa');
});

test('backup round-trip; the PIN is never written to a backup file', () => {
  advent();
  store.updateSettings({ pin: '1234' });
  const json = store.exportJson();
  assert.ok(!json.includes('1234'));
  assert.equal(store.parseBackup(JSON.parse(json)).wheels[0].players.length, 2);
});

test("restoring a backup keeps this device's PIN", () => {
  advent();
  store.updateSettings({ pin: '1111' });
  const backup = JSON.parse(store.exportJson());
  backup.settings.pin = '9999';
  store.replaceState(store.parseBackup(backup));
  assert.equal(store.getState().settings.pin, '1111');
});

test('rejects things that are not backups', () => {
  for (const bad of [null, 42, 'x', [], {}, { players: 'nope' }, { wheels: 'nope' }]) {
    assert.throws(() => store.parseBackup(bad), /backup/);
  }
});

test('backups from before online wheels are refused as older, not newer', () => {
  for (const old of [{ version: 3, wheels: [] }, { version: 2, players: [] }, { version: 1, players: [] }]) {
    assert.throws(() => store.parseBackup(old), /older version/);
  }
  assert.equal(store.parseBackup(JSON.parse(store.exportJson())).version, store.SCHEMA_VERSION);
});

// ------------------------------------------------------------ online wheels on this device

function onlineWheel(role = 'host') {
  const serverWheel = {
    id: WHEEL_ID,
    title: 'Game night',
    options: [{ id: 'o1', label: 'Charades', surprise: '' }, { id: 'o2', label: 'Pictionary', surprise: '' }],
    sharedWheel: true,
    removeAfterSpin: false,
    players: [{ id: 'p1', name: 'Maya', claimed: true, tokenHash: 'f'.repeat(64) }],
    spins: [{ id: 's1', playerId: 'p1', optionId: 'o1', at: '2026-12-01T20:00:00.000Z' }],
    bonusSpins: [],
    timeZone: 'America/Chicago',
  };
  return store.addOnlineWheel(serverWheel, { wheelId: WHEEL_ID, role, token: TOKEN, playerId: role === 'player' ? 'p1' : null, joinCode: 'ABCD2345' });
}

test('an online wheel keeps its kind, players and pointer; token hashes are never kept', () => {
  const wheel = onlineWheel();
  assert.equal(wheel.sharedWheel, true); // shared, even though it has players
  assert.equal(wheel.players[0].claimed, true);
  assert.equal(wheel.players[0].tokenHash, undefined);
  assert.equal(store.roleOf(wheel), 'host');
  assert.equal(wheel.online.joinCode, 'ABCD2345');
  store.load();
  assert.equal(store.activeWheel().online.token, TOKEN);
  assert.equal(store.activeWheel().sharedWheel, true);
});

test("the host's own name comes from the server and only counts on the host's device", () => {
  const wheel = onlineWheel();
  store.applyServerWheel(wheel, wheel, { hostPlayerId: 'p1' });
  assert.equal(store.isHostPlayer(wheel, 'p1'), true);
  store.applyServerWheel(wheel, wheel, { hostPlayerId: 'ghost' });
  assert.equal(wheel.online.hostPlayerId, null);
});

test('a phone that joined spins as itself and cannot manage the wheel', () => {
  const wheel = onlineWheel('player');
  assert.equal(store.activePlayerId(wheel), 'p1');
  assert.equal(store.canManage(wheel), false);
});

test('backups never include online sign-in tokens; restored online wheels are signed out', () => {
  onlineWheel();
  const json = store.exportJson();
  assert.ok(!json.includes(TOKEN));
  const restored = store.parseBackup(JSON.parse(json));
  assert.equal(restored.wheels[0].online.wheelId, WHEEL_ID);
  assert.ok(store.isSignedOut(restored.wheels[0]));
});

test("the server's copy replaces an online wheel in place", () => {
  const wheel = onlineWheel();
  store.applyServerWheel(wheel, { ...wheel, title: 'Renamed', spins: [] }, { joinOpen: false });
  assert.equal(store.activeWheel(), wheel); // same object, so screens keep their reference
  assert.equal(wheel.title, 'Renamed');
  assert.equal(wheel.spins.length, 0);
  assert.equal(wheel.online.joinOpen, false);
  assert.equal(wheel.online.token, TOKEN);
});

test("the server's copy is only saved when it changes something", () => {
  const wheel = onlineWheel();
  const writes = () => storage.data.get(KEY);
  const saved = writes();
  storage.data.set(KEY, saved.replace('"activeWheelId"', '"activeWheelId" ')); // another tab's equivalent save
  store.applyServerWheel(wheel, { ...wheel }, {});
  assert.notEqual(writes(), saved); // untouched: nothing changed, so nothing was written
});

test('changes to an online wheel apply to the copy and are sent on', async () => {
  const sent = [];
  store.setOnlineSender((wheel, name, args) => {
    sent.push([name, args]);
    return Promise.resolve();
  });
  const wheel = onlineWheel();
  store.setWheelProps(wheel, { spinsPerDay: 2 });
  assert.equal(wheel.spinsPerDay, 2);
  assert.deepEqual(sent, [['set-props', { spinsPerDay: 2 }]]);
  store.setOnlineSender(() => Promise.resolve());
});

test('taking a shared online wheel offline keeps its spins as nobody’s', () => {
  const wheel = onlineWheel();
  store.makeLocal(wheel);
  assert.equal(wheel.online, undefined);
  assert.equal(wheel.players.length, 0);
  assert.equal(wheel.sharedWheel, true);
  assert.equal(wheel.spins[0].playerId, null);
  store.load();
  assert.equal(store.activeWheel().spins.length, 1);
});

test('a malformed online pointer is dropped; the wheel stays as a local one', () => {
  const s = store.parseBackup({ wheels: [{ title: 'W', online: { wheelId: 'nope', role: 'host' } }] });
  assert.equal(s.wheels[0].online, undefined);
});

// ------------------------------------------------------------ hostile / damaged input

test('unknown or prototype theme names fall back to the default', () => {
  for (const theme of ['constructor', '__proto__', 'toString', 'nope', 42]) {
    const s = store.parseBackup({ wheels: [{ title: 'W', theme }], settings: { theme } });
    assert.equal(s.settings.theme, 'classic');
    assert.equal(s.wheels[0].theme, 'classic');
  }
});

test('settings with wrong types are replaced with safe defaults', () => {
  const s = store.parseBackup({
    wheels: [],
    settings: { lastBackup: 20241201, pin: 1234, sound: 'yes', confetti: null, spinSeconds: 'fast', tickSound: '<img>' },
  }).settings;
  assert.equal(s.lastBackup, null);
  assert.equal(s.pin, '');
  assert.equal(s.sound, true);
  assert.equal(s.confetti, true);
  assert.equal(s.spinSeconds, 6);
  assert.equal(s.tickSound, 'auto');
});

test('duplicate wheel, player and option ids are repaired', () => {
  const wheel = { id: 'w', players: [{ id: 'p', name: 'A' }, { id: 'p', name: 'B' }], options: [{ id: 'o', label: 'A' }, { id: 'o', label: 'B' }] };
  const s = store.parseBackup({ wheels: [wheel, structuredClone(wheel)] });
  assert.notEqual(s.wheels[0].id, s.wheels[1].id);
  assert.notEqual(s.wheels[0].players[0].id, s.wheels[0].players[1].id);
  assert.notEqual(s.wheels[0].options[0].id, s.wheels[0].options[1].id);
});

test('over-long text and out-of-range numbers are bounded', () => {
  const s = store.parseBackup({
    wheels: [{ title: 't'.repeat(500), spinsPerDay: 999, players: [{ name: 'x'.repeat(500) }], options: [{ label: 'y'.repeat(500), surprise: 'z'.repeat(5000) }] }],
  });
  const w = s.wheels[0];
  assert.equal(w.title.length, store.MAX_TITLE_LENGTH);
  assert.equal(w.players[0].name.length, store.MAX_NAME_LENGTH);
  assert.equal(w.options[0].label.length, store.MAX_LABEL_LENGTH);
  assert.equal(w.options[0].surprise.length, store.MAX_SURPRISE_LENGTH);
  assert.equal(w.spinsPerDay, store.MAX_SPINS_PER_DAY);
});

test('huge or crafted data is capped', () => {
  const options = Array.from({ length: 5000 }, (_, i) => ({ id: `o${i}`, label: String(i) }));
  const players = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const spins = Array.from({ length: 10_000 }, () => ({ playerId: 'p0', optionId: 'o1', at: '2026-12-01T00:00:00Z' }));
  const s = store.parseBackup({ wheels: Array.from({ length: 80 }, () => ({ options, players, spins })) });
  assert.equal(s.wheels.length, store.MAX_WHEELS);
  assert.equal(s.wheels[0].options.length, store.MAX_OPTIONS);
  assert.equal(s.wheels[0].players.length, store.MAX_PLAYERS);
  assert.ok(s.wheels[0].spins.length <= 3000);
});

// ------------------------------------------------------------ safety nets

test('unreadable saved data is set aside and the newest snapshot is loaded', () => {
  const { wheel, ava } = advent();
  spinFirst(wheel, ava);
  store.takeSnapshot('test');
  storage.data.set(KEY, '{"wheels": [ broken');
  store.load();
  assert.equal(store.getLoadProblem(), 'unreadable');
  assert.ok(store.getRecoveredFrom());
  assert.equal(spinsOf(store.activeWheel(), ava), 1);
  assert.equal(store.listUnreadableData()[0].raw, '{"wheels": [ broken');
});

test('if unreadable data cannot be set aside, it is never overwritten', () => {
  advent();
  const broken = '{"wheels": [ ' + 'x'.repeat(100);
  storage.data.set(KEY, broken);
  storage.quota = 50; // too small to copy the broken data anywhere
  store.load();
  assert.equal(store.getLoadProblem(), 'unreadable-readonly');
  store.addWheel({ presetId: 'dinner' });
  assert.equal(storage.data.get(KEY), broken);
  assert.equal(store.saveHealthy(), false);
});

test('a failed save is reported, and recovers once storage works', () => {
  const { wheel, ava } = advent();
  storage.quota = 10;
  spinFirst(wheel, ava);
  assert.equal(store.saveHealthy(), false);
  storage.quota = Infinity;
  store.save();
  assert.equal(store.saveHealthy(), true);
});

test('blocked storage is detected', () => {
  storage.blocked = true;
  store.load();
  assert.equal(store.getLoadProblem(), 'unavailable');
});

test('reset and erase can be undone from snapshots (by timestamp); summaries describe each wheel', async () => {
  const { wheel, ava } = advent();
  store.addWheel({ presetId: 'dinner' });
  spinFirst(wheel, ava);
  store.resetProgress(wheel, ava);
  const snap = store.listSnapshots().find((s) => s.reason.startsWith('Before resetting'));
  assert.match(snap.summary, /12 Days of Christmas: Ava 1, Ben 0 · What's for Dinner\?: 0 spins/);
  store.restoreSnapshot(snap.at);
  assert.equal(spinsOf(store.getState().wheels[0], ava), 1);

  await new Promise((r) => setTimeout(r, 2)); // distinct timestamps
  store.eraseAll();
  store.restoreSnapshot(store.listSnapshots()[0].at);
  assert.equal(store.getState().wheels.length, 2);
  assert.throws(() => store.restoreSnapshot('no-such-time'), /no longer exists/);
});

test("reloading another tab's save updates wheels in place and keeps this tab's wheel", () => {
  const { wheel } = advent();
  const dinner = store.addWheel({ presetId: 'dinner' });
  store.setActiveWheel(wheel.id);
  const other = raw();
  other.activeWheelId = dinner.id; // the other tab switched wheels…
  other.wheels[0].title = 'Renamed elsewhere'; // …and changed this one
  storage.data.set(KEY, JSON.stringify(other));
  store.reloadFromStorage();
  assert.equal(store.activeWheel(), wheel); // same object, still shown here
  assert.equal(wheel.title, 'Renamed elsewhere');
});

test('changes from another tab are detected', () => {
  advent();
  assert.equal(store.storageChangedElsewhere(), false);
  const other = raw();
  other.wheels[0].title = 'Changed elsewhere';
  storage.data.set(KEY, JSON.stringify(other));
  assert.equal(store.storageChangedElsewhere(), true);
  store.load();
  assert.equal(store.activeWheel().title, 'Changed elsewhere');
});

test('pruning removes blank new options but never spun ones', () => {
  const { wheel, ava } = advent();
  const { option: spun } = spinFirst(wheel, ava);
  store.updateOption(wheel, spun.id, { label: '' });
  store.addOptions(wheel, ['']);
  const before = wheel.options.length;
  store.pruneBlankOptions();
  assert.equal(wheel.options.length, before - 1);
  assert.ok(wheel.options.some((o) => o.id === spun.id));
});

test('data from a newer app version is refused, never overwritten', () => {
  assert.throws(() => store.parseBackup({ version: store.SCHEMA_VERSION + 1, wheels: [] }), store.NewerVersionError);
  const newer = JSON.stringify({ version: store.SCHEMA_VERSION + 1, wheels: [], futureField: true });
  storage.data.set(KEY, newer);
  store.load();
  assert.equal(store.getLoadProblem(), 'newer-version');
  store.addWheel({ presetId: 'dinner' });
  assert.equal(storage.data.get(KEY), newer);
});

test('addOptions only adds what fits', () => {
  const wheel = store.addWheel({ presetId: 'blank' });
  const added = store.addOptions(wheel, Array.from({ length: store.MAX_OPTIONS + 50 }, (_, i) => String(i)));
  assert.equal(added.length, store.MAX_OPTIONS);
  assert.equal(store.optionRoom(wheel), 0);
});

test('restoring a backup ends read-only mode and saves; erase clears the warning', () => {
  advent();
  const backup = store.parseBackup(JSON.parse(store.exportJson()));
  storage.data.set(KEY, '{ broken' + 'x'.repeat(100));
  storage.quota = 60;
  store.load();
  assert.equal(store.isReadOnly(), true);
  storage.quota = Infinity;
  store.replaceState(backup);
  assert.equal(store.isReadOnly(), false);
  assert.equal(store.getLoadProblem(), null);
  assert.equal(raw().wheels.length, 1);

  storage.data.set(KEY, '{ broken again');
  store.load();
  assert.equal(store.getLoadProblem(), 'unreadable');
  store.eraseAll();
  assert.equal(store.getLoadProblem(), null);
});

test('reloading clears an old save error', () => {
  const { wheel, ava } = advent();
  storage.quota = 10;
  spinFirst(wheel, ava);
  assert.equal(store.saveHealthy(), false);
  storage.quota = Infinity;
  store.load();
  assert.equal(store.saveHealthy(), true);
});

test('unknown tick sounds fall back to "auto"', () => {
  for (const tickSound of ['bell', 'constructor', 'chime']) {
    const expected = tickSound === 'chime' ? 'chime' : 'auto';
    assert.equal(store.parseBackup({ wheels: [], settings: { tickSound } }).settings.tickSound, expected);
  }
});
