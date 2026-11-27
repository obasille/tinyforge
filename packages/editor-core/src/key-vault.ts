// The key vault for hosted mode (the deployed editor, with no dev server):
// API keys encrypted with a password the user picks, stored in IndexedDB.
//
// - Storage holds only the ciphertext, the salt, the IV and the iteration
//   count. A wrong password fails to decrypt (AES-GCM authenticates), so no
//   password check value is stored.
// - The AES key is derived with PBKDF2-SHA256 and is never extractable. It and
//   the plain keys exist only in memory while unlocked; lock() drops both.
//   JavaScript cannot wipe a string, so "dropped" means no reference is left
//   for the garbage collector to keep.
// - After `idleMs` without touch(), the vault locks itself.
//
// WebCrypto only: no library. Plain TS, no DOM: the app wires pagehide and
// user activity to lock() and touch().

import { createStore, type Store } from './store.ts';

/** Names of the keys the vault holds. */
export type VaultKeyName = 'anthropic' | 'github';
export type VaultKeys = Partial<Record<VaultKeyName, string>>;

export type VaultStatus = 'loading' | 'empty' | 'locked' | 'unlocked';

/** What is stored: nothing in it is readable without the password. */
export interface VaultRecord {
  version: 1;
  iterations: number;
  salt: Uint8Array;
  iv: Uint8Array;
  data: Uint8Array;
}

/** Where the record lives: IndexedDB in the browser, memory in tests. */
export interface VaultStorage {
  read(): Promise<VaultRecord | null>;
  write(record: VaultRecord): Promise<void>;
  clear(): Promise<void>;
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password');
  }
}

/** OWASP's 2023 figure for PBKDF2-SHA256: about half a second on a phone. */
export const VAULT_ITERATIONS = 600_000;
/** Lock after 15 minutes without activity. */
export const VAULT_IDLE_MS = 15 * 60 * 1000;
/** Shorter passwords are refused at setup. */
export const MIN_VAULT_PASSWORD = 10;

export interface KeyVaultOptions {
  storage?: VaultStorage;
  iterations?: number;
  idleMs?: number;
  now?: () => number;
}

export class KeyVault {
  readonly status: Store<VaultStatus> = createStore<VaultStatus>('loading');
  private readonly storage: VaultStorage;
  private readonly iterations: number;
  private readonly idleMs: number;
  private readonly now: () => number;
  private keys: VaultKeys | null = null;
  private aesKey: CryptoKey | null = null;
  private salt: Uint8Array | null = null;
  private lastActive = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: KeyVaultOptions = {}) {
    this.storage = options.storage ?? indexedDbVaultStorage();
    this.iterations = options.iterations ?? VAULT_ITERATIONS;
    this.idleMs = options.idleMs ?? VAULT_IDLE_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** Read whether a vault exists. Call once at startup. */
  async load(): Promise<VaultStatus> {
    let record: VaultRecord | null = null;
    try {
      record = await this.storage.read();
    } catch {
      // Storage unavailable (private mode, say): there is no vault to unlock.
    }
    if (this.status.getState() === 'loading') this.status.setState(record ? 'locked' : 'empty');
    return this.status.getState();
  }

  /** Create the vault (replacing any old one) and leave it unlocked. */
  async create(password: string, keys: VaultKeys): Promise<void> {
    if (password.length < MIN_VAULT_PASSWORD) {
      throw new Error(`The password needs at least ${MIN_VAULT_PASSWORD} characters.`);
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const aesKey = await deriveKey(password, salt, this.iterations);
    await this.save(aesKey, salt, keys);
    this.open(aesKey, salt, keys);
  }

  /** Decrypt the stored keys. Throws WrongPasswordError when the password is wrong. */
  async unlock(password: string): Promise<void> {
    const record = await this.storage.read();
    if (!record) {
      this.status.setState('empty');
      throw new Error('There is no key vault on this device.');
    }
    const aesKey = await deriveKey(password, record.salt, record.iterations);
    let plain: ArrayBuffer;
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: record.iv as BufferSource },
        aesKey,
        record.data as BufferSource,
      );
    } catch {
      throw new WrongPasswordError();
    }
    this.open(aesKey, record.salt, JSON.parse(new TextDecoder().decode(plain)) as VaultKeys);
  }

  /** Change or add a key while unlocked; it is stored encrypted at once. */
  async setKey(name: VaultKeyName, value: string): Promise<void> {
    if (!this.keys || !this.aesKey || !this.salt) throw new Error('The key vault is locked.');
    const keys = { ...this.keys, [name]: value };
    await this.save(this.aesKey, this.salt, keys);
    this.keys = keys;
    this.touch();
  }

  /** A key while unlocked, or null. Counts as activity. */
  get(name: VaultKeyName): string | null {
    if (!this.keys) return null;
    this.touch();
    return this.keys[name] ?? null;
  }

  /** Which keys are set, without their values (null when locked). */
  names(): VaultKeyName[] | null {
    return this.keys ? (Object.keys(this.keys) as VaultKeyName[]).filter((k) => this.keys?.[k]) : null;
  }

  /** Drop the keys from memory. */
  lock(): void {
    this.keys = null;
    this.aesKey = null;
    this.salt = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.status.getState() === 'unlocked') this.status.setState('locked');
  }

  /** Delete the vault from this device. */
  async forget(): Promise<void> {
    this.lock();
    await this.storage.clear();
    this.status.setState('empty');
  }

  /** The user is active: push the idle lock back. Cheap enough to call on every input. */
  touch(): void {
    if (!this.keys) return;
    this.lastActive = this.now();
    if (!this.timer) this.schedule(this.idleMs);
  }

  private schedule(ms: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const idle = this.now() - this.lastActive;
      if (idle >= this.idleMs) this.lock();
      else this.schedule(this.idleMs - idle);
    }, ms);
  }

  private open(aesKey: CryptoKey, salt: Uint8Array, keys: VaultKeys): void {
    this.aesKey = aesKey;
    this.salt = salt;
    this.keys = keys;
    this.status.setState('unlocked');
    this.touch();
  }

  private async save(aesKey: CryptoKey, salt: Uint8Array, keys: VaultKeys): Promise<void> {
    // A new IV for every encryption: AES-GCM must never reuse one with the same key.
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        aesKey,
        new TextEncoder().encode(JSON.stringify(keys)),
      ),
    );
    await this.storage.write({ version: 1, iterations: this.iterations, salt, iv, data });
  }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** The record in memory only (tests, or a browser without IndexedDB). */
export function memoryVaultStorage(): VaultStorage {
  let record: VaultRecord | null = null;
  return {
    read: async () => record,
    write: async (r) => {
      record = r;
    },
    clear: async () => {
      record = null;
    },
  };
}

const DB_NAME = 'tinyforge-vault';
const STORE = 'vault';
const RECORD_KEY = 'keys';

/** The record in IndexedDB, in its own database. */
export function indexedDbVaultStorage(): VaultStorage {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    read: async () => ((await run('readonly', (s) => s.get(RECORD_KEY))) as VaultRecord | undefined) ?? null,
    write: async (record) => {
      await run('readwrite', (s) => s.put(record, RECORD_KEY));
    },
    clear: async () => {
      await run('readwrite', (s) => s.delete(RECORD_KEY));
    },
  };
}
