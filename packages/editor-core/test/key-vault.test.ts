import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from '../src/ai/anthropic.ts';
import { KeyVault, memoryVaultStorage, type VaultRecord, WrongPasswordError } from '../src/key-vault.ts';

const PASSWORD = 'correct horse battery';
const KEY = 'sk-ant-api03-test-0123456789abcdefghij';
// Fewer iterations than in the browser, so the tests stay fast.
const vault = (storage = memoryVaultStorage(), idleMs?: number) => new KeyVault({ storage, iterations: 1000, idleMs });

afterEach(() => {
  vi.useRealTimers();
});

describe('key vault', () => {
  it('stores only ciphertext and unlocks with the right password', async () => {
    let stored: VaultRecord | null = null;
    const storage = memoryVaultStorage();
    const write = storage.write;
    storage.write = async (r) => {
      stored = r;
      await write(r);
    };
    const a = vault(storage);
    expect(await a.load()).toBe('empty');
    await a.create(PASSWORD, { anthropic: KEY });
    expect(a.status.getState()).toBe('unlocked');
    expect(a.get('anthropic')).toBe(KEY);

    // Nothing readable in storage: not the key, not the password.
    const bytes = JSON.stringify(stored, (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v));
    expect(bytes).not.toContain('sk-ant');
    expect(bytes).not.toContain(PASSWORD);

    // A new page: locked until unlocked.
    const b = vault(storage);
    expect(await b.load()).toBe('locked');
    expect(b.get('anthropic')).toBeNull();
    await expect(b.unlock('wrong password!')).rejects.toBeInstanceOf(WrongPasswordError);
    expect(b.status.getState()).toBe('locked');
    await b.unlock(PASSWORD);
    expect(b.get('anthropic')).toBe(KEY);
    expect(b.names()).toEqual(['anthropic']);
  });

  it('refuses a short password', async () => {
    await expect(vault().create('short', { anthropic: KEY })).rejects.toThrow(/at least 10/);
  });

  it('locks, adds keys and forgets', async () => {
    const storage = memoryVaultStorage();
    const v = vault(storage);
    await v.create(PASSWORD, { anthropic: KEY });
    await v.setKey('github', 'github_pat_xyz');
    v.lock();
    expect(v.get('anthropic')).toBeNull();
    await expect(v.setKey('github', 'x')).rejects.toThrow(/locked/);
    await v.unlock(PASSWORD);
    expect(v.get('github')).toBe('github_pat_xyz');
    await v.forget();
    expect(v.status.getState()).toBe('empty');
    expect(await storage.read()).toBeNull();
    expect(await vault(storage).load()).toBe('empty');
  });

  it('locks itself after a while without activity', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const v = vault(memoryVaultStorage(), 60_000);
    await v.create(PASSWORD, { anthropic: KEY });
    vi.advanceTimersByTime(40_000);
    v.touch();
    vi.advanceTimersByTime(40_000);
    expect(v.status.getState()).toBe('unlocked');
    vi.advanceTimersByTime(30_000);
    expect(v.status.getState()).toBe('locked');
  });
});

describe('Claude, direct', () => {
  it('sends the vault key to api.anthropic.com for each request, and nothing while locked', async () => {
    const v = vault();
    await v.create(PASSWORD, { anthropic: KEY });
    const seen: Array<{ url: string; headers: Headers }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init.headers) });
      return new Response(
        JSON.stringify({
          id: 'm1',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-5-5',
          content: [{ type: 'text', text: 'Hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 3, output_tokens: 1 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const provider = new ClaudeProvider({ apiKey: () => v.get('anthropic') }, fetchFn);
    const chat = provider.createChat({
      settings: () => ({ model: 'claude-haiku-5-5', effort: 'low' }),
      system: [{ text: 'sys' }],
      tools: [],
    });
    // The stream helper may fall back to JSON; only the request matters here.
    await chat.send({ text: 'hello' }).catch(() => {});
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(seen[0].headers.get('x-api-key')).toBe(KEY);
    expect(seen[0].headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    // A custom header would need a CORS preflight the API does not grant.
    expect(seen[0].headers.has('x-tinyforge')).toBe(false);

    v.lock();
    const before = seen.length;
    await expect(chat.send({ text: 'again' })).rejects.toThrow(/locked/);
    expect(seen.length).toBe(before);
  });
});
