import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, hashedAssetsHtaccess, rootHtaccess } from './site-headers.ts';

describe('site headers', () => {
  it('never allows JavaScript eval, inline scripts or framing', () => {
    const script = CONTENT_SECURITY_POLICY.split('; ').find((d) => d.startsWith('script-src '));
    expect(script).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/'unsafe-eval'/);
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });

  it('writes the CSP, HSTS and the HTTPS redirect into the root .htaccess', () => {
    const text = rootHtaccess();
    expect(text).toContain(`Header always set Content-Security-Policy "${CONTENT_SECURITY_POLICY}"`);
    expect(text).toContain('Strict-Transport-Security "max-age=86400"');
    expect(text).toMatch(/RewriteCond %\{HTTPS\} !=on\n.*X-Forwarded-Proto\} !=https\n.*R=301/);
  });

  it('caches only the hashed bundles for long', () => {
    expect(rootHtaccess()).toContain('Cache-Control "no-cache"');
    expect(hashedAssetsHtaccess()).toContain('immutable');
  });
});
