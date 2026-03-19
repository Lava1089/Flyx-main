/**
 * Nepoflix (nepoflix.site) — E2E Provider Tests
 *
 * Reconnaissance tests for a site not yet integrated.
 * Initial fetch returned no readable content — likely a SPA or bot-protected.
 */

import { describe, test, expect } from 'bun:test';

const BASE_URL = 'https://nepoflix.site';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const TEST_MOVIE_TMDB = '550';
const TIMEOUT = 15_000;

// ─── Tests ──────────────────────────────────────────────────────────

describe('Nepoflix E2E', () => {

  describe('Site reachability', () => {

    test('homepage — check status and protection', async () => {
      try {
        const res = await fetch(BASE_URL, {
          headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT),
        });

        console.log(`[Nepoflix] Homepage: HTTP ${res.status}`);

        // Response headers analysis
        const cfRay = res.headers.get('cf-ray');
        const server = res.headers.get('server');
        const contentType = res.headers.get('content-type');
        const xPoweredBy = res.headers.get('x-powered-by');

        console.log(`[Nepoflix] Headers:`);
        console.log(`[Nepoflix]   server: ${server}`);
        console.log(`[Nepoflix]   cf-ray: ${cfRay}`);
        console.log(`[Nepoflix]   content-type: ${contentType}`);
        console.log(`[Nepoflix]   x-powered-by: ${xPoweredBy}`);

        const html = await res.text();
        console.log(`[Nepoflix] Body size: ${html.length} bytes`);

        if (html.length < 100) {
          console.log(`[Nepoflix] Body content: ${html}`);
        }

        // Protection detection
        const hasCfChallenge = html.includes('challenge-platform') || html.includes('cf-browser-verification');
        const hasTurnstile = html.includes('turnstile') || html.includes('cf-turnstile');
        const hasJsChallenge = html.includes('jschl') || html.includes('_cf_chl');

        console.log(`[Nepoflix] Protection:`);
        console.log(`[Nepoflix]   Cloudflare: ${cfRay ? 'YES' : 'no'}`);
        console.log(`[Nepoflix]   CF challenge: ${hasCfChallenge}`);
        console.log(`[Nepoflix]   Turnstile: ${hasTurnstile}`);
        console.log(`[Nepoflix]   JS challenge: ${hasJsChallenge}`);

        // Framework detection
        const hasNext = html.includes('__NEXT_DATA__') || html.includes('_next/');
        const hasNuxt = html.includes('__NUXT__') || html.includes('_nuxt/');
        const hasReact = html.includes('id="root"') || html.includes('id="__next"');
        const hasVue = html.includes('id="app"') || html.includes('__vue');

        console.log(`[Nepoflix] Framework:`);
        console.log(`[Nepoflix]   Next.js: ${hasNext}`);
        console.log(`[Nepoflix]   Nuxt: ${hasNuxt}`);
        console.log(`[Nepoflix]   React root: ${hasReact}`);
        console.log(`[Nepoflix]   Vue app: ${hasVue}`);

        // Script tags
        const scripts = html.match(/<script[^>]*src=["']([^"']+)["']/g) || [];
        console.log(`[Nepoflix] External scripts: ${scripts.length}`);
        for (const s of scripts.slice(0, 5)) {
          console.log(`[Nepoflix]   ${s}`);
        }

      } catch (err) {
        console.log(`[Nepoflix] Homepage: FAILED — ${(err as Error).message}`);
      }
    });

    test('check with different User-Agents', async () => {
      const agents = [
        { name: 'Chrome', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36' },
        { name: 'Firefox', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0' },
        { name: 'curl', ua: 'curl/8.0' },
        { name: 'Bot', ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
      ];

      console.log('[Nepoflix] User-Agent test:');

      for (const { name, ua } of agents) {
        try {
          const res = await fetch(BASE_URL, {
            headers: { 'User-Agent': ua, 'Accept': 'text/html' },
            redirect: 'follow',
            signal: AbortSignal.timeout(8000),
          });
          const html = await res.text();
          console.log(`[Nepoflix]   ${name}: HTTP ${res.status}, ${html.length} bytes`);
        } catch (err) {
          console.log(`[Nepoflix]   ${name}: ${(err as Error).message.substring(0, 40)}`);
        }
      }
    });
  });

  describe('URL pattern discovery', () => {

    test('probe common URL patterns', async () => {
      const patterns = [
        '/movie/550',
        '/movies/550',
        '/watch/550',
        '/watch/movie/550',
        '/embed/movie/550',
        '/?tmdb=550',
        '/search?q=fight+club',
        '/api/movie/550',
        '/api/search?q=fight+club',
      ];

      console.log('[Nepoflix] URL pattern probing:');

      for (const path of patterns) {
        try {
          const res = await fetch(`${BASE_URL}${path}`, {
            headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json', 'Referer': BASE_URL + '/' },
            redirect: 'manual',
            signal: AbortSignal.timeout(8000),
          });

          const location = res.headers.get('location');
          const contentType = res.headers.get('content-type') || '';
          console.log(`[Nepoflix]   ${path} → ${res.status}${location ? ` → ${location}` : ''} (${contentType.substring(0, 25)})`);
        } catch (err) {
          console.log(`[Nepoflix]   ${path} → ERROR: ${(err as Error).message.substring(0, 40)}`);
        }
      }
    });
  });

  describe('DNS and infrastructure', () => {

    test('check if site resolves and identify hosting', async () => {
      try {
        const res = await fetch(BASE_URL, {
          headers: { 'User-Agent': UA },
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT),
        });

        const server = res.headers.get('server');
        const via = res.headers.get('via');
        const xCache = res.headers.get('x-cache');
        const cfRay = res.headers.get('cf-ray');

        console.log('[Nepoflix] Infrastructure:');
        console.log(`[Nepoflix]   Server: ${server}`);
        console.log(`[Nepoflix]   Via: ${via}`);
        console.log(`[Nepoflix]   X-Cache: ${xCache}`);
        console.log(`[Nepoflix]   Cloudflare: ${cfRay ? 'YES' : 'no'}`);

        // Check all response headers for clues
        console.log('[Nepoflix] All response headers:');
        res.headers.forEach((value, key) => {
          console.log(`[Nepoflix]   ${key}: ${value}`);
        });
      } catch (err) {
        console.log(`[Nepoflix] Infrastructure check: ${(err as Error).message}`);
      }
    });
  });

  describe('Reconnaissance summary', () => {

    test('generates recon report', async () => {
      let status = 'unknown';
      let bodySize = 0;
      let protection = 'unknown';
      let isOnline = false;

      try {
        const res = await fetch(BASE_URL, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(TIMEOUT),
        });
        status = `HTTP ${res.status}`;
        const html = await res.text();
        bodySize = html.length;
        isOnline = res.ok;

        const cfRay = res.headers.get('cf-ray');
        protection = cfRay ? 'Cloudflare' : (bodySize < 100 ? 'Possible bot protection' : 'Minimal');
      } catch (err) {
        status = (err as Error).message.substring(0, 50);
      }

      console.log('\n[Nepoflix] ═══ Recon Report ═══');
      console.log(`[Nepoflix] Domain: nepoflix.site`);
      console.log(`[Nepoflix] Online: ${isOnline}`);
      console.log(`[Nepoflix] Status: ${status}`);
      console.log(`[Nepoflix] Protection: ${protection}`);
      console.log(`[Nepoflix] Body size: ${bodySize} bytes`);
      console.log(`[Nepoflix] Integration: NOT STARTED`);
      console.log(`[Nepoflix] Priority: LOW (empty response, needs browser investigation)`);
    });
  });
});
