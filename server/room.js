// One online wheel: its data, who may do what, and the phones connected to it.
//
// This is the logic of the `Wheel` Durable Object (server/index.js), kept free of Cloudflare
// APIs so it can be tested with plain Node. It needs:
//   ctx.storage       get(key), put(key, value), deleteAll(), setAlarm(ms), deleteAlarm()
//   ctx.getWebSockets()   the open sockets, each with send(), close(), serializeAttachment()
//                         and deserializeAttachment()
//   deps.directory    allocate(wheelId) -> joinCode, release(joinCode, wheelId)
//
// The spin rules themselves are the app's own (public/js/rules.js), so a phone and the server
// always agree on what's allowed.
import * as rules from '../public/js/rules.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_DAYS = 60; // kept this long after the last spin, join or host change
export const MAX_MESSAGE_LENGTH = 64 * 1024;
export const MAX_SOCKETS = 40;
const RATE_PER_SECOND = 5; // messages per phone, with bursts of up to RATE_BURST
const RATE_BURST = 20;
const SIGN_IN_WINDOW_MS = 10_000;
const MAX_SOCKETS_PER_TOKEN = 3; // e.g. a phone that reconnected before its old socket closed

// Close codes the app understands.
export const CLOSE_SIGNED_OUT = 4401;
export const CLOSE_GONE = 4404;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A random, unguessable 128-bit token (base64url, 22 characters). */
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class WheelRoom {
  constructor(ctx, { directory, now = () => new Date() }) {
    this.ctx = ctx;
    this.directory = directory;
    this.now = now;
    this.data = undefined; // { wheel, meta } once loaded; null if there's no wheel
    this.alarmAt = null;
    this.buckets = new WeakMap(); // socket -> rate-limit bucket (in memory only)
  }

  async load() {
    if (this.data === undefined) this.data = (await this.ctx.storage.get('data')) ?? null;
    return this.data;
  }

  async save() {
    await this.ctx.storage.put('data', this.data);
    await this.scheduleExpiry();
  }

  // ---------------------------------------------------------------- lifecycle

  /** Set up a new wheel. Returns { ok, wheel, meta } (the host's view) or { ok: false, error }. */
  async create({ wheel, sharedWheel, timeZone, wheelId, joinCode, hostTokenHash }) {
    await this.load();
    if (this.data) return fail('bad-request');
    const clean = rules.normalizeWheel({ ...wheel, id: wheelId, sharedWheel: sharedWheel === true, timeZone });
    if (!clean.timeZone) clean.timeZone = 'UTC';
    for (const player of clean.players) {
      delete player.tokenHash; // nobody has claimed a name yet
      delete player.claimed;
    }
    if (!clean.sharedWheel) {
      // Each player's own spins only; spins by nobody in particular don't belong to anyone here.
      clean.spins = clean.spins.filter((s) => s.playerId);
      clean.bonusSpins = clean.bonusSpins.filter((b) => b.playerId);
    }
    const now = this.now().toISOString();
    this.data = {
      wheel: clean,
      meta: { wheelId, joinCode, joinOpen: true, hostTokenHash, createdAt: now, lastActiveAt: now },
    };
    await this.save();
    return { ok: true, ...this.hostView() };
  }

  /**
   * When this wheel is deleted if nothing else happens: 60 days after the last spin, join or
   * host change. (A wheel set up weeks ahead of an advent calendar must still be there on Dec 1.)
   */
  expiresAt() {
    return Date.parse(this.data.meta.lastActiveAt) + ACTIVE_DAYS * DAY_MS;
  }

  async scheduleExpiry() {
    if (!this.data) return;
    const at = this.expiresAt();
    // Moving the alarm is a storage write, so only move it when it's off by more than a day.
    // An alarm that fires early just checks again and reschedules.
    if (this.alarmAt !== null && Math.abs(this.alarmAt - at) < DAY_MS) return;
    await this.ctx.storage.setAlarm(at);
    this.alarmAt = at;
  }

  async alarm() {
    await this.load();
    if (!this.data) return;
    this.alarmAt = null;
    if (this.now().getTime() >= this.expiresAt()) await this.destroy();
    else await this.scheduleExpiry();
  }

  /** Delete everything: storage, the join code, and every connection. */
  async destroy() {
    const joinCode = this.data?.meta.joinCode;
    const wheelId = this.data?.meta.wheelId;
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { type: 'gone' });
      closeQuietly(ws, CLOSE_GONE, 'This wheel was deleted.');
    }
    if (joinCode) await this.directory.release(joinCode, wheelId);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.data = null;
    this.alarmAt = null;
  }

  // ---------------------------------------------------------------- joining (plain HTTP)

  /** What a phone scanning the QR code sees before joining. */
  async info() {
    await this.load();
    if (!this.data) return fail('gone');
    const { wheel, meta } = this.data;
    return {
      ok: true,
      wheelId: meta.wheelId,
      title: wheel.title,
      theme: wheel.theme,
      sharedWheel: wheel.sharedWheel,
      joinOpen: meta.joinOpen,
      players: wheel.players.map((p) => ({ id: p.id, name: p.name, claimed: Boolean(p.tokenHash) || p.id === meta.hostPlayerId })),
    };
  }

  /** Claim a name: an existing one (`playerId`) or a new one (`name`). Returns a player token. */
  async join({ playerId, name, joinCode } = {}) {
    // Hash first: after this await, nothing else can run before the claim is recorded.
    const token = randomToken();
    const tokenHash = await sha256hex(token);
    await this.load();
    if (!this.data) return fail('gone');
    const { wheel, meta } = this.data;
    // The current QR code is the key to joining; a replaced one no longer works.
    if (joinCode !== meta.joinCode) return fail('not-found');
    if (!meta.joinOpen) return fail('join-closed');

    let player;
    if (typeof playerId === 'string' && playerId) {
      player = rules.findPlayer(wheel, playerId);
      if (!player) return fail('no-player');
    } else {
      const wanted = rules.text(name, rules.MAX_NAME_LENGTH).trim();
      if (!wanted) return fail('name-needed');
      player = wheel.players.find((p) => sameName(p.name, wanted));
      if (!player) {
        if (wheel.players.length >= rules.MAX_PLAYERS) return fail('too-many-players');
        player = rules.applyAction(wheel, 'add-player', { name: wanted });
      }
    }
    if (player.tokenHash || player.id === meta.hostPlayerId) return fail('name-taken');

    player.tokenHash = tokenHash;
    meta.lastActiveAt = this.now().toISOString();
    await this.save();
    this.broadcastState();
    return { ok: true, wheelId: meta.wheelId, playerId: player.id, token, ...this.playerView(player.id) };
  }

  // ---------------------------------------------------------------- connections

  /**
   * Room for another phone? Connections that never signed in are closed after a few seconds,
   * so idle or abandoned ones can't fill the room.
   */
  canAccept() {
    const nowMs = this.now().getTime();
    let open = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const who = ws.deserializeAttachment?.();
      if (!who?.role && !(nowMs - (who?.connectedAt ?? 0) < SIGN_IN_WINDOW_MS)) closeQuietly(ws, CLOSE_SIGNED_OUT, 'Not signed in.');
      else open++;
    }
    return open < MAX_SOCKETS;
  }

  /** A new connection: it has a few seconds to sign in. */
  accepted(ws) {
    ws.serializeAttachment({ connectedAt: this.now().getTime() });
  }

  /** A message from a phone. The first one must be { type: 'hello', token }. */
  async message(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_LENGTH) {
      this.send(ws, { type: 'error', code: 'too-big' });
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isObject(msg)) return;
    if (!this.allow(ws)) {
      // With the request id, so the phone can try again a moment later.
      if (typeof msg.reqId === 'string') this.ack(ws, msg.reqId, new rules.RuleError('slow-down'));
      else this.send(ws, { type: 'error', code: 'slow-down' });
      return;
    }

    await this.load();
    if (!this.data) {
      this.send(ws, { type: 'gone' });
      closeQuietly(ws, CLOSE_GONE, 'This wheel was deleted.');
      return;
    }
    if (msg.type === 'hello') return this.hello(ws, msg);

    const who = this.whoIs(ws);
    if (!who) {
      this.send(ws, { type: 'error', code: 'auth' });
      closeQuietly(ws, CLOSE_SIGNED_OUT, 'Signed out.');
      return;
    }
    if (msg.type === 'spin') return this.spin(ws, who, msg);
    if (msg.type === 'act') return this.act(ws, who, msg);
  }

  async hello(ws, { token }) {
    const hash = typeof token === 'string' && token.length <= 64 ? await sha256hex(token) : '';
    const { wheel, meta } = this.data;
    let who = null;
    if (hash && hash === meta.hostTokenHash) who = { role: 'host', playerId: null, tokenHash: hash };
    else {
      const player = hash ? wheel.players.find((p) => p.tokenHash === hash) : null;
      if (player) who = { role: 'player', playerId: player.id, tokenHash: hash };
    }
    if (!who) {
      this.send(ws, { type: 'error', code: 'auth' });
      closeQuietly(ws, CLOSE_SIGNED_OUT, 'Signed out.');
      return;
    }
    ws.serializeAttachment(who);
    // Close the oldest connections with the same sign-in beyond a few.
    const same = this.ctx.getWebSockets().filter((other) => other.deserializeAttachment?.()?.tokenHash === hash);
    for (const old of same.slice(0, Math.max(0, same.length - MAX_SOCKETS_PER_TOKEN))) closeQuietly(old, 1000, 'Replaced by a newer connection.');
    this.send(ws, { type: 'state', role: who.role, playerId: who.playerId, ...this.viewFor(who) });
  }

  /** The socket's signed-in identity, if it's still valid (a name can be released meanwhile). */
  whoIs(ws) {
    const who = ws.deserializeAttachment?.();
    if (!isObject(who)) return null;
    const { wheel, meta } = this.data;
    if (who.role === 'host') return who.tokenHash === meta.hostTokenHash ? who : null;
    const player = rules.findPlayer(wheel, who.playerId);
    return player && player.tokenHash === who.tokenHash ? who : null;
  }

  async spin(ws, who, msg) {
    const { wheel, meta } = this.data;
    const playerId = who.role === 'player' ? who.playerId : typeof msg.playerId === 'string' ? msg.playerId : null;
    let result;
    try {
      result = rules.applySpin(wheel, playerId, { spinId: typeof msg.spinId === 'string' ? msg.spinId : undefined, now: this.now() });
    } catch (err) {
      return this.ack(ws, msg.reqId, err);
    }
    if (result.repeated) {
      // The phone missed the first answer (it lost its connection): show it the spin now.
      this.send(ws, { type: 'spun', spin: result.spin, ...this.viewFor(who) });
    } else {
      meta.lastActiveAt = result.spin.at;
      await this.save();
      this.broadcastSpin(result.spin);
    }
    this.ack(ws, msg.reqId, null, { spinId: result.spin.id });
  }

  /** A change from the host: any rules action, plus the online-only ones handled here. */
  async act(ws, who, { reqId, name, args }) {
    if (who.role !== 'host') return this.ack(ws, reqId, new rules.RuleError('bad-request'));
    const { wheel, meta } = this.data;
    args = isObject(args) ? args : {};
    try {
      switch (name) {
        case 'delete':
          this.ack(ws, reqId, null);
          await this.destroy(); // closes every socket with CLOSE_GONE
          return;
        case 'release': {
          const player = rules.findPlayer(wheel, args.playerId);
          if (!player) throw new rules.RuleError('no-player');
          delete player.tokenHash;
          if (meta.hostPlayerId === player.id) meta.hostPlayerId = null;
          this.signOutPlayer(player.id);
          break;
        }
        case 'set-host-player': {
          // The host plays too, as this name (or none). A name a phone has claimed can't be theirs.
          const playerId = typeof args.playerId === 'string' ? args.playerId : null;
          if (playerId) {
            const player = rules.findPlayer(wheel, playerId);
            if (!player) throw new rules.RuleError('no-player');
            if (player.tokenHash) throw new rules.RuleError('name-taken');
          }
          meta.hostPlayerId = playerId;
          break;
        }
        case 'set-join-open':
          meta.joinOpen = args.open === true;
          break;
        case 'rotate-code':
          await this.rotateCode();
          break;
        case 'set-props':
          // An online wheel keeps the kind it was created as.
          if ('sharedWheel' in args) throw new rules.RuleError('bad-request');
          rules.applyAction(wheel, name, args, { now: this.now() });
          break;
        case 'remove-player':
          rules.applyAction(wheel, name, args, { now: this.now() });
          if (meta.hostPlayerId === args.id) meta.hostPlayerId = null;
          this.signOutPlayer(args.id);
          break;
        default:
          rules.applyAction(wheel, name, args, { now: this.now() });
      }
    } catch (err) {
      this.ack(ws, reqId, err);
      // The host's phone already applied the change to its copy: put it back in step.
      if (this.data) this.send(ws, { type: 'state', role: who.role, playerId: who.playerId, ...this.viewFor(who) });
      return;
    }
    meta.lastActiveAt = this.now().toISOString();
    await this.save();
    this.broadcastState();
    this.ack(ws, reqId, null);
  }

  /**
   * Swap in a new join code. One at a time: the directory calls are awaits during which another
   * message could run, and two overlapping swaps would leave an old code pointing here.
   */
  rotateCode() {
    const next = (this.rotating ?? Promise.resolve()).then(async () => {
      if (!this.data) return;
      const { meta } = this.data;
      const code = await this.directory.allocate(meta.wheelId);
      await this.directory.release(meta.joinCode, meta.wheelId);
      meta.joinCode = code;
    });
    this.rotating = next.catch(() => {}); // a failed swap mustn't block the next one
    return next;
  }

  signOutPlayer(playerId) {
    for (const ws of this.ctx.getWebSockets()) {
      const who = ws.deserializeAttachment?.();
      if (who?.role === 'player' && who.playerId === playerId) {
        this.send(ws, { type: 'error', code: 'auth' });
        closeQuietly(ws, CLOSE_SIGNED_OUT, 'Signed out.');
      }
    }
  }

  // ---------------------------------------------------------------- what each phone sees

  viewFor(who) {
    return who.role === 'host' ? this.hostView() : this.playerView(who.playerId);
  }

  /** Everything except the token hashes; each name says whether it's claimed. */
  hostView() {
    const { wheel, meta } = this.data;
    return {
      wheel: { ...wheel, players: wheel.players.map(({ tokenHash, ...p }) => ({ ...p, claimed: Boolean(tokenHash) })) },
      meta: {
        joinCode: meta.joinCode,
        joinOpen: meta.joinOpen,
        hostPlayerId: meta.hostPlayerId ?? null,
        lastActiveAt: meta.lastActiveAt,
        expiresAt: new Date(this.expiresAt()).toISOString(),
      },
    };
  }

  /**
   * A player sees their own spins (everyone's on a shared wheel, or when the host shares them),
   * and only the surprises of options that came up for them: on an advent wheel, another kid's
   * Day 5 surprise is also theirs, so it stays hidden until they spin it.
   */
  playerView(playerId) {
    const { wheel, meta } = this.data;
    const mine = (entry) => entry.playerId === playerId;
    const ownSpins = wheel.sharedWheel ? wheel.spins : wheel.spins.filter(mine);
    const revealed = new Set(ownSpins.map((s) => s.optionId));
    return {
      wheel: {
        ...wheel,
        options: wheel.options.map((o) => (revealed.has(o.id) ? o : { ...o, surprise: '' })),
        players: wheel.players.map((p) => ({ id: p.id, name: p.name })),
        spins: wheel.sharedWheel || wheel.showSpinsToEveryone ? wheel.spins : ownSpins,
        bonusSpins: wheel.sharedWheel && wheel.sharedDailyLimit ? wheel.bonusSpins : wheel.bonusSpins.filter(mine),
      },
      meta: { joinOpen: meta.joinOpen },
    };
  }

  canSee(who, spin) {
    const { wheel } = this.data;
    return who.role === 'host' || wheel.sharedWheel || wheel.showSpinsToEveryone || spin.playerId === who.playerId;
  }

  /** A spin goes, with the new state, to every phone allowed to see it. */
  broadcastSpin(spin) {
    for (const ws of this.ctx.getWebSockets()) {
      const who = this.whoIs(ws);
      if (who && this.canSee(who, spin)) this.send(ws, { type: 'spun', spin, ...this.viewFor(who) });
    }
  }

  broadcastState() {
    for (const ws of this.ctx.getWebSockets()) {
      const who = this.whoIs(ws);
      if (who) this.send(ws, { type: 'state', role: who.role, playerId: who.playerId, ...this.viewFor(who) });
    }
  }

  ack(ws, reqId, err, extra = {}) {
    if (typeof reqId !== 'string' || reqId.length > 64) return;
    if (err) {
      if (!(err instanceof rules.RuleError)) console.error(err);
      const code = err instanceof rules.RuleError ? err.code : 'server-error';
      this.send(ws, { type: 'ack', reqId, ok: false, error: code });
    } else this.send(ws, { type: 'ack', reqId, ok: true, ...extra });
  }

  send(ws, message) {
    try {
      ws.send(JSON.stringify(message));
    } catch {} // a socket that just closed
  }

  /** A token bucket per phone: a few messages a second; extras are refused. */
  allow(ws) {
    const nowMs = this.now().getTime();
    const bucket = this.buckets.get(ws) ?? { tokens: RATE_BURST, at: nowMs };
    bucket.tokens = Math.min(RATE_BURST, bucket.tokens + ((nowMs - bucket.at) / 1000) * RATE_PER_SECOND);
    bucket.at = nowMs;
    const ok = bucket.tokens >= 1;
    if (ok) bucket.tokens -= 1;
    this.buckets.set(ws, bucket);
    return ok;
  }
}

const fail = (error) => ({ ok: false, error });
const sameName = (a, b) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

function closeQuietly(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {}
}
