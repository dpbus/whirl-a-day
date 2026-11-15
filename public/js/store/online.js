// The online half of the store: talking to whirladay.com about online wheels.
//
// - HTTP calls for putting a wheel online and joining one.
// - One live connection (a WebSocket) for the wheel on screen. It signs in with this device's
//   token, receives the server's copy of the wheel (which replaces the copy in state.js), plays
//   spins as they happen, and sends the host's changes.
//
// The server decides every spin. Changes the host makes are applied to the copy straight away
// (state.act) and sent here; the server's reply then replaces the copy, so both always settle
// on the server's version.
import * as store from '../state.js';
import * as rules from '../rules.js';
import { uid } from '../util.js';

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
const PING_MS = 25_000;
const SEND_DELAY_MS = 400; // typing: wait for a pause before sending
const REQUEST_TIMEOUT_MS = 15_000;

/** Errors the server or network can give, in words for people. */
const MESSAGES = {
  ...rules.RULE_MESSAGES,
  busy: 'Online wheels are busy right now. Try again in a little while. (Wheels on this device still work.)',
  offline: "You're offline. Check the connection and try again.",
  gone: 'This wheel was deleted from whirladay.com.',
  'not-found': "That code doesn't match a wheel. Check it and try again, or ask the host for a new QR code.",
  'too-many-wheels': "You've put a lot of wheels online in the last hour. Try again later.",
  'too-big': 'That wheel is too big to put online.',
  'slow-down': 'Slow down a little and try again.',
  auth: 'This device is no longer signed in to that wheel.',
  'server-error': 'Something went wrong on the server. Try again.',
};

export class OnlineError extends Error {
  constructor(code) {
    super(MESSAGES[code] ?? MESSAGES['server-error']);
    this.name = 'OnlineError';
    this.code = code;
  }
}

// ================================================================ HTTP

async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new OnlineError('offline');
  }
  let data = null;
  try {
    data = await response.json();
  } catch {}
  if (!response.ok || !data) throw new OnlineError(data?.error ?? (response.status === 503 ? 'busy' : 'server-error'));
  return data;
}

/** Put a wheel from this device online. Returns { wheelId, hostSecret, joinCode, wheel, meta }. */
export function createOnlineWheel(wheel, { sharedWheel, timeZone }) {
  const { id, online, activePlayerId, ...data } = wheel;
  return api('/api/wheels', { method: 'POST', body: { wheel: data, sharedWheel, timeZone } });
}

/** What the join screen shows for a code: { wheelId, title, theme, sharedWheel, joinOpen, players }. */
export function lookupJoinCode(code) {
  return api(`/api/j/${encodeURIComponent(code)}`);
}

/** Claim a name on a wheel, with the join code from its QR code. Returns { wheelId, playerId, token, wheel, meta }. */
export function joinWheel(wheelId, { playerId, name, joinCode }) {
  return api(`/api/wheels/${wheelId}/join`, { method: 'POST', body: { joinCode, ...(playerId ? { playerId } : { name }) } });
}

export const joinLink = (code) => `${location.origin}/j/${code}`;
export const hostLink = (wheel) => `${location.origin}/#host=${wheel.online.wheelId}.${wheel.online.token}`;

// ================================================================ The live connection

let connection = null;

/**
 * Keep a live connection to `wheel` (or none, for a local wheel). Hooks:
 *   onChange()          the wheel's copy changed: redraw
 *   onSpun(event)       a spin happened: { spin, option, index, labels }
 *   onStatus(status)    'connecting' | 'online' | 'offline' | 'signed-out' | 'gone'
 */
export function connectTo(wheel, hooks) {
  const wanted = wheel?.online && wheel.online.token ? wheel : null;
  if (connection?.wheel === wanted && connection?.token === wanted?.online.token) return connection;
  // The same wheel, just a fresh copy (after reloading what another tab saved): keep the
  // connection and point it at the new copy, rather than dropping and reconnecting.
  if (wanted && connection && !connection.closed && connection.wheel.online?.wheelId === wanted.online.wheelId && connection.token === wanted.online.token) {
    connection.wheel = wanted;
    return connection;
  }
  connection?.close();
  connection = wanted ? new Connection(wanted, hooks) : null;
  return connection;
}

