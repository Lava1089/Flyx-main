/**
 * Tapemotion (tapemotion.com) — E2E Provider Tests
 *
 * Reconnaissance tests for a site not yet integrated.
 * Tapemotion returns HTTP 403 on server-side fetch, indicating
 * Cloudflare or similar bot protection.
 */

import { describe, test, expect } from 'bun:test';

const BASE_URL = 'https://tapemotion.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const TIMEOUT = 15_000;

// ─── Tests ──────────────────────────────────────────────────────────

describe('Tapemotion E2E', () => {

  describe('Site reachability', () => {

    test('homepage — check HTTP status and protection', async () => {
      try {
        const res = await fetch(BASE_URL, {
          headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT),
        });

        console.log(`[Tapemotion] Homepage: HTTP ${res.status}`);
        console.log(`[Tapemotion] Headers:`);

        // Check for Cloudflare indicators
        const cfRay = res.headers.get('cf-ray');
        const server = res.headers.get('server');
        const cfCacheStatus = res.headers.get('cf-cache-status');

        console.log(`[Tapemotion]   server: ${server}`);
        console.log(`[Tapemotion]   cf-ray: ${cfRay}`);
        console.log(`[Tapemotion]   cf-cache-status: ${cfCacheStatus}`);

        const html = await res.text();
        console.log(`[Tapemotion] Body size: ${html.length} bytes`);

        // Detect protection type
        const hasCfChallenge = html.includes('challenge-platform') || html.includes('cf-browser-verification');
        const hasTurnstile = html.includes('turnstile') || html.includes('cf-turnstile');
        const hasJsChallenge = html.includes('jschl') || html.includes('_cf_chl');
        const hasCaptcha = html.includes('captcha') || html.includes('hcaptcha') || html.includes('recaptcha');

        console.log(`[Tapemotion] Protection detected:`);
        console.log(`[Tapemotion]   Cloudflare challenge: ${hasCfChallenge}`);
        console.log(`[Tapemotion]   Turnstile: ${hasTurnstile}`);
        console.log(`[Tapemotion]   JS challenge: ${hasJsChallenge}`);
        console.log(`[Tapemotion]   CAPTCHA: ${hasCaptcha}`);

        // Check if it's a SPA
        const hasReact = html.includes('__NEXT_DATA__') || html.includes('_next/');
        const hasVue = html.includes('__vue') || html.includes('nuxt');
        const hasApp = html.includes('id="app"') || html.includes('id="root"');

        console.log(`[Tapemotion] Framework indicators:`);
        console.log(`[Tapemotion]   Next.js/React: ${hasReact}`);
        console.log(`[Tapemotion]   Vue/Nuxt: ${hasVue}`);
        console.log(`[Tapemotion]   SPA root: ${hasApp}`);

      } catch (err) {
        console.log(`[Tapemotion] Homepage: FAILED — ${(err as Error).message}`);
        // Expected: 403 Forbidden from Cloudflare
      }
    });

    test('www subdomain — check if different protection', async () => {
      try {
        const res = await fetch('https://www.tapemotion.com', {
          headers: { 'User-Agent': UA, 'Accept': 'text/html' },
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT),
        });

        console.log(`[Tapemotion] www: HTTP ${res.status}`);
        const html = await res.text();
        console.log(`[Tapemotion] www body size: ${html.length} bytes`);
      } catch (err) {
        console.log(`[Tapemotion] www: FAILED — ${(err as Error).message}`);
      }
    });
  });

  describe('URL pattern discovery', () => {

    test('probe common movie URL patterns', async () => {
      const patterns = [
        '/movie/550',
        '/movies/550',
        '/watch/550',
        '/watch/movie/550',
        '/embed/movie/550',
        '/movie/fight-club',
        '/?tmdb=550',
        '/movie?id=550',
      ];

      console.log('[Tapemotion] Probing URL patterns:');

      for (const path of patterns) {
        try {
          const res = await fetch(`${BASE_URL}${path}`, {
            headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': BASE_URL + '/' },
            redirect: 'manual', // Don't follow redirects — we want to see them
            signal: AbortSignal.timeout(8000),
          });

          const location = res.headers.get('location');
          console.log(`[Tapemotion]   ${path} → ${res.status}${location ? ` → ${location}` : ''}`);
        } catch (err) {
          console.log(`[Tapemotion]   ${path} → ERROR: ${(err as Error).message.substring(0, 40)}`);
        }
      }
    });
  });

  describe('API endpoint discovery', () => {

    test('probe common API patterns', async () => {
      const endpoints = [
        '/api/movie/550',
        '/api/v1/movie/550',
        '/api/search?q=fight+club',
        '/api/stream/550',
        '/api/embed/550',
      ];

      console.log('[Tapemotion] Probing API endpoints:');

      for (const path of endpoints) {
        try {
          const res = await fetch(`${BASE_URL}${path}`, {
            headers: {
              'User-Agent': UA,
              'Accept': 'application/json',
              'Referer': BASE_URL + '/',
              'X-Requested-With': 'XMLHttpRequest',
            },
            signal: AbortSignal.timeout(8000),
          });

          const contentType = res.headers.get('content-type') || '';
          console.log(`[Tapemotion]   ${path} → ${res.status} (${contentType.substring(0, 30)})`);

          if (res.ok && contentType.includes('json')) {
            const data = await res.json();
            console.log(`[Tapemotion]   Response keys: ${Object.keys(data).join(', ')}`);
          }
        } catch (err) {
          console.log(`[Tapemotion]   ${path} → ERROR: ${(err as Error).message.substring(0, 40)}`);
        }
      }
    });
  });

  describe('Reconnaissance summary', () => {

    test('generates recon report', async () => {
      let status = 'unknown';
      let protection = 'unknown';
      let bodySize = 0;

      try {
        const res = await fetch(BASE_URL, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(TIMEOUT),
        });
        status = `HTTP ${res.status}`;
        bodySize = (await res.text()).length;

        const cfRay = res.headers.get('cf-ray');
        protection = cfRay ? 'Cloudflare' : res.headers.get('server') || 'unknown';
      } catch (err) {
        status = (err as Error).message.substring(0, 50);
      }

      console.log('\n[Tapemotion] ═══ Recon Report ═══');
      console.log(`[Tapemotion] Domain: tapemotion.com`);
      console.log(`[Tapemotion] Status: ${status}`);
      console.log(`[Tapemotion] Protection: ${protection}`);
      console.log(`[Tapemotion] Body size: ${bodySize} bytes`);
      console.log(`[Tapemotion] Integration: NOT STARTED`);
      console.log(`[Tapemotion] Priority: LOW (403 on server-side, needs browser investigation)`);
    });
  });
});
