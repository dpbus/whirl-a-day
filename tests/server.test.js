// The server's logic (server/room.js and server/directory.js), run in plain Node with an
// in-memory stand-in for Durable Object storage and sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WheelRoom, ACTIVE_DAYS, MAX_MESSAGE_LENGTH, CLOSE_GONE, CLOSE_SIGNED_OUT, sha256hex } from '../server/room.js';
import { DirectoryLogic, isJoinCode, CREATES_PER_HOUR } from '../server/directory.js';

const DAY = 24 * 60 * 60 * 1000;
const WHEEL_ID = 'b'.repeat(64);

class FakeStorage {
  constructor() {
    this.map = new Map();
    this.alarm = null;
    this.writes = 0;
  }
  async get(key) {
    return structuredClone(this.map.get(key));
  }
  async put(key, value) {
    this.writes++;
    this.map.set(key, structuredClone(value));
  }
  async delete(key) {
    this.map.delete(key);
  }
  async deleteAll() {
    this.map.clear();
  }
  async setAlarm(at) {
    this.alarm = at;
  }
  async deleteAlarm() {
    this.alarm = null;
  }
}

class FakeSocket {
  constructor() {
    this.sent = [];
    this.closed = null;
    this.attachment = null;
  }
  send(text) {
    if (this.closed) throw new Error('closed');
    this.sent.push(JSON.parse(text));
  }
  close(code) {
    this.closed = code;
  }
  serializeAttachment(value) {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment() {
    return this.attachment;
  }
  last(type) {
    return this.sent.findLast((m) => !type || m.type === type);
  }
}

/** A room with a clock we control, plus helpers to connect phones. */
async function setup({ shared = false, spinsPerDay = 1, players = ['Ava', 'Ben'] } = {}) {
  let clock = Date.parse('2026-12-01T15:00:00Z');
  const storage = new FakeStorage();
  const sockets = [];
  const ctx = { storage, getWebSockets: () => sockets.filter((s) => !s.closed) };
  const released = [];
  const directory = {
    allocate: async () => 'NEWCODE2',
    release: async (code) => released.push(code),
  };
  const now = () => new Date(clock);
  const room = new WheelRoom(ctx, { directory, now });
  const hostSecret = 'host-secret-0123456789';
  const created = await room.create({
    wheel: {
      title: 'Advent',
      options: ['1', '2', '3'].map((label) => ({ id: `o${label}`, label, surprise: `Surprise ${label}` })),
      removeAfterSpin: true,
      spinsPerDay,
      players: players.map((name) => ({ id: name.toLowerCase(), name, tokenHash: 'f'.repeat(64) })),
    },
    sharedWheel: shared,
    timeZone: 'America/Chicago',
    wheelId: WHEEL_ID,
    joinCode: 'ABCD2345',
    hostTokenHash: await sha256hex(hostSecret),
  });

  const connect = async (token) => {
    const ws = new FakeSocket();
    sockets.push(ws);
    await room.message(ws, JSON.stringify({ type: 'hello', token }));
    return ws;
  };
  let n = 0;
  const send = async (ws, message) => {
    const reqId = `r${++n}`;
    await room.message(ws, JSON.stringify({ ...message, reqId }));
    return ws.sent.find((m) => m.type === 'ack' && m.reqId === reqId);
  };
  // Fresh rooms after a "restart" read everything back from storage.
  const restart = () => new WheelRoom(ctx, { directory, now });
  return {
    room,
    created,
    storage,
    released,
    hostSecret,
    connect,
    send,
    restart,
    tick: (ms) => (clock += ms),
  };
}

test('creating a wheel: names start unclaimed, a time zone is kept, the host view has no hashes', async () => {
  const { created, storage } = await setup();
  assert.equal(created.ok, true);
  assert.deepEqual(created.wheel.players.map((p) => p.claimed), [false, false]);
  assert.ok(!JSON.stringify(created).includes('tokenHash'));
  assert.equal(created.wheel.timeZone, 'America/Chicago');
  assert.equal(created.meta.joinCode, 'ABCD2345');
  assert.ok(storage.alarm > Date.now());
});

test('joining: tap a name or type one; a claimed name cannot be taken twice', async () => {
  const { room } = await setup();
  const ava = await room.join({ joinCode: 'ABCD2345', playerId: 'ava' });
  assert.equal(ava.ok, true);
  assert.equal(ava.playerId, 'ava');
  assert.match(ava.token, /^[\w-]{22}$/);
  assert.deepEqual(await room.join({ joinCode: 'ABCD2345', playerId: 'ava' }), { ok: false, error: 'name-taken' });
  assert.deepEqual(await room.join({ joinCode: 'ABCD2345', name: ' AVA ' }), { ok: false, error: 'name-taken' }); // same name, any case
  const cleo = await room.join({ joinCode: 'ABCD2345', name: 'Cleo' });
  assert.equal(cleo.ok, true);
  assert.equal((await room.info()).players.length, 3);
  assert.deepEqual(await room.join({ joinCode: 'ABCD2345', name: '   ' }), { ok: false, error: 'name-needed' });
});

test('closed joining refuses new phones', async () => {
  const { room, connect, send, hostSecret } = await setup();
  const host = await connect(hostSecret);
  assert.equal((await send(host, { type: 'act', name: 'set-join-open', args: { open: false } })).ok, true);
  assert.deepEqual(await room.join({ joinCode: 'ABCD2345', playerId: 'ben' }), { ok: false, error: 'join-closed' });
});

test('signing in: the host, a player, and a wrong token', async () => {
  const { room, connect, hostSecret } = await setup();
  const { token } = await room.join({ joinCode: 'ABCD2345', playerId: 'ava' });
  const host = await connect(hostSecret);
  assert.equal(host.last('state').role, 'host');
  const ava = await connect(token);
  assert.equal(ava.last('state').role, 'player');
  assert.equal(ava.last('state').playerId, 'ava');
  const stranger = await connect('not-a-real-token-at-all');
  assert.equal(stranger.last().code, 'auth');
  assert.equal(stranger.closed, CLOSE_SIGNED_OUT);
});

test('players only see their own spins and the surprises they have spun', async () => {
  const { room, connect, send } = await setup({ spinsPerDay: 0 });
  const ava = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).token);
  const ben = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ben' })).token);
  await send(ava, { type: 'spin', spinId: 'a1' });
  const spun = ava.last('spun');
  assert.equal(spun.spin.playerId, 'ava');
  const mine = spun.wheel.options.find((o) => o.id === spun.spin.optionId);
  assert.match(mine.surprise, /Surprise/);
  assert.ok(spun.wheel.options.filter((o) => o.id !== spun.spin.optionId).every((o) => o.surprise === ''));
  assert.equal(ben.last('spun'), undefined); // Ben doesn't see Ava's spin
  assert.ok(!JSON.stringify(ava.sent).includes('tokenHash'));
});

