/// <reference lib="webworker" />
// Worker entry point. Bundlers load it with:
//   new Worker(new URL('@tinyforge/editor-core/game-worker', import.meta.url), { type: 'module' })

import type { ToWorker } from './protocol.ts';
import { GameWorkerCore } from './worker-core.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;

// Workers have requestAnimationFrame in Chromium and Firefox; fall back to a
// timer elsewhere (older Safari).
const requestFrame: (cb: (now: number) => void) => void =
  typeof scope.requestAnimationFrame === 'function'
    ? (cb) => scope.requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(performance.now()), 1000 / 60);

const core = new GameWorkerCore({
  post: (message, transfer = []) => scope.postMessage(message, transfer),
  now: () => performance.now(),
  requestFrame,
  fetch: (url) => fetch(url, { cache: 'no-store' }),
  async decodeImage(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes]), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) throw new Error('No 2D context for sprite decoding');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      width: canvas.width,
      height: canvas.height,
      rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    };
  },
});

// Handle messages strictly in order: a 'load' must finish before the 'step'
// that follows it runs.
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (event: MessageEvent<ToWorker>) => {
  queue = queue
    .then(() => core.handle(event.data))
    .catch((e) => {
      scope.postMessage({
        type: 'log',
        level: 'ERROR',
        message: `Worker error: ${e instanceof Error ? e.message : String(e)}`,
      });
    });
};
