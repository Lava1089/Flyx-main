/**
 * PrimeSrc Provider Integration Tests
 *
 * Verifies:
 *   1. PrimeSrc is registered in the provider registry
 *   2. PrimeSrc has the highest priority (lowest number) for movie/tv content
 *   3. PrimeSrc is first in getForContent results
 *   4. PrimeSrc provider config is correct
 *   5. PrimeSrc proxy URL routing works
 *   6. No RPI references in primesrc proxy module
 *   7. Default provider order has primesrc first
 */

import { describe, test, expect } from 'bun:test';
import { ProviderRegistry } from '../../app/lib/providers/registry';
import type { Provider, ProviderConfig, ExtractionRequest, ExtractionResult, StreamSource, MediaType, ContentCategory } from '../../app/lib/providers/types';

// ============================================================================
// Test 1: PrimeSrc is registered and enabled
// ============================================================================
describe('PrimeSrc Provider Integration', () => {
  test('PrimeSrc provider module loads and has correct config', async () => {
    const { PrimeSrcProvider } = await import('../../app/lib/providers/primesrc');
    const provider = new PrimeSrcProvider();

    expect(provider.name).toBe('primesrc');
    expect(provider.enabled).toBe(true);
    expect(provider.priority).toBe(5);
  });

  test('PrimeSrc supports movie and tv content', async () => {
    const { PrimeSrcProvider } = await import('../../app/lib/providers/primesrc');
    const provider = new PrimeSrcProvider();

    expect(provider.supportsContent('movie')).toBe(true);
    expect(provider.supportsContent('tv')).toBe(true);
  });

  test('PrimeSrc getConfig returns correct structure', async () => {
    const { PrimeSrcProvider } = await import('../../app/lib/providers/primesrc');
    const provider = new PrimeSrcProvider();
    const config = provider.getConfig();

    expect(config.name).toBe('primesrc');
    expect(config.priority).toBe(5);
    expect(config.enabled).toBe(true);
    expect(config.supportedContent).toContain('movie');
    expect(config.supportedContent).toContain('tv');
  });

  test('PrimeSrc has highest priority (lowest number) among movie/tv providers', async () => {
    const { PrimeSrcProvider } = await import('../../app/lib/providers/primesrc');
    const { FlixerProvider } = await import('../../app/lib/providers/flixer');

    const primesrc = new PrimeSrcProvider();
    const flixer = new FlixerProvider();

    // PrimeSrc (10) should have lower priority number than Flixer (30)
    expect(primesrc.priority).toBeLessThan(flixer.priority);
  });

  test('PrimeSrc is first in registry getForContent for movies', async () => {
    const registry = new ProviderRegistry();

    // Register providers in random order
    const { FlixerProvider } = await import('../../app/lib/providers/flixer');
    const { PrimeSrcProvider } = await import('../../app/lib/providers/primesrc');

    registry.register(new FlixerProvider());
    registry.register(new PrimeSrcProvider());

    const movieProviders = registry.getForContent('movie');
    expect(movieProviders.length).toBeGreaterThanOrEqual(2);
    expect(movieProviders[0].name).toBe('primesrc');
  });

  test('PrimeSrc is first in registry getForContent for TV', async () => {
    const registry = new ProviderRegistry();

    const { FlixerProvider } = await import('../../app/lib/providers/flixer');
    const { PrimeSrcProvider } = await import('../../app/lib/providers/primesrc');

    registry.register(new FlixerProvider());
    registry.register(new PrimeSrcProvider());

    const tvProviders = registry.getForContent('tv');
    expect(tvProviders.length).toBeGreaterThanOrEqual(2);
    expect(tvProviders[0].name).toBe('primesrc');
  });
});

// ============================================================================
// Test 2: Proxy URL routing
// ============================================================================
describe('PrimeSrc Proxy URL Routing', () => {
  test('getPrimeSrcStreamProxyUrl generates correct URL', async () => {
    const { getPrimeSrcStreamProxyUrl } = await import('../../app/lib/proxy-config');
    const testUrl = 'https://tmstr2.cloudnestra.com/pl/abc123/master.m3u8';
    const proxied = getPrimeSrcStreamProxyUrl(testUrl);

    expect(proxied).toContain('/primesrc/stream');
    expect(proxied).toContain(encodeURIComponent(testUrl));
  });

  test('getPrimeSrcExtractUrl generates correct URL', async () => {
    const { getPrimeSrcExtractUrl } = await import('../../app/lib/proxy-config');

    // Movie
    const movieUrl = getPrimeSrcExtractUrl('550', 'movie');
    expect(movieUrl).toContain('/primesrc/extract');
    expect(movieUrl).toContain('tmdbId=550');
    expect(movieUrl).toContain('type=movie');

    // TV
    const tvUrl = getPrimeSrcExtractUrl('1396', 'tv', 1, 1);
    expect(tvUrl).toContain('/primesrc/extract');
    expect(tvUrl).toContain('tmdbId=1396');
    expect(tvUrl).toContain('type=tv');
    expect(tvUrl).toContain('season=1');
    expect(tvUrl).toContain('episode=1');

    // With Turnstile token
    const tokenUrl = getPrimeSrcExtractUrl('550', 'movie', undefined, undefined, 'test-token-123');
    expect(tokenUrl).toContain('token=test-token-123');
  });
});

