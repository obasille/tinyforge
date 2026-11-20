import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';
import { tinyforge } from './vite/tinyforge-plugin.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tinyforge({ assetsDir: path.join(repoRoot, 'assets') }),
    // Type errors in the browser overlay while developing (not during tests).
    command === 'serve' && !process.env.TF_NO_CHECKER ? checker({ typescript: true }) : null,
  ],
  // The shared assets are served by the tinyforge plugin, not from public/.
  publicDir: false,
  server: {
    port: 5173,
    strictPort: false,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
}));
