// Security and cache headers for the deployed editor (https://tf.basille.net).
//
// The host is Apache (Infomaniak), so the build writes them as .htaccess files:
//   .htaccess          HTTPS redirect, Content-Security-Policy and other headers
//   assets/.htaccess   long caching for Vite's hashed bundles
//   __tf/ai/           the AI proxy (server/ai/index.php), its routes and PHP settings
// `vite preview` (pnpm editor:static) sends the same CSP, so a violation shows
// up locally before a deploy. The dev server sends none: pnpm dev is unchanged.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from '../../../packages/editor-core/src/ai/models.ts';

const PROXY_SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/ai/index.php');

/**
 * What the editor needs, and nothing more:
 * - script-src 'wasm-unsafe-eval': the compiler (Binaryen) and the games are
 *   WebAssembly. No JavaScript eval is allowed.
 * - style-src 'unsafe-inline': CodeMirror, Dockview and React set inline
 *   styles. Styles cannot run script.
 * - img-src / media-src blob: data:: sprite previews, covers and sounds.
 * - worker-src blob:: Workers are same-origin files today; blob: keeps a
 *   bundler-inlined Worker working.
 * - connect-src 'self' data: blob:: only the site itself. The AI proxy
 *   (__tf/ai/) talks to Anthropic and GitHub for the page, so their origins
 *   are not here. data: is for the compiler, which loads a small WebAssembly
 *   helper from a data: URL with fetch(); blob: is for files changed but not
 *   yet committed to GitHub, which the game Worker fetches by URL.
 * - frame-ancestors 'none': no framing (clickjacking). Header only, so this
 *   policy is never sent as a meta tag.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Headers sent with every response of the deployed editor. */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

const apacheValue = (value: string) => `"${value.replace(/"/g, '\\"')}"`;

/** The site's root .htaccess. */
export function rootHtaccess(): string {
  const headers = Object.entries(SECURITY_HEADERS)
    .map(([name, value]) => `  Header always set ${name} ${apacheValue(value)}`)
    .join('\n');
  return `# Written by apps/editor/vite/site-headers.ts at build time. Do not edit here.

# HTTPS only. A proxy in front of Apache may end TLS itself and say so in
# X-Forwarded-Proto, so both are checked (no redirect loop behind it).
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTPS} !=on
  RewriteCond %{HTTP:X-Forwarded-Proto} !=https
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
  # The AI proxy's config (pnpm ai:setup) when it has to live in the web root.
  RewriteRule ^.private(/|$) - [F]
</IfModule>

<IfModule mod_headers.c>
${headers}
  # Browsers ignore this header over plain HTTP. One day to start, this host
  # only: raise it to a year (31536000) once the site has run fine on HTTPS.
  Header always set Strict-Transport-Security "max-age=86400"
</IfModule>

# The installable app's manifest (Apache may not know the extension).
AddType application/manifest+json .webmanifest

# The page, sw.js and the project files (__tf/) keep their names across deploys:
# always revalidate (a 304 when unchanged). assets/.htaccess overrides this.
# The proxy (__tf/ai/) sets its own.
<If "%{REQUEST_URI} !~ m#^/__tf/ai/#">
  <IfModule mod_headers.c>
    Header set Cache-Control "no-cache"
  </IfModule>
</If>
`;
}

/** assets/.htaccess: Vite's bundles have a content hash in their name. */
export function hashedAssetsHtaccess(): string {
  return `# Written by apps/editor/vite/site-headers.ts at build time. Do not edit here.
# Every file here has a content hash in its name, so it never changes.
<IfModule mod_headers.c>
  Header set Cache-Control "public, max-age=31536000, immutable"
</IfModule>
`;
}

/** The AI proxy, with the editor's model list. */
export function aiProxyPhp(): string {
  return readFileSync(PROXY_SOURCE, 'utf8')
    .replace('/*MODELS*/ []', JSON.stringify(CLAUDE_MODELS))
    .replace("/*DEFAULT_MODEL*/ ''", JSON.stringify(DEFAULT_CLAUDE_MODEL));
}

/** __tf/ai/.htaccess: the proxy's routes go to index.php, never compressed (it streams). */
export function aiProxyHtaccess(): string {
  return `# Written by apps/editor/vite/site-headers.ts at build time. Do not edit here.
# index.php checks HTTPS itself (this file's RewriteEngine replaces the root's rules here).
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /__tf/ai/
  RewriteRule ^(status|login|logout|anthropic/v1/messages|github/tree|github/commit|github/blob/[0-9a-f]{40})$ index.php [L]
</IfModule>
# Streamed replies must not wait for compression: a compressor sends its
# output in blocks, so the text would arrive in chunks.
SetEnv no-gzip 1
SetEnv no-brotli 1
<Files ".user.ini">
  Require all denied
</Files>
`;
}

/** __tf/ai/.user.ini: PHP settings for the proxy (PHP-FPM reads them per folder). */
export function aiProxyUserIni(): string {
  return `; Written by apps/editor/vite/site-headers.ts at build time. Do not edit here.
; A long conversation with file contents can be several MB.
post_max_size = 40M
; Stream the reply as it arrives.
output_buffering = 0
zlib.output_compression = 0
; A long reply can take minutes.
max_execution_time = 900
`;
}

export function siteHeaders(): Plugin {
  return {
    name: 'tinyforge-site-headers',
    // vite preview only (the dev server has no such hook).
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '.htaccess', source: rootHtaccess() });
      this.emitFile({ type: 'asset', fileName: 'assets/.htaccess', source: hashedAssetsHtaccess() });
      this.emitFile({ type: 'asset', fileName: '__tf/ai/index.php', source: aiProxyPhp() });
      this.emitFile({ type: 'asset', fileName: '__tf/ai/.htaccess', source: aiProxyHtaccess() });
      this.emitFile({ type: 'asset', fileName: '__tf/ai/.user.ini', source: aiProxyUserIni() });
    },
  };
}
