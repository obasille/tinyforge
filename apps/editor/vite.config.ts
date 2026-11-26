import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';
import { aiProxy } from './vite/ai-proxy.ts';
import { tinyforge } from './vite/tinyforge-plugin.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tinyforge({ assetsDir: path.join(repoRoot, 'assets') }),
    // AI panel routes (dev server only). The key is read from the repository's .env.
    aiProxy({ envDir: repoRoot }),
    // Type errors in the browser overlay while developing (not during tests).
    command === 'serve' && !process.env.TF_NO_CHECKER ? checker({ typescript: true }) : null,
  ],
  // Relative URLs in the build, so it works from any folder (the site serves
  // it under /tf/). Files are already fetched relative to document.baseURI.
  base: command === 'build' ? './' : '/',
  // The shared assets are served by the tinyforge plugin, not from public/.
  publicDir: false,
  server: {
    port: 5173,
    strictPort: false,
  },
  worker: {
    format: 'es',
  },
  // The compile Worker's dependencies are not found by Vite's first scan;
  // listing them avoids a page reload when the editor first opens.
  optimizeDeps: {
    include: ['assemblyscript/asc'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
}));
