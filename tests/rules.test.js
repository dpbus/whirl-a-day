// The spin rules shared by the app and the server (public/js/rules.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../public/js/rules.js';

const at = (iso) => new Date(iso);

function wheel({ shared = false, spinsPerDay = 1, timeZone, players = ['Ava', 'Ben'], sharedDailyLimit } = {}) {
  return rules.normalizeWheel({
    title: 'Test',
    options: ['1', '2', '3', '4'].map((label) => ({ id: `o${label}`, label })),
    sharedWheel: shared,
    removeAfterSpin: true,
    spinsPerDay,
    timeZone,
    sharedDailyLimit,
    players: players.map((name) => ({ id: name.toLowerCase(), name })),
  });
}

test('days follow the wheel’s time zone, not the phone’s', () => {
  // 5am UTC on Dec 1 is still Nov 30 in Chicago.
  assert.equal(rules.dayKey(at('2026-12-01T05:00:00Z'), 'America/Chicago'), '2026-11-30');
  assert.equal(rules.dayKey(at('2026-12-01T05:00:00Z'), 'Europe/Berlin'), '2026-12-01');
  const w = wheel({ timeZone: 'America/Chicago' });
  rules.applySpin(w, 'ava', { now: at('2026-12-01T04:00:00Z') }); // Nov 30, 10pm in Chicago
  assert.equal(rules.spinStatus(w, 'ava', at('2026-12-01T05:30:00Z')).reason, 'locked'); // still Nov 30 there
  assert.ok(rules.spinStatus(w, 'ava', at('2026-12-01T06:30:00Z')).ok); // Dec 1 in Chicago
});

test('individual wheels: each player has their own copy and limit', () => {
  const w = wheel();
  const now = at('2026-12-01T12:00:00Z');
  rules.applySpin(w, 'ava', { now });
  assert.equal(rules.spinPool(w, 'ava').length, 3);
  assert.equal(rules.spinPool(w, 'ben').length, 4);
  assert.equal(rules.spinStatus(w, 'ava', now).reason, 'locked');
  assert.ok(rules.spinStatus(w, 'ben', now).ok);
});

test('shared wheels: a spin comes off for everyone; the limit is per person by default', () => {
  const w = wheel({ shared: true });
  const now = at('2026-12-01T12:00:00Z');
  rules.applySpin(w, 'ava', { now });
  assert.equal(rules.spinPool(w, 'ben').length, 3);
  assert.equal(rules.spinStatus(w, 'ava', now).reason, 'locked');
  assert.ok(rules.spinStatus(w, 'ben', now).ok);
});

test('shared wheels with a group limit: the day’s spins are shared, and so are extra spins', () => {
  const w = wheel({ shared: true, sharedDailyLimit: true });
  const now = at('2026-12-01T12:00:00Z');
  rules.applySpin(w, 'ava', { now });
  assert.equal(rules.spinStatus(w, 'ben', now).reason, 'locked');
  rules.applyAction(w, 'extra-spin', { playerId: 'ava' }, { now });
  assert.ok(rules.spinStatus(w, 'ben', now).ok);
});

test('a repeated spin id returns the spin already logged instead of spinning again', () => {
  const w = wheel({ spinsPerDay: 0 });
  const first = rules.applySpin(w, 'ava', { spinId: 'abc' });
  const again = rules.applySpin(w, 'ava', { spinId: 'abc' });
  assert.equal(again.repeated, true);
  assert.equal(again.spin, first.spin);
  assert.equal(w.spins.length, 1);
});

test('spins need a player on an individual wheel, and a known one on any wheel', () => {
  assert.equal(rules.spinStatus(wheel(), null).reason, 'no-player');
  assert.equal(rules.spinStatus(wheel({ shared: true }), 'nobody').reason, 'no-player');
  assert.ok(rules.spinStatus(wheel({ shared: true }), null).ok);
  assert.throws(() => rules.applySpin(wheel(), 'zed'), rules.RuleError);
});

test('undo takes back the player’s own latest spin, or the wheel’s latest when shared', () => {
  const w = wheel({ spinsPerDay: 0 });
  rules.applySpin(w, 'ava');
  const bens = rules.applySpin(w, 'ben').spin;
  assert.equal(rules.applyAction(w, 'undo', { playerId: 'ava' }).playerId, 'ava');
  assert.deepEqual(w.spins, [bens]);

  const s = wheel({ shared: true, spinsPerDay: 0 });
  rules.applySpin(s, 'ava');
  const last = rules.applySpin(s, 'ben').spin;
  assert.equal(rules.applyAction(s, 'undo', { playerId: 'ava' }), last);
});

test('undo with a spin id only takes back that spin, even if a newer one arrived first', () => {
  const w = wheel({ shared: true, spinsPerDay: 0 });
  const older = rules.applySpin(w, 'ava').spin;
  const newer = rules.applySpin(w, 'ben').spin;
  rules.applyAction(w, 'undo', { playerId: null, spinId: older.id });
  assert.deepEqual(w.spins, [newer]);
  assert.equal(rules.applyAction(w, 'undo', { spinId: 'gone' }), null);
});

