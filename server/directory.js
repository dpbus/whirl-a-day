// The join-code index: which wheel a QR code's code points at, plus a limit on how many
// wheels one network can create. It's one Durable Object for the whole site (strongly
// consistent, so a brand-new QR code works immediately everywhere).
//
// Like room.js, this is plain logic; server/index.js wraps it in a Durable Object.
import { randomInt } from '../public/js/util.js';

// No 0/O, 1/I/L: easy to read aloud and to type from a printout.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 8;
const HOUR_MS = 60 * 60 * 1000;
export const CREATES_PER_HOUR = 10;
const MAX_TRACKED_CREATORS = 10_000;

export const isJoinCode = (v) => typeof v === 'string' && v.length === CODE_LENGTH && [...v].every((c) => CODE_ALPHABET.includes(c));

export function randomCode() {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

export class DirectoryLogic {
  constructor(storage, { now = () => Date.now() } = {}) {
    this.storage = storage;
    this.now = now;
    // Recent creates per (hashed) network address. Memory only: never stored, and forgotten
    // whenever the object restarts, which is fine for a rough limit.
    this.creates = new Map();
  }

  async allocate(wheelId) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = randomCode();
      if (!(await this.storage.get(`code:${code}`))) {
        await this.storage.put(`code:${code}`, wheelId);
        return code;
      }
    }
    throw new Error('Could not find a free join code.');
  }

  async lookup(code) {
    if (!isJoinCode(code)) return null;
    return (await this.storage.get(`code:${code}`)) ?? null;
  }

  async release(code, wheelId) {
    if (isJoinCode(code) && (await this.storage.get(`code:${code}`)) === wheelId) await this.storage.delete(`code:${code}`);
  }

  /** May this creator (a hash of their network address) make another wheel right now? */
  allowCreate(creator) {
    const now = this.now();
    const recent = (this.creates.get(creator) ?? []).filter((t) => now - t < HOUR_MS);
    if (recent.length >= CREATES_PER_HOUR) return false;
    recent.push(now);
    this.creates.delete(creator); // re-insert so the Map stays in least-recently-used order
    this.creates.set(creator, recent);
    if (this.creates.size > MAX_TRACKED_CREATORS) this.creates.delete(this.creates.keys().next().value);
    return true;
  }
}
