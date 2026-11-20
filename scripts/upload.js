import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import ftp from 'basic-ftp';
import dotenv from 'dotenv';

dotenv.config();

const { FTP_HOST, FTP_USER, FTP_PASS, FTP_SECURE, FTP_PORT } = process.env;

if (!FTP_HOST || !FTP_USER || !FTP_PASS) {
  console.error('Missing FTP_HOST, FTP_USER, or FTP_PASS in .env');
  process.exit(1);
}

// Always connect over TLS so credentials and files are never sent in clear text.
// FTP_SECURE=implicit selects implicit FTPS (usually port 990); anything else
// (or unset) uses explicit FTPS (AUTH TLS on port 21). Plain FTP is not supported.
const secure = FTP_SECURE === 'implicit' ? 'implicit' : true;
const port = FTP_PORT ? Number(FTP_PORT) : secure === 'implicit' ? 990 : 21;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
// The classic host is deployed at the site root, with the shared game assets
// next to it, so the remote layout stays the same as before the repo moved
// the host into apps/classic.
const classicRoot = path.join(repoRoot, 'apps', 'classic');
const distPath = path.join(classicRoot, 'dist');
const assetsPath = path.join(repoRoot, 'assets');
const iconsPath = path.join(classicRoot, 'icons');

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

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

async function uploadDirectory(
  client,
  { localPath, remotePath, required, clean },
) {
  const exists = await fileExists(localPath);
  if (!exists) {
    if (required) {
      throw new Error(
        `Missing ${path.basename(localPath)}/ directory. Run a build before uploading.`,
      );
    }
    return;
  }

  if (clean) {
    try {
      await client.removeDir(remotePath);
    } catch {
      // Ignore if the directory doesn't exist yet.
    }
  }
  await client.ensureDir(remotePath);

  const files = await collectFiles(localPath);
  for (const filePath of files) {
    const relative = path.relative(localPath, filePath).replace(/\\/g, '/');
    const remoteDir = path.posix.join(remotePath, path.posix.dirname(relative));
    await client.ensureDir(remoteDir);
    await client.uploadFrom(filePath, path.posix.join(remotePath, relative));
  }
}

async function uploadRootFiles(client) {
  const rootFiles = ['manifest.json', 'sw.js'];
  const patterns = [/\.html$/i, /\.css$/i];
  const entries = await fs.readdir(classicRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (rootFiles.includes(name) || patterns.some((re) => re.test(name))) {
      await client.uploadFrom(
        path.join(classicRoot, name),
        path.posix.join('/', name),
      );
    }
  }
}

const client = new ftp.Client();
client.ftp.verbose = false;

try {
  await client.access({
    host: FTP_HOST,
    port,
    user: FTP_USER,
    password: FTP_PASS,
    secure,
  });

  await uploadRootFiles(client);
  await uploadDirectory(client, {
    localPath: assetsPath,
    remotePath: '/assets',
    required: true,
    clean: true,
  });
  await uploadDirectory(client, {
    localPath: iconsPath,
    remotePath: '/icons',
    required: false,
    clean: true,
  });
  await uploadDirectory(client, {
    localPath: distPath,
    remotePath: '/dist',
    required: true,
    clean: true,
  });
  console.log('Upload complete.');
} catch (error) {
  console.error(`FTP upload failed: ${error.message}`);
  process.exit(1);
} finally {
  client.close();
}
