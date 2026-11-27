// Sets up the deployed editor's AI proxy (apps/editor/server/ai/index.php):
// asks for a login password, then uploads the proxy's config, with the
// Anthropic key from .env and the password's hash, to /.private/ on the
// editor's FTP account. The config is never written to this computer's disk.
//
//   pnpm ai:setup            (again to change the password; it logs every browser out)
//
// .env: EDITOR_AI_ANTHROPIC_KEY (a key used only for this, with a spending
// limit; ANTHROPIC_API_KEY when it is missing) and the EDITOR_FTP_* settings
// of pnpm upload:editor. EDITOR_SITE_URL is the site to check afterwards
// (https://tf.basille.net by default).
import { Readable } from 'stream';
import ftp from 'basic-ftp';
import dotenv from 'dotenv';
import { aiConfigPhp } from './ai-config.js';

dotenv.config({ quiet: true });

const { EDITOR_FTP_HOST, EDITOR_FTP_USER, EDITOR_FTP_PASS, EDITOR_FTP_SECURE, EDITOR_FTP_PORT } = process.env;
const key = (process.env.EDITOR_AI_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
const site = (process.env.EDITOR_SITE_URL || 'https://tf.basille.net').replace(/\/+$/, '');
const MIN_PASSWORD = 12;

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

/** Read a line without echoing it. */
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const password = await askHidden(`Password for the AI on the site (${MIN_PASSWORD}+ characters): `);
if (password.length < MIN_PASSWORD) {
  console.error(`The password needs at least ${MIN_PASSWORD} characters.`);
  process.exit(1);
}
if ((await askHidden('Password again: ')) !== password) {
  console.error('The two passwords differ.');
  process.exit(1);
}

const config = aiConfigPhp({ anthropicKey: key, password });
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
