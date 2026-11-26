// Uploads the editor build (apps/editor/dist/, from `pnpm build:editor`) to
// the root of its own FTP account. Separate from scripts/upload.js (the
// classic host) and its FTP_* settings; it is never run by a build hook.
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import ftp from 'basic-ftp';
import dotenv from 'dotenv';

dotenv.config();

const {
  EDITOR_FTP_HOST,
  EDITOR_FTP_USER,
  EDITOR_FTP_PASS,
  EDITOR_FTP_SECURE,
  EDITOR_FTP_PORT,
} = process.env;

const missing = ['EDITOR_FTP_HOST', 'EDITOR_FTP_USER', 'EDITOR_FTP_PASS'].filter(
  (name) => !process.env[name],
);
if (missing.length > 0) {
  console.error(`Missing ${missing.join(', ')} in .env`);
  process.exit(1);
}

// Always TLS, as for the classic upload: EDITOR_FTP_SECURE=implicit selects
// implicit FTPS (usually port 990), anything else explicit FTPS (port 21).
const secure = EDITOR_FTP_SECURE === 'implicit' ? 'implicit' : true;
const port = EDITOR_FTP_PORT
  ? Number(EDITOR_FTP_PORT)
  : secure === 'implicit'
    ? 990
    : 21;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '..', 'apps', 'editor', 'dist');

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(fullPath)));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

try {
  await fs.access(path.join(distPath, 'index.html'));
} catch {
  console.error('Missing apps/editor/dist/. Run `pnpm build:editor` first.');
  process.exit(1);
}

// Source maps are about 60% of the build; they are left out unless asked for.
const withMaps = process.argv.includes('--with-maps');

// Errors that mean the server dropped the connection: reconnect and retry.
const RETRYABLE = /ECONNRESET|ETIMEDOUT|EPIPE|ECONNABORTED|closed|timeout|socket/i;
const MAX_RETRIES = 3;

// Keeps the host name out of anything printed.
const redact = (text) => String(text).split(EDITOR_FTP_HOST).join('<host>');

let client;

async function connect() {
  client?.close();
  client = new ftp.Client(60_000);
  client.ftp.verbose = false;
  await client.access({
    host: EDITOR_FTP_HOST,
    port,
    user: EDITOR_FTP_USER,
    password: EDITOR_FTP_PASS,
    secure,
  });
}

async function withRetry(label, action) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= MAX_RETRIES || !RETRYABLE.test(error.message)) throw error;
      console.warn(
        `  ${label}: ${redact(error.message)}; reconnecting (retry ${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      await connect();
    }
  }
}

const started = Date.now();
try {
  await connect();

  // Only the top-level folders the build itself produces are replaced
  // (hashed bundles in assets/, the static project files in __tf/), so stale
  // files go away. Nothing else on the remote root is removed. This runs once:
  // a reconnect later never removes anything again.
  const top = await fs.readdir(distPath, { withFileTypes: true });
  for (const entry of top) {
    if (!entry.isDirectory()) continue;
    console.log(`Removing /${entry.name}`);
    await withRetry(`remove /${entry.name}`, async () => {
      try {
        await client.removeDir(`/${entry.name}`);
      } catch (error) {
        // Not there yet; a dropped connection is retried.
        if (RETRYABLE.test(error.message)) throw error;
      }
    });
  }

  const files = (await collectFiles(distPath)).filter(
    (file) => withMaps || !file.endsWith('.map'),
  );
  let n = 0;
  for (const filePath of files) {
    n++;
    const relative = path.relative(distPath, filePath).replace(/\\/g, '/');
    console.log(`[${n}/${files.length}] ${relative}`);
    await withRetry(relative, async () => {
      await client.ensureDir(path.posix.join('/', path.posix.dirname(relative)));
      await client.uploadFrom(filePath, path.posix.join('/', relative));
    });
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `Editor upload complete (${files.length} files${withMaps ? '' : ', source maps skipped'}, ${seconds} s).`,
  );
} catch (error) {
  console.error(`Editor FTP upload failed: ${redact(error.message)}`);
  process.exit(1);
} finally {
  client?.close();
}
