/**
 * Streamversea (streamversea.site) — E2E Provider Tests
 *
 * Reconnaissance tests for a site not yet integrated.
 * Homepage is a minimal SPA shell (220 bytes) — all content JS-rendered.
 */

import { describe, test, expect } from 'bun:test';

const BASE_URL = 'https://streamversea.site';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const TEST_MOVIE_TMDB = '550';
const TIMEOUT = 15_000;

// ─── Tests ──────────────────────────────────────────────────────────

describe('Streamversea E2E', () => {

  describe('Site reachability', () => {

    test('homepage — analyze SPA shell', async () => {
      const res = await fetch(BASE_URL, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT),
      });

      console.log(`[Streamversea] Homepage: HTTP ${res.status}`);
      expect(res.ok).toBe(true);

      const html = await res.text();
      console.log(`[Streamversea] Body size: ${html.length} bytes`);

      // Headers analysis
      const cfRay = res.headers.get('cf-ray');
      const server = res.headers.get('server');
      const contentType = res.headers.get('content-type');

      console.log(`[Streamversea] Headers:`);
      console.log(`[Streamversea]   server: ${server}`);
      console.log(`[Streamversea]   cf-ray: ${cfRay}`);
      console.log(`[Streamversea]   content-type: ${contentType}`);

      // Framework detection
      const hasNext = html.includes('__NEXT_DATA__') || html.includes('_next/');
      const hasNuxt = html.includes('__NUXT__') || html.includes('_nuxt/');
      const hasReact = html.includes('id="root"') || html.includes('id="__next"');
      const hasVue = html.includes('id="app"') || html.includes('__vue');
      const hasAngular = html.includes('ng-app') || html.includes('ng-version');

      console.log(`[Streamversea] Framework:`);
      console.log(`[Streamversea]   Next.js: ${hasNext}`);
      console.log(`[Streamversea]   Nuxt: ${hasNuxt}`);
      console.log(`[Streamversea]   React: ${hasReact}`);
      console.log(`[Streamversea]   Vue: ${hasVue}`);
      console.log(`[Streamversea]   Angular: ${hasAngular}`);

      // Script tags — these reveal the JS bundle URLs
      const scripts = html.match(/<script[^>]*src=["']([^"']+)["']/g) || [];
      const inlineScripts = html.match(/<script[^>]*>([^<]+)<\/script>/g) || [];

      console.log(`[Streamversea] External scripts: ${scripts.length}`);
      for (const s of scripts) {
        console.log(`[Streamversea]   ${s}`);
      }
      console.log(`[Streamversea] Inline scripts: ${inlineScripts.length}`);

      // CSS links — can reveal framework
      const cssLinks = html.match(/<link[^>]*href=["']([^"']+\.css[^"']*)["']/g) || [];
      console.log(`[Streamversea] CSS links: ${cssLinks.length}`);

      // Meta tags
      const metaTags = html.match(/<meta[^>]+>/g) || [];
      console.log(`[Streamversea] Meta tags: ${metaTags.length}`);
      for (const m of metaTags) {
        console.log(`[Streamversea]   ${m}`);
      }
    });

    test('all response headers', async () => {
      const res = await fetch(BASE_URL, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(TIMEOUT),
      });

      console.log('[Streamversea] All response headers:');
      res.headers.forEach((value, key) => {
        console.log(`[Streamversea]   ${key}: ${value}`);
      });
    });
  });

  describe('JS bundle analysis', () => {

    test('fetch and analyze JS bundles', async () => {
      const res = await fetch(BASE_URL, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const html = await res.text();

      // Extract script URLs
      const scriptUrls: string[] = [];
      const scriptRegex = /<script[^>]*src=["']([^"']+)["']/g;
      let match;
      while ((match = scriptRegex.exec(html)) !== null) {
        const url = match[1].startsWith('http') ? match[1] : `${BASE_URL}${match[1]}`;
        scriptUrls.push(url);
      }

      console.log(`[Streamversea] Found ${scriptUrls.length} script URLs`);

      for (const url of scriptUrls.slice(0, 3)) {
        try {
          const jsRes = await fetch(url, {
            headers: { 'User-Agent': UA, 'Referer': BASE_URL + '/' },
            signal: AbortSignal.timeout(TIMEOUT),
          });

          if (!jsRes.ok) {
            console.log(`[Streamversea]   ${url}: HTTP ${jsRes.status}`);
            continue;
          }

          const js = await jsRes.text();
          console.log(`[Streamversea]   ${url}: ${js.length} bytes`);

          // Look for API base URLs
          const apiPatterns = js.match(/["'](https?:\/\/[^"'\s]*api[^"'\s]*)["']/gi) || [];
          if (apiPatterns.length > 0) {
            console.log(`[Streamversea]   API URLs found:`);
            for (const p of [...new Set(apiPatterns)].slice(0, 5)) {
              console.log(`[Streamversea]     ${p}`);
            }
          }

          // Look for TMDB references
          const hasTmdb = js.includes('tmdb') || js.includes('themoviedb');
          const hasImdb = js.includes('imdb');
          console.log(`[Streamversea]   TMDB refs: ${hasTmdb}, IMDB refs: ${hasImdb}`);

          // Look for known embed providers
          const providers = ['vidsrc', '2embed', 'vidlink', 'autoembed', 'hexa', 'flixer', 'embed.su'];
          const found = providers.filter(p => js.toLowerCase().includes(p));
          if (found.length > 0) {
            console.log(`[Streamversea]   Known providers: ${found.join(', ')}`);
          }

          // Look for encryption/decryption patterns
          const hasCrypto = js.includes('AES') || js.includes('encrypt') || js.includes('decrypt');
          const hasBase64 = js.includes('atob') || js.includes('btoa') || js.includes('base64');
          console.log(`[Streamversea]   Crypto: ${hasCrypto}, Base64: ${hasBase64}`);

        } catch (err) {
          console.log(`[Streamversea]   ${url}: ${(err as Error).message.substring(0, 40)}`);
        }
      }
    });
  });

  describe('URL pattern discovery', () => {

    test('probe movie URL patterns', async () => {
      const patterns = [
        '/movie/550',
        '/movies/550',
        '/watch/550',
        '/watch/movie/550',
        '/embed/movie/550',
        '/?tmdb=550',
        '/search?q=fight+club',
        '/api/movie/550',
        '/api/v1/movie/550',
        '/api/search?q=fight+club',
        '/api/stream/550',
      ];

      console.log('[Streamversea] URL pattern probing:');

      for (const path of patterns) {
        try {
          const res = await fetch(`${BASE_URL}${path}`, {
            headers: {
              'User-Agent': UA,
              'Accept': 'text/html,application/json',
              'Referer': BASE_URL + '/',
            },
            redirect: 'manual',
            signal: AbortSignal.timeout(8000),
          });

          const location = res.headers.get('location');
          const contentType = res.headers.get('content-type') || '';
          console.log(`[Streamversea]   ${path} → ${res.status}${location ? ` → ${location}` : ''} (${contentType.substring(0, 25)})`);

          // If JSON response, peek at the structure
          if (res.ok && contentType.includes('json')) {
            const data = await res.json();
            console.log(`[Streamversea]     Keys: ${Object.keys(data).join(', ')}`);
          }
        } catch (err) {
          console.log(`[Streamversea]   ${path} → ERROR: ${(err as Error).message.substring(0, 40)}`);
        }
      }
    });
  });

  describe('Embed provider detection', () => {

    test('check inline scripts for embed URLs', async () => {
      const res = await fetch(BASE_URL, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const html = await res.text();

      // Check inline scripts
      const inlineRegex = /<script[^>]*>([^<]{10,})<\/script>/g;
      let match;
      while ((match = inlineRegex.exec(html)) !== null) {
        const script = match[1];

        // Look for config objects with API URLs
        const urls = script.match(/["'](https?:\/\/[^"'\s]+)["']/g) || [];
        if (urls.length > 0) {
          console.log('[Streamversea] URLs in inline script:');
          for (const u of urls) {
            console.log(`[Streamversea]   ${u}`);
          }
        }

        // Look for environment variables / config
        const envVars = script.match(/(?:NEXT_PUBLIC_|REACT_APP_|VUE_APP_)\w+/g) || [];
        if (envVars.length > 0) {
          console.log(`[Streamversea] Env vars: ${envVars.join(', ')}`);
        }
      }
    });
  });

  describe('Reconnaissance summary', () => {

    test('generates recon report', async () => {
      let status = 'unknown';
      let bodySize = 0;
      let protection = 'none detected';
      let isSPA = false;

      try {
        const res = await fetch(BASE_URL, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(TIMEOUT),
        });
        status = `HTTP ${res.status}`;
        const html = await res.text();
        bodySize = html.length;
        isSPA = bodySize < 500 && html.includes('Loading');

        const cfRay = res.headers.get('cf-ray');
        if (cfRay) protection = 'Cloudflare';
      } catch (err) {
        status = (err as Error).message.substring(0, 50);
      }

      console.log('\n[Streamversea] ═══ Recon Report ═══');
      console.log(`[Streamversea] Domain: streamversea.site`);
      console.log(`[Streamversea] Status: ${status}`);
      console.log(`[Streamversea] Protection: ${protection}`);
      console.log(`[Streamversea] Body size: ${bodySize} bytes`);
      console.log(`[Streamversea] SPA: ${isSPA}`);
      console.log(`[Streamversea] Integration: NOT STARTED`);
      console.log(`[Streamversea] Priority: MEDIUM (SPA shell accessible, need JS bundle analysis)`);
      console.log(`[Streamversea] Next step: Analyze JS bundles for API endpoints`);
    });
  });
});
