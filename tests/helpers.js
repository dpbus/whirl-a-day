// Test helpers: an in-memory localStorage that can simulate a full or blocked storage.

export class MemoryStorage {
  constructor() {
    this.data = new Map();
    this.quota = Infinity; // max length of a single value
    this.blocked = false;
  }
  getItem(key) {
    if (this.blocked) throw new Error('SecurityError');
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    if (this.blocked) throw new Error('SecurityError');
    const text = String(value);
    if (text.length > this.quota) {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.data.set(key, text);
  }
  removeItem(key) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
  key(i) {
    return [...this.data.keys()][i] ?? null;
  }
  get length() {
    return this.data.size;
  }
}

/** Install a fresh storage as globalThis.localStorage (with enumerable keys like the real one). */
export function freshStorage() {
  const storage = new MemoryStorage();
  globalThis.localStorage = new Proxy(storage, {
    ownKeys: () => [...storage.data.keys()],
    getOwnPropertyDescriptor: (_, key) =>
      storage.data.has(key) ? { enumerable: true, configurable: true, value: storage.data.get(key) } : undefined,
    get: (target, prop) => (typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop]),
    set: (target, prop, value) => {
      target[prop] = value;
      return true;
    },
  });
  return storage;
}