// ============================================================================
// Test 3: No RPI in primesrc proxy
// ============================================================================
describe('PrimeSrc CF Worker Proxy (No RPI)', () => {
  test('PrimeSrc proxy Env interface has no RPI fields', async () => {
    // Read the source file and check the Env interface
    const fs = await import('fs');
    const source = fs.readFileSync('cloudflare-proxy/src/primesrc-proxy.ts', 'utf-8');

    // Env interface should NOT contain RPI_PROXY_URL or RPI_PROXY_KEY
    const envMatch = source.match(/export interface Env \{([^}]+)\}/);
    expect(envMatch).toBeTruthy();
    const envBody = envMatch[1];
    expect(envBody).not.toContain('RPI_PROXY_URL');
    expect(envBody).not.toContain('RPI_PROXY_KEY');
  });

  test('PrimeSrc proxyStream does not reference RPI', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync('cloudflare-proxy/src/primesrc-proxy.ts', 'utf-8');

    // Find the proxyStream function body
    const proxyStreamStart = source.indexOf('async function proxyStream');
    expect(proxyStreamStart).toBeGreaterThan(-1);

    // Get the function body (rough extraction)
    const afterStart = source.substring(proxyStreamStart);
    // Find the closing brace at the same indentation level
    let braceCount = 0;
    let endIdx = 0;
    for (let i = afterStart.indexOf('{'); i < afterStart.length; i++) {
      if (afterStart[i] === '{') braceCount++;
      if (afterStart[i] === '}') braceCount--;
      if (braceCount === 0) { endIdx = i; break; }
    }
    const proxyStreamBody = afterStart.substring(0, endIdx + 1);

    expect(proxyStreamBody).not.toContain('RPI_PROXY');
    expect(proxyStreamBody).not.toContain('rpi');
    expect(proxyStreamBody).not.toContain('fetch-rust');
    expect(proxyStreamBody).toContain('cf-direct');
  });
});

// ============================================================================
// Test 4: Default provider order
// ============================================================================
describe('Default Provider Order', () => {
  test('primesrc is first in default provider order', async () => {
    // We can't easily import sync-client (browser-only), so read the source
    const fs = await import('fs');
    const source = fs.readFileSync('app/lib/sync/sync-client.ts', 'utf-8');

    const orderMatch = source.match(/providerOrder:\s*\[([^\]]+)\]/);
    expect(orderMatch).toBeTruthy();

    const orderStr = orderMatch[1];
    const providers = orderStr.split(',').map(s => s.trim().replace(/['"]/g, ''));
    expect(providers[0]).toBe('primesrc');
  });

  test('primesrc is in the providers API route', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync('app/api/providers/route.ts', 'utf-8');

    expect(source).toContain("primesrc:");
    expect(source).toContain("'PrimeSrc'");
    expect(source).toContain("primary: true");
  });

  test('primesrc is in the extract route direct fallback order', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync('app/api/stream/extract/route.ts', 'utf-8');

    // Check the directExtractWithFallback function has primesrc first for non-anime
    const fallbackMatch = source.match(/isProduction\s*\?\s*\[([^\]]+)\]/);
    expect(fallbackMatch).toBeTruthy();
    const fallbackProviders = fallbackMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
    expect(fallbackProviders[0]).toBe('primesrc');
  });
});


// ============================================================================
// Test 5: Turnstile token management
// ============================================================================
describe('PrimeSrc Turnstile Token Management', () => {
  test('setTurnstileToken and getTurnstileToken work correctly', async () => {
    const { setTurnstileToken, getTurnstileToken } = await import('../../app/lib/services/primesrc-extractor');

    // Initially null
    // Note: may have residual state from other tests, so set first
    setTurnstileToken('test-token-abc');
    expect(getTurnstileToken()).toBe('test-token-abc');
  });

  test('PRIMESRC_ENABLED is true', async () => {
    const { PRIMESRC_ENABLED } = await import('../../app/lib/services/primesrc-extractor');
    expect(PRIMESRC_ENABLED).toBe(true);
  });
});

// ============================================================================
// Test 6: CF Worker has new endpoints
// ============================================================================
describe('PrimeSrc CF Worker New Endpoints', () => {
  test('CF Worker source has /primesrc/resolve endpoint', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync('cloudflare-proxy/src/primesrc-proxy.ts', 'utf-8');
    expect(source).toContain("'/primesrc/resolve'");
    expect(source).toContain('resolveLink');
  });

  test('CF Worker source has /primesrc/embed endpoint', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync('cloudflare-proxy/src/primesrc-proxy.ts', 'utf-8');
    expect(source).toContain("'/primesrc/embed'");
    expect(source).toContain('extractFromEmbed');
  });

  test('CF Worker has embed extractors for major servers', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync('cloudflare-proxy/src/primesrc-proxy.ts', 'utf-8');
    expect(source).toContain('extractFilemoon');
    expect(source).toContain('extractStreamtape');
    expect(source).toContain('extractVoe');
    expect(source).toContain('extractMixdrop');
    expect(source).toContain('extractDood');
    expect(source).toContain('extractVidmoly');
    expect(source).toContain('extractGenericHls');
  });

  test('CF Worker extract endpoint accepts Turnstile token', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync('cloudflare-proxy/src/primesrc-proxy.ts', 'utf-8');
    // The extract handler should read the token from query params
    expect(source).toContain("url.searchParams.get('token')");
    expect(source).toContain('hasTurnstileToken');
  });

  test('CF Worker does not use cloudnestra chain', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync('cloudflare-proxy/src/primesrc-proxy.ts', 'utf-8');
    // Should NOT contain cloudnestra or vidsrcme references
    expect(source).not.toContain('cloudnestra');
    expect(source).not.toContain('vidsrcme');
    expect(source).not.toContain('prorcp');
  });
});
