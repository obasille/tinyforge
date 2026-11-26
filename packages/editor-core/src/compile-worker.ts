/// <reference lib="webworker" />
// Compile Worker entry point: runs the AssemblyScript compiler
// (engine tooling/compiler.ts) off the main thread. Files are asked for one
// at a time from the main thread, which reads them through the Workspace, so
// a compile reads only what the game imports. Bundlers load it with:
//   import CompileWorker from '@tinyforge/editor-core/compile-worker?worker'

import { compile } from '@tinyforge/engine/tooling/compiler';
import type { FromCompiler, ToCompiler } from './compiler-host.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const reads = new Map<number, (data: string | ArrayBuffer | null) => void>();
let nextRead = 1;

function read(path: string, binary: boolean): Promise<string | ArrayBuffer | null> {
  const requestId = nextRead++;
  return new Promise((resolve) => {
    reads.set(requestId, resolve);
    scope.postMessage({ type: 'read', requestId, path, binary } satisfies FromCompiler);
  });
}

const files = {
  readText: async (path: string) => {
    const data = await read(path, false);
    return typeof data === 'string' ? data : null;
  },
  readBytes: async (path: string) => {
    const data = await read(path, true);
    return data instanceof ArrayBuffer ? new Uint8Array(data) : null;
  },
};

// One compile at a time (the host sends one per Worker; it runs more Workers to compile in parallel).
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event: MessageEvent<ToCompiler>) => {
  const msg = event.data;
  if (msg.type === 'file') {
    reads.get(msg.requestId)?.(msg.data);
    reads.delete(msg.requestId);
    return;
  }
  queue = queue.then(async () => {
    const started = performance.now();
    let result: Awaited<ReturnType<typeof compile>>;
    try {
      result = await compile({ game: msg.game, target: msg.target, files, assetFiles: msg.assetFiles });
    } catch (e) {
      result = { ok: false, log: `Compiler crashed: ${e instanceof Error ? e.message : String(e)}\n`, diagnostics: [] };
    }
    const ms = Math.round(performance.now() - started);
    const transfer = result.ok ? [result.wasm.buffer] : [];
    scope.postMessage({ type: 'result', id: msg.id, result, ms } satisfies FromCompiler, transfer);
  });
};
