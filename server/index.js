// The Worker behind whirladay.com.
//
// Static files in public/ are served by Cloudflare directly and never reach this code
// (see `run_worker_first` in wrangler.jsonc). Only these paths do:
//
//   GET  /j/<code>                  a QR code's link: redirects to the app, which opens the join screen
//   POST /api/wheels                put a wheel online -> { wheelId, hostSecret, joinCode, wheel, meta }
//   GET  /api/j/<code>              what the join screen shows (title, theme, names to claim)
//   POST /api/wheels/<id>/join      claim a name -> { playerId, token, wheel, meta }
//   GET  /api/wheels/<id>/ws        the live connection (WebSocket) for spins and host changes
//
// Each online wheel is a `Wheel` Durable Object (logic in room.js); the `Directory` Durable
// Object maps join codes to wheels (directory.js).
import { DurableObject } from 'cloudflare:workers';
import { WheelRoom, randomToken, sha256hex } from './room.js';
import { DirectoryLogic, isJoinCode } from './directory.js';

const MAX_BODY_LENGTH = 256 * 1024;

export class Wheel extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = new WheelRoom(ctx, { directory: directoryOf(env) });
    // Keep-alive pings are answered without waking the object (so they cost nothing).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  create(args) {
    return this.room.create(args);
  }

  info() {
    return this.room.info();
  }

  join(args) {
    return this.room.join(args);
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    if (!this.room.canAccept()) return new Response('Too many connections.', { status: 503 });
    const [client, server] = Object.values(new WebSocketPair());
    // Hibernation API: the object can sleep while phones stay connected.
    this.ctx.acceptWebSocket(server);
    this.room.accepted(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    return this.room.message(ws, message);
  }

  webSocketClose(ws, code) {
    try {
      ws.close(code === 1005 ? 1000 : code); // 1005 ("no code") can't be sent back
    } catch {}
  }

  alarm() {
    return this.room.alarm();
  }
}

export class Directory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.logic = new DirectoryLogic(ctx.storage);
  }

  allocate(wheelId) {
    return this.logic.allocate(wheelId);
  }

  lookup(code) {
    return this.logic.lookup(code);
  }

  release(code, wheelId) {
    return this.logic.release(code, wheelId);
  }

  allowCreate(creator) {
    return this.logic.allowCreate(creator);
  }
}

const directoryOf = (env) => env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/j/')) return joinRedirect(url);
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (err) {
      // Most often a Durable Object limit (e.g. the free plan's daily allowance) was hit.
      console.error(err);
      return json({ error: 'busy' }, 503);
    }
  },
};

/** whirladay.com/j/ABCD2345 -> the app, with the code in the #fragment (never sent to a server). */
function joinRedirect(url) {
  const code = url.pathname.slice(3).replace(/\/$/, '').toUpperCase();
  return Response.redirect(`${url.origin}/${isJoinCode(code) ? `#j=${code}` : ''}`, 302);
}

async function api(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = request.method;

  const upgrade = request.headers.get('Upgrade') === 'websocket';
  if ((method !== 'GET' || upgrade) && !sameOrigin(request, url)) return json({ error: 'bad-request' }, 403);

  if (method === 'POST' && parts.length === 2 && parts[1] === 'wheels') return createWheel(request, env);

  if (method === 'GET' && parts.length === 3 && parts[1] === 'j') {
    const code = parts[2].toUpperCase();
    // Check the shape here, so junk never reaches the one site-wide Directory object.
    if (!isJoinCode(code)) return json({ error: 'not-found' }, 404);
    const wheelId = await directoryOf(env).lookup(code);
    const stub = wheelId && wheelStub(env, wheelId);
    if (!stub) return json({ error: 'not-found' }, 404);
    return reply(await stub.info());
  }

  if (parts.length === 4 && parts[1] === 'wheels') {
    const stub = wheelStub(env, parts[2]);
    if (!stub) return json({ error: 'not-found' }, 404);
    if (method === 'POST' && parts[3] === 'join') {
      const body = await readJson(request);
      if (!body) return json({ error: 'bad-request' }, 400);
      return reply(await stub.join({ playerId: body.playerId, name: body.name, joinCode: body.joinCode }));
    }
    if (method === 'GET' && parts[3] === 'ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'bad-request' }, 426);
      return stub.fetch(request);
    }
  }
  return json({ error: 'not-found' }, 404);
}

async function createWheel(request, env) {
  const body = await readJson(request);
  if (!body || typeof body.wheel !== 'object') return json({ error: 'bad-request' }, 400);

  // A rough limit per network, so nobody can use up the free allowance by making wheels.
  // The address is hashed and kept in memory only.
  const directory = directoryOf(env);
  const creator = await sha256hex(`create:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`);
  if (!(await directory.allowCreate(creator))) return json({ error: 'too-many-wheels' }, 429);

  const id = env.WHEELS.newUniqueId();
  const wheelId = id.toString();
  const joinCode = await directory.allocate(wheelId);
  const hostSecret = randomToken();
  let result;
  try {
    result = await env.WHEELS.get(id).create({
      wheel: body.wheel,
      sharedWheel: body.sharedWheel === true,
      timeZone: body.timeZone,
      wheelId,
      joinCode,
      hostTokenHash: await sha256hex(hostSecret),
    });
  } catch (err) {
    await directory.release(joinCode, wheelId); // don't leave a code pointing at nothing
    throw err;
  }
  if (!result.ok) {
    await directory.release(joinCode, wheelId);
    return reply(result);
  }
  return json({ ...result, wheelId, hostSecret, joinCode });
}

function wheelStub(env, wheelId) {
  if (typeof wheelId !== 'string' || !/^[0-9a-f]{64}$/.test(wheelId)) return null;
  try {
    return env.WHEELS.get(env.WHEELS.idFromString(wheelId));
  } catch {
    return null; // not an id this namespace made
  }
}

/** Browsers send Origin on POSTs and WebSockets; refuse other sites' pages. */
function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  return !origin || origin === url.origin;
}

async function readJson(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_LENGTH) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_LENGTH) return null;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

const STATUS_FOR = { gone: 404, 'not-found': 404, 'no-player': 404, 'join-closed': 403, 'name-taken': 409, 'too-many-players': 409 };

/** A room result: { ok: true, ... } -> 200, { ok: false, error } -> a matching status. */
function reply(result) {
  return result.ok ? json(result) : json({ error: result.error }, STATUS_FOR[result.error] ?? 400);
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
