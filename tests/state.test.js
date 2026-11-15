// Run with: npm test   (or: node --test tests/)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshStorage } from './helpers.js';

let storage = freshStorage();
const store = await import('../js/state.js');
const { todayKey } = await import('../js/util.js');

const today = todayKey();
const KEY = store.STORAGE_KEY;
const raw = () => JSON.parse(storage.data.get(KEY));

beforeEach(() => {
  storage = freshStorage();
  store.load();
});

/** The usual setup: a 12 Days wheel for Ava and Ben. */
function advent({ spinsPerDay } = {}) {
  const wheel = store.addWheel({ presetId: 'twelve-days', playerNames: ['Ava', 'Ben'] });
  if (spinsPerDay !== undefined) store.setWheelProps(wheel, { spinsPerDay });
  const [ava, ben] = wheel.players;
  return { wheel, ava, ben };
}

const spinFirst = (wheel, progress) => store.recordSpin(wheel, progress, store.spinPool(wheel, progress)[0]);

// ------------------------------------------------------------ wheels & players

test('a new wheel from a preset gets the preset theme, options and rules', () => {
  const { wheel } = advent();
  assert.equal(wheel.title, '12 Days of Christmas');
  assert.equal(wheel.theme, 'christmas');
  assert.equal(wheel.options.length, 12);
  assert.equal(wheel.spinsPerDay, 1);
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

test('a shared wheel (no players) keeps one shared progress', () => {
  const dinner = store.addWheel({ presetId: 'dinner' });
  const progress = store.activeProgress(dinner);
  assert.equal(progress, dinner.shared);
  spinFirst(dinner, progress);
  spinFirst(dinner, progress);
  assert.equal(dinner.shared.history.length, 2);
  assert.ok(store.spinStatus(dinner, progress).ok); // dinner: no daily limit, nothing removed
});

test('adding options puts them on everyone\'s wheel; removing takes them off', () => {
  const { wheel, ava, ben } = advent();
  spinFirst(wheel, ava);
  const [added] = store.addOptions(wheel, ['13']);
  assert.ok(ava.remaining.includes(added.id) && ben.remaining.includes(added.id) && wheel.shared.remaining.includes(added.id));
  store.removeOption(wheel, added.id);
  assert.ok(!ava.remaining.includes(added.id));
});

test('removing a wheel or player can be undone from a snapshot', () => {
  const { wheel, ava } = advent();
  spinFirst(wheel, ava);
  store.removePlayer(wheel, ava.id);
  assert.equal(wheel.players.length, 1);
  store.restoreSnapshot(store.listSnapshots()[0].at);
  assert.equal(store.activeWheel().players.length, 2);

  store.removeWheel(store.activeWheel().id);
  assert.equal(store.getState().wheels.length, 0);
  store.restoreSnapshot(store.listSnapshots()[0].at);
  assert.equal(store.getState().wheels.length, 1);
  assert.equal(store.activeWheel().players[0].history.length, 1);
});

test('moving wheels and players reorders them', () => {
  const a = store.addWheel({ presetId: 'dinner', title: 'A' });
  const b = store.addWheel({ presetId: 'dinner', title: 'B' });
  store.moveWheel(b.id, -1);
  assert.deepEqual(store.getState().wheels.map((w) => w.title), ['B', 'A']);
  const { wheel } = advent();
  store.movePlayer(wheel, wheel.players[1].id, -1);
  assert.deepEqual(wheel.players.map((p) => p.name), ['Ben', 'Ava']);
  void a;
});

// ------------------------------------------------------------ spinning

test('a spin removes the result from that player only', () => {
  const { wheel, ava, ben } = advent();
  const five = store.spinPool(wheel, ava)[4];
  store.recordSpin(wheel, ava, five);
  assert.equal(store.spinPool(wheel, ava).length, 11);
  assert.ok(!store.spinPool(wheel, ava).some((o) => o.id === five.id));
  assert.equal(store.spinPool(wheel, ben).length, 12);
});

test('one spin per day locks, an extra spin unlocks once, undo gives it back', () => {
  const { wheel, ava } = advent();
  spinFirst(wheel, ava);
  assert.equal(store.spinStatus(wheel, ava).reason, 'locked');
  store.allowExtraSpin(ava);
  assert.ok(store.spinStatus(wheel, ava).ok);
  spinFirst(wheel, ava);
  assert.equal(store.spinStatus(wheel, ava).reason, 'locked');
  store.undoLastSpin(wheel, ava);
  assert.equal(store.spinsLeftToday(wheel, ava), 1);
});

test('spins per day: 2 a day, then locked; 0 means no limit', () => {
  const { wheel, ava } = advent({ spinsPerDay: 2 });
  spinFirst(wheel, ava);
  assert.equal(store.spinsLeftToday(wheel, ava), 1);
  spinFirst(wheel, ava);
  assert.equal(store.spinStatus(wheel, ava).reason, 'locked');
  store.setWheelProps(wheel, { spinsPerDay: 0 });
  assert.equal(store.spinsLeftToday(wheel, ava), Infinity);
});

test('wheel reports done after every option is spun', () => {
  const { wheel, ben } = advent({ spinsPerDay: 0 });
  while (store.spinPool(wheel, ben).length) spinFirst(wheel, ben);
  assert.equal(store.spinStatus(wheel, ben).reason, 'done');
});

test('turning "remove after spin" back on removes already-spun options for everyone', () => {
  const { wheel, ava } = advent();
  spinFirst(wheel, ava);
  store.setWheelProps(wheel, { removeAfterSpin: false });
  assert.equal(store.spinPool(wheel, ava).length, 12);
  store.setWheelProps(wheel, { removeAfterSpin: true });
  assert.equal(store.spinPool(wheel, ava).length, 11);
});

test('loading a preset resets every player on that wheel', () => {
  const { wheel, ava, ben } = advent();
  spinFirst(wheel, ava);
  spinFirst(wheel, ben);
  store.loadPreset(wheel, 'advent-24');
  assert.equal(wheel.options.length, 24);
  assert.equal(ava.history.length + ben.history.length, 0);
  assert.equal(store.spinPool(wheel, ava).length, 24);
});

// ------------------------------------------------------------ persistence & backups

test('progress survives a reload', () => {
  const { wheel, ava } = advent();
  spinFirst(wheel, ava);
  store.load();
  assert.equal(store.activeWheel().players[0].history.length, 1);
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

// ------------------------------------------------------------ migration from older versions

test('v2: players with identical wheels merge into one wheel; progress is kept and remapped', () => {
  const opts = (prefix) => ['1', '2', '3'].map((label) => ({ id: `${prefix}-${label}`, label, surprise: '' }));
  const v2 = {
    version: 2,
    activePlayerId: 'b',
    settings: { theme: 'christmas', pin: '4321' },
    players: [
      { id: 'a', name: 'Ava', wheel: { title: '12 Days', options: opts('a'), removeAfterSpin: true, spinsPerDay: 1 }, remaining: ['a-2', 'a-3'], history: [{ optionId: 'a-1', label: '1', date: '2026-12-01' }] },
      { id: 'b', name: 'Ben', wheel: { title: '12 Days', options: opts('b'), removeAfterSpin: true, spinsPerDay: 1 }, remaining: ['b-1', 'b-3'], history: [{ optionId: 'b-2', label: '2', date: '2026-12-01' }] },
      { id: 'c', name: 'Cy', wheel: { title: 'Chores', options: [{ id: 'x', label: 'Dishes' }], removeAfterSpin: true, spinsPerDay: 0 }, remaining: ['x'], history: [] },
    ],
  };
  const s = store.parseBackup(v2);
  assert.equal(s.wheels.length, 2);
  const [xmas, chores] = s.wheels;
  assert.deepEqual(xmas.players.map((p) => p.name), ['Ava', 'Ben']);
  assert.equal(xmas.theme, 'christmas');
  assert.equal(s.activeWheelId, xmas.id);
  assert.equal(xmas.activePlayerId, 'b');
  const [ava, ben] = xmas.players;
  const label = (id) => xmas.options.find((o) => o.id === id)?.label;
  assert.equal(label(ava.history[0].optionId), '1');
  assert.equal(label(ben.history[0].optionId), '2');
  assert.deepEqual(store.spinPool(xmas, ava).map((o) => o.label), ['2', '3']);
  assert.deepEqual(store.spinPool(xmas, ben).map((o) => o.label), ['1', '3']);
  assert.deepEqual(chores.players.map((p) => p.name), ['Cy']);
});

test('v1 data (dailyLock / extraSpinDate) is migrated', () => {
  const s = store.parseBackup({
    players: [
      {
        id: 'a',
        name: 'Ava',
        wheel: { options: [{ id: '1', label: '1' }, { id: '2', label: '2' }], dailyLock: true },
        history: [{ optionId: '1', label: '1', date: today }],
        remaining: ['2'],
        extraSpinDate: today,
      },
    ],
  });
  const wheel = s.wheels[0];
  assert.equal(wheel.spinsPerDay, 1);
  assert.deepEqual(wheel.players[0].bonus, { date: today, count: 1 });
  assert.equal(store.spinsLeftToday(wheel, wheel.players[0]), 1);
});

test('an old save on this device is upgraded on load', () => {
  storage.data.set(KEY, JSON.stringify({ version: 2, players: [{ id: 'a', name: 'Ava', wheel: { title: 'X', options: [{ id: '1', label: '1' }] } }] }));
  store.load();
  assert.equal(store.getState().version, 3);
  assert.equal(store.activeWheel().players[0].name, 'Ava');
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

// ------------------------------------------------------------ safety nets

test('unreadable saved data is set aside and the newest snapshot is loaded', () => {
  const { wheel, ava } = advent();
  spinFirst(wheel, ava);
  store.takeSnapshot('test');
  storage.data.set(KEY, '{"wheels": [ broken');
  store.load();
  assert.equal(store.getLoadProblem(), 'unreadable');
  assert.ok(store.getRecoveredFrom());
  assert.equal(store.activeWheel().players[0].history.length, 1);
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
  assert.equal(spinFirst(wheel, ava), false);
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
  assert.equal(store.getState().wheels[0].players[0].history.length, 1);

  await new Promise((r) => setTimeout(r, 2)); // distinct timestamps
  store.eraseAll();
  store.restoreSnapshot(store.listSnapshots()[0].at);
  assert.equal(store.getState().wheels.length, 2);
  assert.throws(() => store.restoreSnapshot('no-such-time'), /no longer exists/);
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
  const spun = store.spinPool(wheel, ava)[0];
  store.recordSpin(wheel, ava, spun);
  store.updateOption(wheel, spun.id, { label: '' });
  store.addOptions(wheel, ['']);
  const before = wheel.options.length;
  store.pruneBlankOptions();
  assert.equal(wheel.options.length, before - 1);
  assert.ok(wheel.options.some((o) => o.id === spun.id));
});

// ------------------------------------------------------------ added after the second review

test('data from a newer app version is refused, never overwritten', () => {
  assert.throws(() => store.parseBackup({ version: store.SCHEMA_VERSION + 1, wheels: [] }), store.NewerVersionError);
  const newer = JSON.stringify({ version: store.SCHEMA_VERSION + 1, wheels: [], futureField: true });
  storage.data.set(KEY, newer);
  store.load();
  assert.equal(store.getLoadProblem(), 'newer-version');
  store.addWheel({ presetId: 'dinner' });
  assert.equal(storage.data.get(KEY), newer);
});

test('huge or crafted data is capped', () => {
  const options = Array.from({ length: 5000 }, (_, i) => ({ label: String(i) }));
  const players = Array.from({ length: 100 }, (_, i) => ({ name: `P${i}`, history: Array.from({ length: 3000 }, () => ({ optionId: 'x' })) }));
  const s = store.parseBackup({ wheels: Array.from({ length: 80 }, () => ({ options, players })) });
  assert.equal(s.wheels.length, store.MAX_WHEELS);
  assert.equal(s.wheels[0].options.length, store.MAX_OPTIONS);
  assert.equal(s.wheels[0].players.length, store.MAX_PLAYERS);
  assert.ok(s.wheels[0].players[0].history.length <= 1000);
});

test('addOptions only adds what fits', () => {
  const wheel = store.addWheel({ presetId: 'blank' });
  const added = store.addOptions(wheel, Array.from({ length: store.MAX_OPTIONS + 50 }, (_, i) => String(i)));
  assert.equal(added.length, store.MAX_OPTIONS);
  assert.equal(store.optionRoom(wheel), 0);
});

test('"opened" ignores spun options that were later deleted', () => {
  const { wheel, ava } = advent({ spinsPerDay: 0 });
  for (let i = 0; i < 3; i++) spinFirst(wheel, ava);
  store.removeOption(wheel, ava.history[0].optionId);
  assert.equal(store.openedOptions(wheel, ava).size, 2);
});

test('adding the first player clears shared spins (after a snapshot); removing the last starts fresh', () => {
  const wheel = store.addWheel({ presetId: 'twelve-days' });
  spinFirst(wheel, wheel.shared);
  store.addPlayer(wheel, 'Ava');
  assert.equal(wheel.shared.history.length, 0);
  assert.match(store.listSnapshots()[0].reason, /first player/);
  spinFirst(wheel, wheel.players[0]);
  store.removePlayer(wheel, wheel.players[0].id);
  assert.equal(wheel.shared.history.length, 0);
  assert.equal(store.spinPool(wheel, wheel.shared).length, 12);
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