test('sharing spins lets players see each other’s results, but not their surprises', async () => {
  const { room, connect, send, hostSecret } = await setup({ spinsPerDay: 0 });
  const host = await connect(hostSecret);
  await send(host, { type: 'act', name: 'set-props', args: { showSpinsToEveryone: true } });
  const ava = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).token);
  const ben = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ben' })).token);
  await send(ava, { type: 'spin' });
  const seen = ben.last('spun');
  assert.equal(seen.spin.playerId, 'ava');
  assert.equal(seen.wheel.options.find((o) => o.id === seen.spin.optionId).surprise, '');
});

test('shared wheels: every phone sees every spin, who spun it, and its surprise', async () => {
  const { room, connect, send, hostSecret } = await setup({ shared: true, spinsPerDay: 0 });
  const host = await connect(hostSecret);
  const ava = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).token);
  const ben = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ben' })).token);
  await send(ben, { type: 'spin' });
  for (const phone of [host, ava, ben]) assert.equal(phone.last('spun').spin.playerId, 'ben');
  const { spin, wheel } = ava.last('spun');
  assert.match(wheel.options.find((o) => o.id === spin.optionId).surprise, /Surprise/);
});

test('two phones spinning at once each get their own spin, in order', async () => {
  const { room, connect, send } = await setup({ shared: true, spinsPerDay: 0 });
  const ava = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).token);
  const ben = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ben' })).token);
  const [a, b] = await Promise.all([send(ava, { type: 'spin' }), send(ben, { type: 'spin' })]);
  assert.ok(a.ok && b.ok);
  const spins = (await room.info(), ava.last('spun').wheel.spins);
  assert.equal(spins.length, 2);
  assert.notEqual(spins[0].optionId, spins[1].optionId); // removed after spin: no repeats
});

test('the daily limit is enforced by the server, and a resent spin is not counted twice', async () => {
  const { room, connect, send } = await setup();
  const ava = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).token);
  const first = await send(ava, { type: 'spin', spinId: 'same' });
  const resent = await send(ava, { type: 'spin', spinId: 'same' });
  assert.equal(resent.ok, true);
  assert.equal(resent.spinId, first.spinId);
  const another = await send(ava, { type: 'spin', spinId: 'other' });
  assert.deepEqual([another.ok, another.error], [false, 'locked']);
});