export const currentConnection = () => connection;

export function connectionStatus(wheel) {
  if (!wheel?.online) return null;
  if (!wheel.online.token) return 'signed-out';
  return connection?.wheel === wheel ? connection.status : 'connecting';
}

// state.js sends online changes through here.
store.setOnlineSender((wheel, name, args, options) => {
  if (connection?.wheel !== wheel) return Promise.reject(new OnlineError('offline'));
  return connection.act(name, args, options);
});

class Connection {
  constructor(wheel, hooks) {
    this.wheel = wheel;
    this.token = wheel.online.token;
    this.hooks = hooks;
    this.status = 'connecting';
    this.ws = null;
    this.retryMs = RETRY_MIN_MS;
    this.retryTimer = 0;
    this.pingTimer = 0;
    this.closed = false;
    this.requests = new Map(); // reqId -> { resolve, reject, message, timer }
    this.unsent = []; // changes made while disconnected, sent once signed in again
    this.delayed = new Map(); // typing: key -> { timer, name, args }
    this.onVisible = () => {
      if (!document.hidden && !this.ws && !this.closed) this.reconnectNow();
    };
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onVisible);
    this.open();
  }

  open() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    this.setStatus(this.status === 'online' ? 'connecting' : this.status);
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/api/wheels/${this.wheel.online.wheelId}/ws`);
    this.ws = ws;
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', token: this.token })));
    ws.addEventListener('message', (event) => this.receive(event.data));
    ws.addEventListener('close', (event) => this.dropped(ws, event.code));
  }

  close() {
    this.closed = true;
    this.flushDelayed();
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onVisible);
    this.ws?.close(1000);
    this.ws = null;
    this.failRequests('offline');
  }

  reconnectNow() {
    this.retryMs = RETRY_MIN_MS;
    this.open();
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.hooks.onStatus?.(status);
  }

  dropped(ws, code) {
    if (ws !== this.ws) return;
    this.ws = null;
    clearInterval(this.pingTimer);
    // Changes sent but not confirmed may or may not have landed; the next copy from the server
    // shows which. Spins are safe to resend (the server recognizes a repeated spin id).
    for (const [reqId, request] of this.requests) {
      if (request.message.type === 'spin') continue;
      clearTimeout(request.timer);
      request.reject(new OnlineError('offline'));
      this.requests.delete(reqId);
    }
    if (this.closed) return;
    if (code === 4401) return this.signedOut();
    if (code === 4404) return this.gone();
    this.setStatus('offline');
    this.retryTimer = setTimeout(() => this.open(), this.retryMs * (0.75 + Math.random() / 2));
    this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
  }

  signedOut() {
    this.closed = true;
    store.signOut(this.wheel);
    this.failRequests('auth');
    this.setStatus('signed-out');
    this.hooks.onChange?.();
  }

  gone() {
    this.closed = true;
    this.failRequests('gone');
    this.setStatus('gone');
    this.hooks.onChange?.();
  }

  failRequests(code) {
    for (const request of this.requests.values()) {
      clearTimeout(request.timer);
      request.reject(new OnlineError(code));
    }
    this.requests.clear();
  }

  receive(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // e.g. the keep-alive 'pong'
    }
    switch (msg.type) {
      case 'state':
        store.applyServerWheel(this.wheel, msg.wheel, msg.meta);
        if (this.status !== 'online') this.signedIn();
        this.hooks.onChange?.();
        break;
      case 'spun':
        this.spun(msg);
        break;
      case 'ack':
        this.acked(msg);
        break;
      case 'gone':
        this.gone();
        break;
      case 'error':
        if (msg.code === 'auth') this.signedOut();
        break;
    }
  }

  signedIn() {
    this.setStatus('online');
    this.retryMs = RETRY_MIN_MS;
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (!document.hidden && this.ws?.readyState === WebSocket.OPEN) this.ws.send('ping');
    }, PING_MS);
    // Resend spins that were in flight, then changes made while offline, a few at a time so the
    // server's per-phone rate limit isn't hit.
    const backlog = [...[...this.requests.values()].map((r) => r.message), ...this.unsent.splice(0)];
    const ws = this.ws;
    backlog.forEach((message, i) => {
      setTimeout(() => {
        if (this.ws === ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      }, Math.floor(i / 4) * 1000);
    });
  }

  /** A spin landed: work out where it sits on the wheel as it was, then take the new copy. */
  spun({ spin, wheel, meta }) {
    // The wheel as it was before this spin. (After a reconnect the copy may already include it.)
    const before = { ...this.wheel, spins: this.wheel.spins.filter((s) => s.id !== spin.id) };
    const pool = rules.spinPool(before, spin.playerId);
    const index = pool.findIndex((o) => o.id === spin.optionId);
    const labels = pool.map((o) => o.label);
    store.applyServerWheel(this.wheel, wheel, meta);
    const option = rules.findOption(this.wheel, spin.optionId) ?? { id: spin.optionId, label: '?', surprise: '' };
    this.hooks.onSpun?.({ spin, option, index, labels });
  }

  acked({ reqId, ok, error, ...rest }) {
    const request = this.requests.get(reqId);
    if (!request) return;
    if (error === 'slow-down' && (request.retries ?? 0) < 5) {
      // Sent too fast (e.g. quick taps): try the same request again in a moment.
      request.retries = (request.retries ?? 0) + 1;
      setTimeout(() => {
        if (this.requests.has(reqId) && this.status === 'online') this.ws.send(JSON.stringify(request.message));
      }, 1000 * request.retries);
      return;
    }
    clearTimeout(request.timer);
    this.requests.delete(reqId);
    if (ok) request.resolve(rest);
    else request.reject(new OnlineError(error));
  }

  request(message) {
    const reqId = uid();
    message = { ...message, reqId };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(reqId);
        reject(new OnlineError('offline'));
      }, REQUEST_TIMEOUT_MS);
      this.requests.set(reqId, { resolve, reject, message, timer });
      if (this.status === 'online') this.ws.send(JSON.stringify(message));
    });
  }

  /** Ask the server to spin for this player. Resolves once it's decided; onSpun plays it. */
  spin(playerId) {
    if (this.status !== 'online') return Promise.reject(new OnlineError('offline'));
    return this.request({ type: 'spin', spinId: uid(), playerId });
  }

  /** Send a host change. `soon` waits for a pause in typing (one pending send per field). */
  act(name, args, { soon = false } = {}) {
    if (soon) {
      const key = `${name}:${args.id ?? ''}:${Object.keys(args).sort().join(',')}`;
      const pending = this.delayed.get(key);
      clearTimeout(pending?.timer);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.delayed.delete(key);
          this.act(name, args).then(resolve, reject);
        }, SEND_DELAY_MS);
        this.delayed.set(key, { timer, name, args });
      });
    }
    const message = { type: 'act', name, args };
    if (this.status !== 'online') {
      if (this.status === 'signed-out' || this.status === 'gone') return Promise.reject(new OnlineError(this.status === 'gone' ? 'gone' : 'auth'));
      this.unsent.push(message); // sent once we're back
      return Promise.resolve({ queued: true });
    }
    return this.request(message);
  }

  /**
   * Send any typing that's still waiting for a pause. If the connection is closing for good
   * (e.g. switching wheels while offline), that typing can't be sent; the next copy from the
   * server shows the wheel as it really is.
   */
  flushDelayed() {
    for (const { timer, name, args } of this.delayed.values()) {
      clearTimeout(timer);
      const message = { type: 'act', name, args };
      if (this.ws?.readyState === WebSocket.OPEN && this.status === 'online') this.ws.send(JSON.stringify(message));
      else if (!this.closed) this.unsent.push(message);
    }
    this.delayed.clear();
  }

  /** Host-only changes that aren't rules actions: release, set-join-open, rotate-code, delete. */
  hostAction(name, args = {}) {
    if (this.status !== 'online') return Promise.reject(new OnlineError('offline'));
    return this.request({ type: 'act', name, args });
  }
}