test('removing a player from a shared wheel keeps their spins, under no name', () => {
  const w = wheel({ shared: true, spinsPerDay: 0 });
  const { option } = rules.applySpin(w, 'ava');
  rules.applyAction(w, 'remove-player', { id: 'ava' });
  assert.equal(w.spins[0].playerId, null);
  assert.ok(!rules.spinPool(w, 'ben').includes(option)); // still off the wheel
  const own = wheel({ spinsPerDay: 0 });
  rules.applySpin(own, 'ava');
  rules.applyAction(own, 'remove-player', { id: 'ava' });
  assert.equal(own.spins.length, 0); // their own copy goes with them
});

test('reset clears one player (or the whole shared wheel)', () => {
  const w = wheel({ spinsPerDay: 0 });
  rules.applySpin(w, 'ava');
  rules.applySpin(w, 'ben');
  rules.applyAction(w, 'reset', { playerId: 'ava' });
  assert.deepEqual(w.spins.map((s) => s.playerId), ['ben']);
  const s = wheel({ shared: true, spinsPerDay: 0 });
  rules.applySpin(s, 'ava');
  rules.applyAction(s, 'reset', { playerId: 'ben' });
  assert.equal(s.spins.length, 0);
});

test('turning "remove after spin" off and on works from the log', () => {
  const w = wheel({ spinsPerDay: 0 });
  rules.applySpin(w, 'ava');
  rules.applyAction(w, 'set-props', { removeAfterSpin: false });
  assert.equal(rules.spinPool(w, 'ava').length, 4);
  rules.applyAction(w, 'set-props', { removeAfterSpin: true });
  assert.equal(rules.spinPool(w, 'ava').length, 3);
});

test('actions use the caller’s ids, so a phone and the server agree on them', () => {
  const w = wheel();
  const [added] = rules.applyAction(w, 'add-options', { options: [{ id: 'new-1', label: 'Five' }] });
  assert.equal(added.id, 'new-1');
  // A clashing or malformed id gets a fresh one instead.
  const [clash] = rules.applyAction(w, 'add-options', { options: [{ id: 'new-1', label: 'Six' }] });
  assert.notEqual(clash.id, 'new-1');
  const [bad] = rules.applyAction(w, 'add-options', { options: [{ id: '<script>', label: 'Seven' }] });
  assert.match(bad.id, /^[\w-]+$/);
});

test('unknown actions and bad arguments are refused', () => {
  const w = wheel();
  for (const name of ['nope', 'constructor', '__proto__', 'toString', 42]) {
    assert.throws(() => rules.applyAction(w, name, {}), (err) => err.code === 'unknown-action');
  }
  assert.throws(() => rules.applyAction(w, 'set-props', { theme: 'constructor' }), (err) => err.code === 'bad-request');
  assert.throws(() => rules.applyAction(w, 'set-props', { timeZone: 'Mars/Olympus' }), (err) => err.code === 'bad-request');
  assert.throws(() => rules.applyAction(w, 'add-options', { options: 'x' }), (err) => err.code === 'bad-request');
});

test('limits: options and players', () => {
  const w = wheel();
  rules.applyAction(w, 'add-options', { options: Array.from({ length: 500 }, (_, i) => ({ label: String(i) })) });
  assert.equal(w.options.length, rules.MAX_OPTIONS);
  assert.throws(() => rules.applyAction(w, 'add-options', { options: [{ label: 'x' }] }), (err) => err.code === 'too-many-options');
  for (let i = 0; i < 30; i++) {
    try {
      rules.applyAction(w, 'add-player', { name: `P${i}` });
    } catch (err) {
      assert.equal(err.code, 'too-many-players');
    }
  }
  assert.equal(w.players.length, rules.MAX_PLAYERS);
});

test('normalizing drops spins of unknown players and bad timestamps, and keeps known fields only', () => {
  const w = rules.normalizeWheel({
    options: [{ id: 'o1', label: 'A' }],
    players: [{ id: 'p1', name: 'A', tokenHash: 'nothex' }],
    spins: [
      { id: 's1', playerId: 'p1', optionId: 'o1', at: '2026-12-01T00:00:00Z' },
      { id: 's2', playerId: 'ghost', optionId: 'o1', at: '2026-12-01T00:00:00Z' },
      { id: 's3', playerId: 'p1', optionId: 'o1', at: 'yesterday-ish' },
    ],
    timeZone: 'Not/AZone',
    sneaky: '<img>',
    __proto__: { polluted: true },
  });
  assert.deepEqual(w.spins.map((s) => s.id), ['s1']);
  assert.equal(w.players[0].tokenHash, undefined);
  assert.equal(w.timeZone, undefined);
  assert.equal(w.sneaky, undefined);
  assert.equal({}.polluted, undefined);
});
