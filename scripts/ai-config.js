// The AI proxy's config file (apps/editor/server/ai/index.php reads it):
// a PHP file that returns the settings. Used by scripts/editor-ai-setup.js and
// the proxy's tests. Nothing here is written to disk by this module.
import { pbkdf2Sync, randomBytes } from 'crypto';

/** PBKDF2-SHA256 iterations for the login password (about 0.5 s in PHP). */
export const PASSWORD_ITERATIONS = 600_000;

/** A PHP single-quoted string literal. */
const phpString = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * The config file's text. A new session secret each time, so writing the
 * config again logs every browser out.
 */
export function aiConfigPhp({ anthropicKey, password, iterations = PASSWORD_ITERATIONS, extra = {} }) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const entries = {
    anthropic_key: anthropicKey,
    session_secret: randomBytes(32).toString('hex'),
    ...extra,
  };
  const lines = Object.entries(entries).map(([k, v]) =>
    typeof v === 'boolean' ? `  '${k}' => ${v},` : `  '${k}' => ${phpString(v)},`,
  );
  return `<?php
// TinyForge AI proxy settings, written by pnpm ai:setup. Secret: never commit
// or share this file. Running pnpm ai:setup again replaces it.
return [
${lines.join('\n')}
  'password' => [
    'salt' => '${salt.toString('base64')}',
    'iterations' => ${iterations},
    'hash' => '${hash.toString('base64')}',
  ],
];
`;
}
