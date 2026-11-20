// Run the AssemblyScript compiler (asc) from this repo's node_modules.
//
// Calling node on asc's bin script directly, instead of `npx asc`, keeps npm
// out of pnpm-run builds. npm would otherwise warn about the npm_config_*
// variables pnpm sets ("Unknown env config ...") once per game.

import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const ascBin = path.join(
  path.dirname(require.resolve('assemblyscript/package.json')),
  'bin',
  'asc.js',
);

/** Run asc with the given arguments; throws if it exits with an error. */
export function runAsc(args, options = {}) {
  execFileSync(process.execPath, [ascBin, ...args], {
    stdio: 'inherit',
    ...options,
  });
}
