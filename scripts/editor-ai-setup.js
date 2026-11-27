// Sets up the deployed editor's AI proxy (apps/editor/server/ai/index.php):
// asks for a login password (shown as you type it), then uploads the proxy's config, with the
// Anthropic key from .env and the password's hash, to /.private/ on the
// editor's FTP account. The config is never written to this computer's disk.
//
//   pnpm ai:setup            (again to change the password; it logs every browser out)
//
// .env: EDITOR_AI_ANTHROPIC_KEY (a key used only for this, with a spending
// limit; ANTHROPIC_API_KEY when it is missing) and the EDITOR_FTP_* settings
// of pnpm upload:editor. EDITOR_SITE_URL is the site to check afterwards
// (https://tf.basille.net by default).
//
// Saving from the site to GitHub (optional): EDITOR_GITHUB_TOKEN, a
// fine-grained token for this repository only, with Contents read and write
// and an expiry date. The site commits to the `web` branch
// (EDITOR_GITHUB_BRANCH), made from `master` (EDITOR_GITHUB_BASE) the first
// time. EDITOR_GITHUB_REPO is owner/name, by default this clone's origin.
import { createInterface } from 'readline/promises';
import { Buffer } from 'buffer';
import { execFileSync } from 'child_process';
import { Readable } from 'stream';
import ftp from 'basic-ftp';
import dotenv from 'dotenv';
import { aiConfigPhp } from './ai-config.js';

dotenv.config({ quiet: true });

const { EDITOR_FTP_HOST, EDITOR_FTP_USER, EDITOR_FTP_PASS, EDITOR_FTP_SECURE, EDITOR_FTP_PORT } = process.env;
const key = (process.env.EDITOR_AI_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
const site = (process.env.EDITOR_SITE_URL || 'https://tf.basille.net').replace(/\/+$/, '');
const MIN_PASSWORD = 12;
const { fetch } = globalThis;

const missing = ['EDITOR_FTP_HOST', 'EDITOR_FTP_USER', 'EDITOR_FTP_PASS'].filter((n) => !process.env[n]);
if (missing.length > 0) {
  console.error(`Missing ${missing.join(', ')} in .env`);
  process.exit(1);
}
if (!key.startsWith('sk-ant-')) {
  console.error('Missing EDITOR_AI_ANTHROPIC_KEY (or ANTHROPIC_API_KEY) in .env');
  process.exit(1);
}
if (!process.env.EDITOR_AI_ANTHROPIC_KEY) {
  console.warn('Using ANTHROPIC_API_KEY. A separate EDITOR_AI_ANTHROPIC_KEY with a monthly limit is safer.');
}

// Typed in the clear, once: it stays in this terminal's scrollback, so clear
// the terminal afterwards if anyone else can see it.
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = (await rl.question(`Password for the AI on the site (${MIN_PASSWORD}+ characters): `)).trim();
rl.close();
if (password.length < MIN_PASSWORD) {
  console.error(`The password needs at least ${MIN_PASSWORD} characters.`);
  process.exit(1);
}

/** owner/name of this clone's origin remote, or ''. */
function originRepo() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin']).toString().trim();
    return /github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/.exec(url)?.[1] ?? '';
  } catch {
    return '';
  }
}

const githubToken = (process.env.EDITOR_GITHUB_TOKEN || '').trim();
const github = githubToken
  ? {
      github_token: githubToken,
      github_repo: (process.env.EDITOR_GITHUB_REPO || originRepo()).trim(),
      github_branch: (process.env.EDITOR_GITHUB_BRANCH || 'web').trim(),
      github_base: (process.env.EDITOR_GITHUB_BASE || 'master').trim(),
    }
  : {};
if (githubToken) {
  if (githubToken.startsWith('ghp_')) {
    console.error('EDITOR_GITHUB_TOKEN is a classic token: use a fine-grained one for this repository only.');
    process.exit(1);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(github.github_repo)) {
    console.error('Set EDITOR_GITHUB_REPO (owner/name) in .env.');
    process.exit(1);
  }
  console.log(`Saving from the site: ${github.github_repo}, branch ${github.github_branch}.`);
} else {
  console.log('No EDITOR_GITHUB_TOKEN in .env: the site can use the AI but not save.');
}

const config = aiConfigPhp({ anthropicKey: key, password, extra: github });
// If PHP and the rewrite rule both failed, Apache would still refuse this folder.
const htaccess = '# Written by pnpm ai:setup. Never served.\nRequire all denied\n';

const secure = EDITOR_FTP_SECURE === 'implicit' ? 'implicit' : true;
const client = new ftp.Client(60_000);
try {
  await client.access({
    host: EDITOR_FTP_HOST,
    port: EDITOR_FTP_PORT ? Number(EDITOR_FTP_PORT) : secure === 'implicit' ? 990 : 21,
    user: EDITOR_FTP_USER,
    password: EDITOR_FTP_PASS,
    secure,
  });
  await client.ensureDir('/.private');
  await client.uploadFrom(Readable.from([Buffer.from(htaccess)]), '/.private/.htaccess');
  await client.uploadFrom(Readable.from([Buffer.from(config)]), '/.private/tinyforge-ai.php');
  console.log('Uploaded the AI proxy config to /.private/ on the editor site.');
} catch (error) {
  console.error(`Upload failed: ${String(error.message).split(EDITOR_FTP_HOST).join('<host>')}`);
  process.exit(1);
} finally {
  client.close();
}

// Check the site: the config must be refused, and the proxy must ask for a login.
let ok = true;
try {
  const direct = await fetch(`${site}/.private/tinyforge-ai.php`);
  const body = await direct.text();
  if (direct.status !== 403 || body.includes('sk-ant')) {
    ok = false;
    console.error(`DANGER: ${site}/.private/ answered ${direct.status}, not 403. Check the site's .htaccess now.`);
  }
  const status = await fetch(`${site}/__tf/ai/status`, { headers: { 'X-TinyForge': '1' } });
  const json = status.ok ? await status.json() : null;
  if (json?.login) console.log(`The proxy answers and asks for the password: ${site}`);
  else {
    ok = false;
    console.error(`The proxy did not answer as expected (${status.status}). Deploy the editor (pnpm upload:editor) first.`);
  }
} catch (error) {
  ok = false;
  console.error(`Could not check ${site}: ${error.message}`);
}
process.exit(ok ? 0 : 1);
