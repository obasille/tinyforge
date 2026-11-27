import { describe, expect, it } from 'vitest';
import { HttpWorkspace } from '../src/http-workspace.ts';
import { ProjectFiles, READ_ONLY } from '../src/project-files.ts';
import { WorkspaceError } from '../src/workspace.ts';
import { MemoryWorkspace } from './memory-workspace.ts';

describe('a read-only copy (the static build)', () => {
  it('refuses changes before any request, with a clear message', async () => {
    const ws = new MemoryWorkspace({ 'games/pong/main.ts': 'x' }, { writable: false });
    let calls = 0;
    const write = ws.write.bind(ws);
    ws.write = async (...args) => {
      calls++;
      return write(...args);
    };
    const files = new ProjectFiles(ws);
    await files.start();
    await expect(files.write('games/pong/main.ts', 'y')).rejects.toThrow(READ_ONLY);
    await expect(files.delete('games/pong/main.ts')).rejects.toBeInstanceOf(WorkspaceError);
    await expect(files.rename('games/pong/main.ts', 'games/pong/b.ts')).rejects.toThrow(READ_ONLY);
    expect(calls).toBe(0);
  });

  it("keeps a web server's HTML error page out of the message", async () => {
    const ws = new HttpWorkspace('http://host/', {
      fetch: (async () =>
        new Response('<?xml version="1.0"?><!DOCTYPE html><html>405</html>', {
          status: 405,
          headers: { 'content-type': 'text/html' },
        })) as unknown as typeof fetch,
    });
    await expect(ws.write('games/pong/main.ts', 'y')).rejects.toThrow(/^HTTP 405$/);
  });
});