test('a player can only spin as themselves and cannot use host actions', async () => {
  const { room, connect, send } = await setup({ spinsPerDay: 0 });
  const ava = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).token);
  await send(ava, { type: 'spin', playerId: 'ben' });
  assert.equal(ava.last('spun').spin.playerId, 'ava');
  for (const name of ['set-props', 'reset', 'release', 'delete', 'extra-spin']) {
    const ack = await send(ava, { type: 'act', name, args: { playerId: 'ava' } });
    assert.deepEqual([ack.ok, ack.error], [false, 'bad-request'], name);
  }
});

test('the host can spin for a player, change the wheel, and everyone gets the new state', async () => {
  const { room, connect, send, hostSecret } = await setup();
  const host = await connect(hostSecret);
  const ava = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).token);
  assert.equal((await send(host, { type: 'spin', playerId: 'ben' })).ok, true);
  await send(host, { type: 'act', name: 'set-props', args: { title: 'Renamed' } });
  assert.equal(ava.last('state').wheel.title, 'Renamed');
  // An online wheel keeps its kind.
  const ack = await send(host, { type: 'act', name: 'set-props', args: { sharedWheel: true } });
  assert.equal(ack.error, 'bad-request');
});

test('releasing a name signs that phone out; the name can be claimed again', async () => {
  const { room, connect, send, hostSecret } = await setup();
  const host = await connect(hostSecret);
  const ava = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).token);
  await send(host, { type: 'act', name: 'release', args: { playerId: 'ava' } });
  assert.equal(ava.closed, CLOSE_SIGNED_OUT);
  assert.equal((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).ok, true);
});

test('removing a player signs their phone out and removes their spins', async () => {
  const { room, connect, send, hostSecret } = await setup({ spinsPerDay: 0 });
  const host = await connect(hostSecret);
  const ava = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).token);
  await send(ava, { type: 'spin' });
  await send(host, { type: 'act', name: 'remove-player', args: { id: 'ava' } });
  assert.equal(ava.closed, CLOSE_SIGNED_OUT);
  assert.equal(host.last('state').wheel.spins.length, 0);
});

test('a new join code replaces the old one, and the old one can no longer join', async () => {
  const { room, connect, send, hostSecret, released } = await setup();
  const host = await connect(hostSecret);
  await send(host, { type: 'act', name: 'rotate-code' });
  assert.equal(host.last('state').meta.joinCode, 'NEWCODE2');
  assert.deepEqual(released, ['ABCD2345']);
  assert.deepEqual(await room.join({ joinCode: 'ABCD2345', playerId: 'ava' }), { ok: false, error: 'not-found' });
  assert.equal((await room.join({ joinCode: 'NEWCODE2', playerId: 'ava' })).ok, true);
});

test('joining needs the wheel’s join code, not just its id', async () => {
  const { room } = await setup();
  assert.deepEqual(await room.join({ playerId: 'ava' }), { ok: false, error: 'not-found' });
});

test('resetting a long-used wheel does not make it expire early', async () => {
  const { room, connect, send, hostSecret, storage, tick } = await setup({ shared: true, spinsPerDay: 0 });
  const host = await connect(hostSecret);
  for (let day = 0; day < 20; day++) {
    await send(host, { type: 'spin' });
    tick(DAY);
  }
  await send(host, { type: 'act', name: 'reset', args: {} });
  assert.ok(storage.alarm > Date.parse('2026-12-01T15:00:00Z') + 20 * DAY + 50 * DAY);
  await room.alarm();
  assert.equal(storage.map.size, 1);
});

test('a refused change sends the host the real state, so its copy stays in step', async () => {
  const { connect, send, hostSecret } = await setup();
  const host = await connect(hostSecret);
  const before = host.sent.length;
  const ack = await send(host, { type: 'act', name: 'set-props', args: { theme: 'nope' } });
  assert.equal(ack.ok, false);
  assert.ok(host.sent.slice(before).some((m) => m.type === 'state'));
});

test('a resent spin is shown again to the phone that missed it', async () => {
  const { room, connect, send } = await setup();
  const ava = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).token);
  await send(ava, { type: 'spin', spinId: 'lost' });
  ava.sent.length = 0;
  await send(ava, { type: 'spin', spinId: 'lost' });
  assert.equal(ava.last('spun').spin.id, 'lost');
});

