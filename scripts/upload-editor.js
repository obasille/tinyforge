// Uploads the editor build (apps/editor/dist/, from `pnpm build:editor`) to
// the root of its own FTP account. Separate from scripts/upload.js (the
// classic host) and its FTP_* settings; it is never run by a build hook.
//
// Only what changed is sent: the server keeps a manifest (MANIFEST, each
// file's SHA-256), and a deploy uploads new or changed files, index.html
// last, removes the files that are gone, then writes the new manifest.
// Without a manifest (first run, or --full) the build's folders are
// replaced and everything is uploaded. Files go up over 3 connections at
// once; --serial uses one, --parallel=N (1 to 8) another number.
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { Readable, Writable } from 'stream';
import { Buffer } from 'buffer';
import { setTimeout as sleep } from 'timers/promises';
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

const missing = [
  'EDITOR_FTP_HOST',
  'EDITOR_FTP_USER',
  'EDITOR_FTP_PASS',
].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing ${missing.join(', ')} in .env (or the environment)`);
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
const RETRYABLE =
  /ECONNRESET|ETIMEDOUT|EPIPE|ECONNABORTED|closed|timeout|socket/i;
const MAX_RETRIES = 3;

// Keeps the host name out of anything printed.
const redact = (text) => String(text).split(EDITOR_FTP_HOST).join('<host>');

// Files go up over several connections at once (3 by default); --serial
// uses one, --parallel=N picks the number.
const parallelArg = process.argv.find((arg) => arg.startsWith('--parallel='));
const PARALLEL = process.argv.includes('--serial')
  ? 1
  : Math.max(1, Math.min(8, Number(parallelArg?.split('=')[1]) || 3));

/** One FTP connection that reconnects and retries when the server drops it. */
function createConnection() {
  const conn = {
    client: null,
    async connect() {
      conn.client?.close();
      conn.client = new ftp.Client(60_000);
      conn.client.ftp.verbose = false;
      await conn.client.access({
        host: EDITOR_FTP_HOST,
        port,
        user: EDITOR_FTP_USER,
        password: EDITOR_FTP_PASS,
        secure,
      });
    },
    /** Runs `action(client)`, reconnecting and retrying on a dropped connection. */
    async run(label, action) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await action(conn.client);
        } catch (error) {
          if (attempt >= MAX_RETRIES || !RETRYABLE.test(error.message))
            throw error;
          console.warn(
            `  ${label}: ${redact(error.message)}; reconnecting (retry ${attempt + 1}/${MAX_RETRIES})`,
          );
          await sleep(1000 * (attempt + 1));
          await conn.connect();
        }
      }
    },
    close() {
      conn.client?.close();
    },
  };
  return conn;
}

const main = createConnection();
const workers = [];

const MANIFEST = '/.tf-deploy.json';
const full = process.argv.includes('--full');

const sha256 = async (file) =>
  createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');

/** The manifest on the server, or null when there is none (or it is unreadable). */
async function readManifest() {
  const chunks = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  });
  try {
    await main.run('read manifest', (client) =>
      client.downloadTo(sink, MANIFEST),
    );
    const files = JSON.parse(Buffer.concat(chunks).toString('utf8')).files;
    return files && typeof files === 'object' ? files : null;
  } catch {
    return null;
  }
}

const started = Date.now();
try {
  await main.connect();

  const local = {};
  for (const filePath of (await collectFiles(distPath)).filter(
    (f) => withMaps || !f.endsWith('.map'),
  )) {
    local[path.relative(distPath, filePath).replace(/\\/g, '/')] =
      await sha256(filePath);
  }

  const remote = full ? null : await readManifest();
  if (!remote) {
    // No manifest: replace the folders the build produces (hashed bundles in
    // assets/, the static project files in __tf/), so stale files go away.
    // Nothing else on the remote root is removed.
    console.log(
      full
        ? 'Full upload (--full).'
        : 'No manifest on the server: full upload.',
    );
    const top = await fs.readdir(distPath, { withFileTypes: true });
    for (const entry of top) {
      if (!entry.isDirectory()) continue;
      console.log(`Removing /${entry.name}`);
      await main.run(`remove /${entry.name}`, async (client) => {
        try {
          await client.removeDir(`/${entry.name}`);
        } catch (error) {
          // Not there yet; a dropped connection is retried.
          if (RETRYABLE.test(error.message)) throw error;
        }
      });
    }
  }

  // New or changed files; index.html last, once the bundles it loads are there.
  const changed = Object.keys(local)
    .filter((file) => !remote || remote[file] !== local[file])
    .sort((x, y) => (x === 'index.html') - (y === 'index.html'));
  const gone = remote
    ? Object.keys(remote).filter((file) => !(file in local))
    : [];
  console.log(
    `${changed.length} of ${Object.keys(local).length} files to upload, ${gone.length} to remove.`,
  );

  // index.html goes up on its own, after every other file.
  const last = changed.at(-1) === 'index.html' ? changed.pop() : null;
  const upload = (conn, relative) =>
    conn.run(relative, async (client) => {
      await client.ensureDir(
        path.posix.join('/', path.posix.dirname(relative)),
      );
      await client.uploadFrom(
        path.join(distPath, relative),
        path.posix.join('/', relative),
      );
    });
  let n = 0;
  const total = changed.length + (last ? 1 : 0);
  const queue = [...changed];
  const count = Math.min(PARALLEL, queue.length);
  if (count > 1) console.log(`Uploading over ${count} connections.`);
  for (let i = 1; i < count; i++) {
    const conn = createConnection();
    workers.push(conn);
    await conn.connect();
  }
  await Promise.all(
    [main, ...workers].slice(0, Math.max(count, 1)).map(async (conn) => {
      for (let relative; (relative = queue.shift());) {
        console.log(`[${++n}/${total}] ${relative}`);
        await upload(conn, relative);
      }
    }),
  );
  if (last) {
    console.log(`[${++n}/${total}] ${last}`);
    await upload(main, last);
  }
  for (const relative of gone) {
    console.log(`Removing ${relative}`);
    await main.run(`remove ${relative}`, async (client) => {
      try {
        await client.remove(path.posix.join('/', relative));
      } catch (error) {
        // Already gone; a dropped connection is retried.
        if (RETRYABLE.test(error.message)) throw error;
      }
    });
  }

  // Written last: if a deploy stops halfway, the next one compares against
  // the previous manifest and sends the rest again.
  const manifest = Buffer.from(JSON.stringify({ files: local }));
  await main.run('write manifest', async (client) => {
    await client.cd('/');
    await client.uploadFrom(Readable.from([manifest]), MANIFEST);
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `Editor upload complete (${total} uploaded, ${gone.length} removed${withMaps ? '' : ', source maps skipped'}, ${seconds} s).`,
  );
} catch (error) {
  console.error(`Editor FTP upload failed: ${redact(error.message ?? error)}`);
  process.exit(1);
} finally {
  main.close();
  for (const conn of workers) conn.close();
}
