// Security and cache headers for the deployed editor (https://tf.basille.net).
//
// The host is Apache (Infomaniak), so the build writes them as .htaccess files:
//   .htaccess          HTTPS redirect, Content-Security-Policy and other headers
//   assets/.htaccess   long caching for Vite's hashed bundles
// `vite preview` (pnpm editor:static) sends the same CSP, so a violation shows
// up locally before a deploy. The dev server sends none: pnpm dev is unchanged.

import type { Plugin } from 'vite';

/**
 * What the editor needs, and nothing more:
 * - script-src 'wasm-unsafe-eval': the compiler (Binaryen) and the games are
 *   WebAssembly. No JavaScript eval is allowed.
 * - style-src 'unsafe-inline': CodeMirror, Dockview and React set inline
 *   styles. Styles cannot run script.
 * - img-src / media-src blob: data:: sprite previews, covers and sounds.
 * - worker-src blob:: Workers are same-origin files today; blob: keeps a
 *   bundler-inlined Worker working.
 * - connect-src: the site's own __tf/ files; the Anthropic API, which the AI
 *   panel calls directly in hosted mode with the key from the key vault; and
 *   data:, for the compiler, which loads a small WebAssembly helper from a
 *   data: URL with fetch(). api.github.com joins when saving to GitHub does.
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
  "connect-src 'self' https://api.anthropic.com data:",
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
</IfModule>

<IfModule mod_headers.c>
${headers}
  # Browsers ignore this header over plain HTTP. One year, this host only.
  Header always set Strict-Transport-Security "max-age=31536000"
</IfModule>

# The page and the project files (__tf/) keep their names across deploys:
# always revalidate (a 304 when unchanged). assets/.htaccess overrides this.
<IfModule mod_headers.c>
  Header set Cache-Control "no-cache"
</IfModule>
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
    },
  };
}
