// Refuses to deploy a build that contains a secret: an Anthropic API key, a
// GitHub token, or any value from the local .env (or the FTP password given
// in the environment). Used by scripts/upload-editor.js before it connects.
// Reads each file once; the whole editor build scans in well under a second.
import path from 'path';
import { Buffer } from 'buffer';
import { promises as fs } from 'fs';
import dotenv from 'dotenv';

/** Shapes of real keys; the threshold skips placeholders such as ghp_example. */
const PATTERNS = [
  { name: 'an Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'a GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/ },
];

/** Shorter values (ports, "implicit", "true") would match by chance. */
const MIN_SECRET_LENGTH = 12;

/** The secret values to look for: everything in .env, plus the FTP password. */
export async function secretValues(envFile) {
  const values = new Set();
  try {
    for (const value of Object.values(dotenv.parse(await fs.readFile(envFile)))) values.add(value);
  } catch {
    // No .env (CI): the environment's secrets are still checked below.
  }
  for (const name of ['EDITOR_FTP_PASS', 'FTP_PASS', 'ANTHROPIC_API_KEY', 'EDITOR_AI_ANTHROPIC_KEY', 'EDITOR_GITHUB_TOKEN']) {
    if (process.env[name]) values.add(process.env[name]);
  }
  return [...values].filter((v) => v.length >= MIN_SECRET_LENGTH);
}

/** Problems found in the files, as "file: what" lines (never the value). */
export async function scanForSecrets(files, root, values) {
  const problems = [];
  const needles = values.map((v) => Buffer.from(v));
  for (const file of files) {
    const bytes = await fs.readFile(file);
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const text = bytes.toString('latin1');
    for (const { name, re } of PATTERNS) {
      if (re.test(text)) problems.push(`${rel}: contains ${name}`);
    }
    if (needles.some((n) => bytes.includes(n))) problems.push(`${rel}: contains a value from .env`);
  }
  return problems;
}
