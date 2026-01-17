import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import ftp from 'basic-ftp';
import dotenv from 'dotenv';

dotenv.config();

const { FTP_HOST, FTP_USER, FTP_PASS } = process.env;

if (!FTP_HOST || !FTP_USER || !FTP_PASS) {
  console.error('Missing FTP_HOST, FTP_USER, or FTP_PASS in .env');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const distPath = path.join(repoRoot, 'dist');

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

async function uploadDist(client) {
  if (!(await fileExists(distPath))) {
    throw new Error('Missing dist/ directory. Run a build before uploading.');
  }

  try {
    await client.removeDir('/dist');
  } catch {
    // Ignore if /dist doesn't exist yet.
  }
  await client.ensureDir('/dist');

  const files = await collectFiles(distPath);
  for (const filePath of files) {
    const relative = path.relative(distPath, filePath).replace(/\\/g, '/');
    const remoteDir = path.posix.join('/dist', path.posix.dirname(relative));
    await client.ensureDir(remoteDir);
    await client.uploadFrom(filePath, path.posix.join('/dist', relative));
  }
}

async function uploadRootFiles(client) {
  const rootFiles = ['manifest.json', 'sw.js'];
  const patterns = [/\.html$/i, /\.css$/i];
  const entries = await fs.readdir(repoRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (rootFiles.includes(name) || patterns.some((re) => re.test(name))) {
      await client.uploadFrom(path.join(repoRoot, name), path.posix.join('/', name));
    }
  }
}

const client = new ftp.Client();
client.ftp.verbose = false;

try {
  await client.access({
    host: FTP_HOST,
    user: FTP_USER,
    password: FTP_PASS,
    secure: false,
  });

  await uploadRootFiles(client);
  await uploadDist(client);
  console.log('Upload complete.');
} catch (error) {
  console.error(`FTP upload failed: ${error.message}`);
  process.exit(1);
} finally {
  client.close();
}