test('connections that never sign in are closed, so they cannot fill the room', async () => {
  const { room, tick } = await setup();
  const sockets = room.ctx.getWebSockets;
  const idle = Array.from({ length: 40 }, () => {
    const ws = new FakeSocket();
    room.accepted(ws);
    return ws;
  });
  room.ctx.getWebSockets = () => idle.filter((s) => !s.closed);
  assert.equal(room.canAccept(), false);
  tick(11_000);
  assert.equal(room.canAccept(), true);
  assert.ok(idle.every((ws) => ws.closed));
  room.ctx.getWebSockets = sockets;
});

test('rate-limited requests are refused with their id, so the phone can retry', async () => {
  const { connect, hostSecret, room } = await setup();
  const host = await connect(hostSecret);
  for (let i = 0; i < 40; i++) await room.message(host, JSON.stringify({ type: 'act', name: 'set-props', args: { title: `T${i}` }, reqId: `q${i}` }));
  assert.ok(host.sent.some((m) => m.type === 'ack' && m.error === 'slow-down' && m.reqId));
});

test('deleting: every phone is told, storage and the join code are cleared', async () => {
  const { room, connect, send, hostSecret, storage, released } = await setup();
  const host = await connect(hostSecret);
  const ava = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).token);
  const ack = await send(host, { type: 'act', name: 'delete' });
  assert.equal(ack.ok, true);
  assert.equal(ava.last().type, 'gone');
  assert.equal(ava.closed, CLOSE_GONE);
  assert.equal(storage.map.size, 0);
  assert.deepEqual(released, ['ABCD2345']);
  assert.deepEqual(await room.info(), { ok: false, error: 'gone' });
});

test('expiry: 60 days after the last spin, join or host change; a wheel set up weeks ahead stays', async () => {
  const { room, connect, send, hostSecret, storage, tick } = await setup({ spinsPerDay: 0 });
  assert.equal(storage.alarm, Date.parse('2026-12-01T15:00:00Z') + ACTIVE_DAYS * DAY);
  tick(30 * DAY); // nobody joins for a month (setting up ahead of time)…
  await room.alarm(); // an early alarm just checks and reschedules
  assert.equal(storage.map.size, 1);
  const host = await connect(hostSecret);
  await send(host, { type: 'act', name: 'set-props', args: { title: 'Edited' } }); // …then a host edit
  tick(59 * DAY);
  await room.alarm();
  assert.equal(storage.map.size, 1);
  tick(2 * DAY);
  await room.alarm();
  assert.equal(storage.map.size, 0);
});

test('state survives a restart (hibernation); sockets keep who they are', async () => {
  const { room, connect, send, restart } = await setup({ spinsPerDay: 0 });
  const ava = await connect((await room.join({ joinCode: 'ABCD2345', playerId: 'ava' })).token);
  const woken = restart();
  await woken.message(ava, JSON.stringify({ type: 'spin', reqId: 'x' }));
  assert.equal(ava.last('ack').ok, true);
  void send;
});

test('oversized, malformed and flooding messages are refused', async () => {
  const { room, connect, hostSecret } = await setup();
  const host = await connect(hostSecret);
  await room.message(host, 'x'.repeat(MAX_MESSAGE_LENGTH + 1));
  assert.equal(host.last().code, 'too-big');
  await room.message(host, '{not json');
  await room.message(host, '[1,2,3]');
  await room.message(host, JSON.stringify({ type: 'act', name: '__proto__', args: {}, reqId: 'p' }));
  assert.equal(host.last('ack').error, 'unknown-action');
  const before = host.sent.length;
  for (let i = 0; i < 30; i++) await room.message(host, JSON.stringify({ type: 'nothing' }));
  assert.ok(host.sent.slice(before).some((m) => m.code === 'slow-down'));
});

test('directory: codes are readable, unique, looked up, and only released by their wheel', async () => {
  const dir = new DirectoryLogic(new FakeStorage());
  const code = await dir.allocate('w1');
  assert.ok(isJoinCode(code));
  assert.equal(await dir.lookup(code), 'w1');
  assert.equal(await dir.lookup('nope'), null);
  assert.equal(await dir.lookup('__proto__'), null);
  await dir.release(code, 'someone-else');
  assert.equal(await dir.lookup(code), 'w1');
  await dir.release(code, 'w1');
  assert.equal(await dir.lookup(code), null);
});

test('directory: creating wheels is rate limited per network', () => {
  let clock = 0;
  const dir = new DirectoryLogic(new FakeStorage(), { now: () => clock });
  for (let i = 0; i < CREATES_PER_HOUR; i++) assert.equal(dir.allowCreate('a'), true);
  assert.equal(dir.allowCreate('a'), false);
  assert.equal(dir.allowCreate('b'), true);
  clock += 60 * 60 * 1000;
  assert.equal(dir.allowCreate('a'), true);
});
