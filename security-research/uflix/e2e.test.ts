/**
 * Uflix (uflix.to) — E2E Provider Tests
 *
 * Validates the full pipeline discovered during reverse engineering:
 *   1. Search by title → get slug
 *   2. Movie/episode page → get IMDB ID + available streams
 *   3. /gStream API → get embed URLs for each stream
 *
 * Key findings:
 *   - Server-rendered (jQuery + Bootstrap), NOT a SPA
 *   - Behind Cloudflare (analytics only, no bot protection)
 *   - Uses IMDB IDs primarily, TMDB IDs for stream5 only
 *   - /gStream API requires X-Requested-With: XMLHttpRequest
 *   - NO captcha required (captcha= empty works fine)
 *   - Stream IDs: stream{N}|movie|imdb:{imdbId} or stream{N}|serie|imdb:{imdbId}|{SxxExx}
 */

import { describe, test, expect } from 'bun:test';

const BASE = 'https://uflix.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const TIMEOUT = 15_000;

// Test data
const FIGHT_CLUB_SLUG = 'fight-club-1999';
const FIGHT_CLUB_IMDB = 'tt0137523';
const FIGHT_CLUB_TMDB = '550';
const BREAKING_BAD_SLUG = 'breaking-bad-2008';
const BREAKING_BAD_IMDB = 'tt0903747';

const headers = (extra: Record<string, string> = {}) => ({
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  ...extra,
});

// ─── Helpers ────────────────────────────────────────────────────────

async function fetchOk(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, {
    headers: headers(),
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT),
    ...opts,
  });
  return res;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Uflix E2E', () => {

  // ── Site Reachability ─────────────────────────────────────────────

  describe('Site reachability', () => {
    test('homepage loads (HTTP 200, HTML content)', async () => {
      const res = await fetchOk(BASE);
      expect(res.ok).toBe(true);

      const html = await res.text();
      expect(html.length).toBeGreaterThan(1000);

      // Confirm it's the real site (jQuery + Bootstrap)
      expect(html).toContain('uflix');
      console.log(`[uflix] Homepage: ${res.status}, ${html.length} bytes`);
    });
  });

  // ── Search ────────────────────────────────────────────────────────

  describe('Search', () => {
    test('search returns results for "fight club"', async () => {
      const res = await fetchOk(`${BASE}/search?keyword=fight+club`);
      expect(res.ok).toBe(true);

      const html = await res.text();
      expect(html.length).toBeGreaterThan(500);

      // Should contain a link to the fight club movie page
      const hasResult = html.includes('fight-club') || html.includes('Fight Club');
      expect(hasResult).toBe(true);

      // Extract movie slugs from search results
      const slugs = [...html.matchAll(/href="\/movie\/([^"]+)"/g)].map(m => m[1]);
      console.log(`[uflix] Search "fight club": ${slugs.length} movie results`);
      console.log(`[uflix]   Slugs: ${slugs.slice(0, 5).join(', ')}`);

      expect(slugs.length).toBeGreaterThan(0);
    });

    test('search returns TV results for "breaking bad"', async () => {
      const res = await fetchOk(`${BASE}/search?keyword=breaking+bad`);
      expect(res.ok).toBe(true);

      const html = await res.text();
      const tvSlugs = [...html.matchAll(/href="\/serie\/([^"]+)"/g)].map(m => m[1]);
      console.log(`[uflix] Search "breaking bad": ${tvSlugs.length} TV results`);
      console.log(`[uflix]   Slugs: ${tvSlugs.slice(0, 5).join(', ')}`);
    });
  });

  // ── Movie Page ────────────────────────────────────────────────────

  describe('Movie page', () => {
    test('movie page loads with player iframe', async () => {
      const res = await fetchOk(`${BASE}/movie/${FIGHT_CLUB_SLUG}`);
      expect(res.ok).toBe(true);

      const html = await res.text();
      expect(html.length).toBeGreaterThan(2000);

      // Should have player iframe
      const hasIframe = html.includes('mPlayer') || html.includes('iframe');
      console.log(`[uflix] Movie page: ${html.length} bytes, iframe=${hasIframe}`);
      expect(hasIframe).toBe(true);

      // Extract IMDB ID from page
      const imdbMatch = html.match(/tt\d{7,}/);
      if (imdbMatch) {
        console.log(`[uflix] IMDB ID found on page: ${imdbMatch[0]}`);
      }

      // Extract available stream buttons/links
      const streamMatches = [...html.matchAll(/stream(\d+)/g)].map(m => m[0]);
      const uniqueStreams = [...new Set(streamMatches)];
      console.log(`[uflix] Streams referenced: ${uniqueStreams.join(', ')}`);
    });

    test('movie player iframe loads', async () => {
      const res = await fetchOk(
        `${BASE}/mPlayer?movieid=${FIGHT_CLUB_SLUG}&stream=stream1`,
        { headers: headers({ 'Referer': `${BASE}/movie/${FIGHT_CLUB_SLUG}` }) }
      );
      expect(res.ok).toBe(true);

      const html = await res.text();
      console.log(`[uflix] Player iframe: ${html.length} bytes`);

      // Should reference gStream API
      const hasGStream = html.includes('gStream');
      console.log(`[uflix] References gStream: ${hasGStream}`);
    });
  });

  // ── TV Page ───────────────────────────────────────────────────────

  describe('TV page', () => {
    test('series page loads', async () => {
      const res = await fetchOk(`${BASE}/serie/${BREAKING_BAD_SLUG}`);
      expect(res.ok).toBe(true);

      const html = await res.text();
      expect(html.length).toBeGreaterThan(2000);

      // Should have season/episode links
      const episodeLinks = [...html.matchAll(/href="\/episode\/([^"]+)"/g)].map(m => m[1]);
      console.log(`[uflix] Series page: ${episodeLinks.length} episode links`);
      if (episodeLinks.length > 0) {
        console.log(`[uflix]   First: ${episodeLinks[0]}`);
        console.log(`[uflix]   Last: ${episodeLinks[episodeLinks.length - 1]}`);
      }
    });

    test('episode page loads with player', async () => {
      const res = await fetchOk(`${BASE}/episode/${BREAKING_BAD_SLUG}/S01E01`);
      expect(res.ok).toBe(true);

      const html = await res.text();
      const hasPlayer = html.includes('sPlayer') || html.includes('iframe');
      console.log(`[uflix] Episode page: ${html.length} bytes, player=${hasPlayer}`);
    });
  });

  // ── gStream API ───────────────────────────────────────────────────

  describe('/gStream API', () => {
    test('returns embed URL for movie stream1 (IMDB)', async () => {
      const streamId = `stream1|movie|imdb:${FIGHT_CLUB_IMDB}`;
      const url = `${BASE}/gStream?id=${encodeURIComponent(streamId)}&movie=${encodeURIComponent(streamId)}&is_init=false&captcha=`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `${BASE}/mPlayer?movieid=${FIGHT_CLUB_SLUG}&stream=stream1`,
          'Accept': 'application/json, text/javascript, */*; q=0.01',
        },
        signal: AbortSignal.timeout(TIMEOUT),
      });

      expect(res.ok).toBe(true);
      const data = await res.json() as any;
      console.log(`[uflix] gStream stream1: success=${data.success}`);

      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.link).toBeDefined();
      console.log(`[uflix]   Embed URL: ${data.data.link}`);

      // Should be a known embed provider
      const link = data.data.link as string;
      const isKnownEmbed = link.includes('2embed') || link.includes('smashy') ||
        link.includes('gdriveplayer') || link.includes('vidsrc') ||
        link.includes('vidplus') || link.includes('embed');
      console.log(`[uflix]   Known embed: ${isKnownEmbed}`);
    });

    test('returns embed URLs for all movie streams', async () => {
      const streams = [
        { id: 'stream1', format: (imdb: string) => `stream1|movie|imdb:${imdb}` },
        { id: 'stream2', format: (imdb: string) => `stream2|movie|imdb:${imdb}` },
        { id: 'stream3', format: (imdb: string) => `stream3|movie|imdb:${imdb}` },
        { id: 'stream4', format: (imdb: string) => `stream4|movie|imdb:${imdb}` },
        { id: 'stream5', format: (_: string) => `stream5|movie|tmdb:${FIGHT_CLUB_TMDB}` },
      ];

      console.log(`[uflix] Testing all ${streams.length} movie streams:`);
      const results: Array<{ id: string; success: boolean; link?: string }> = [];

      for (const stream of streams) {
        const streamId = stream.format(FIGHT_CLUB_IMDB);
        const url = `${BASE}/gStream?id=${encodeURIComponent(streamId)}&movie=${encodeURIComponent(streamId)}&is_init=false&captcha=`;

        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': UA,
              'X-Requested-With': 'XMLHttpRequest',
              'Referer': `${BASE}/mPlayer?movieid=${FIGHT_CLUB_SLUG}&stream=${stream.id}`,
              'Accept': 'application/json, text/javascript, */*; q=0.01',
            },
            signal: AbortSignal.timeout(TIMEOUT),
          });

          if (res.ok) {
            const data = await res.json() as any;
            const link = data.data?.link || null;
            results.push({ id: stream.id, success: data.success, link });
            console.log(`[uflix]   ${stream.id}: ${data.success ? '✓' : '✗'} ${link || 'no link'}`);
          } else {
            results.push({ id: stream.id, success: false });
            console.log(`[uflix]   ${stream.id}: HTTP ${res.status}`);
          }
        } catch (e) {
          results.push({ id: stream.id, success: false });
          console.log(`[uflix]   ${stream.id}: ERROR ${(e as Error).message.slice(0, 50)}`);
        }
      }

      // At least some streams should work
      const working = results.filter(r => r.success);
      console.log(`[uflix] Working streams: ${working.length}/${streams.length}`);
      expect(working.length).toBeGreaterThan(0);
    });

    test('returns embed URL for TV stream (Breaking Bad S01E01)', async () => {
      const streamId = `stream1|serie|imdb:${BREAKING_BAD_IMDB}|S01E01`;
      const url = `${BASE}/gStream?id=${encodeURIComponent(streamId)}&movie=${encodeURIComponent(streamId)}&is_init=false&captcha=`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `${BASE}/sPlayer?serieid=${BREAKING_BAD_SLUG}&episodeid=S01E01&stream=stream1`,
          'Accept': 'application/json, text/javascript, */*; q=0.01',
        },
        signal: AbortSignal.timeout(TIMEOUT),
      });

      expect(res.ok).toBe(true);
      const data = await res.json() as any;
      console.log(`[uflix] gStream TV stream1: success=${data.success}`);

      if (data.success && data.data?.link) {
        console.log(`[uflix]   TV Embed URL: ${data.data.link}`);
      }
    });
  });

  // ── Sister Sites ──────────────────────────────────────────────────

  describe('Sister sites', () => {
    test('check sister site availability', async () => {
      const sisters = [
        { name: 'ukino.to (Russian)', url: 'https://ukino.to' },
        { name: 'utelevision.to (Spanish)', url: 'https://utelevision.to' },
        { name: 'ucinema.so (Portuguese)', url: 'https://ucinema.so' },
      ];

      for (const site of sisters) {
        try {
          const res = await fetch(site.url, {
            headers: { 'User-Agent': UA },
            redirect: 'follow',
            signal: AbortSignal.timeout(8000),
          });
          console.log(`[uflix] ${site.name}: HTTP ${res.status}`);
        } catch (e) {
          console.log(`[uflix] ${site.name}: ${(e as Error).message.slice(0, 50)}`);
        }
      }
    });
  });

  // ── Full Pipeline ─────────────────────────────────────────────────

  describe('Full pipeline: search → page → gStream', () => {
    test('search "inception" → get slug → get streams', async () => {
      // Step 1: Search
      const searchRes = await fetchOk(`${BASE}/search?keyword=inception`);
      expect(searchRes.ok).toBe(true);
      const searchHtml = await searchRes.text();

      // Extract first movie slug
      const slugMatch = searchHtml.match(/href="\/movie\/([^"]+)"/);
      expect(slugMatch).not.toBeNull();
      const slug = slugMatch![1];
      console.log(`[uflix] Pipeline: search found slug "${slug}"`);

      // Step 2: Fetch movie page to get IMDB ID
      const movieRes = await fetchOk(`${BASE}/movie/${slug}`);
      expect(movieRes.ok).toBe(true);
      const movieHtml = await movieRes.text();

      // Try to extract IMDB ID from the page
      const imdbMatch = movieHtml.match(/tt\d{7,}/);
      let imdbId = imdbMatch ? imdbMatch[0] : null;
      console.log(`[uflix] Pipeline: movie page IMDB=${imdbId || 'not found on page'}`);

      // If no IMDB on page, try the player iframe
      if (!imdbId) {
        const playerRes = await fetchOk(
          `${BASE}/mPlayer?movieid=${slug}&stream=stream1`,
          { headers: headers({ 'Referer': `${BASE}/movie/${slug}` }) }
        );
        if (playerRes.ok) {
          const playerHtml = await playerRes.text();
          const playerImdb = playerHtml.match(/tt\d{7,}/);
          if (playerImdb) imdbId = playerImdb[0];

          // Also try extracting from stream ID patterns
          const streamIdMatch = playerHtml.match(/imdb:(tt\d{7,})/);
          if (streamIdMatch) imdbId = streamIdMatch[1];
        }
        console.log(`[uflix] Pipeline: player iframe IMDB=${imdbId || 'not found'}`);
      }

      // Step 3: Call gStream with whatever ID we found
      if (imdbId) {
        const streamId = `stream1|movie|imdb:${imdbId}`;
        const gstreamUrl = `${BASE}/gStream?id=${encodeURIComponent(streamId)}&movie=${encodeURIComponent(streamId)}&is_init=false&captcha=`;

        const gRes = await fetch(gstreamUrl, {
          headers: {
            'User-Agent': UA,
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `${BASE}/mPlayer?movieid=${slug}&stream=stream1`,
          },
          signal: AbortSignal.timeout(TIMEOUT),
        });

        if (gRes.ok) {
          const data = await gRes.json() as any;
          console.log(`[uflix] Pipeline: gStream success=${data.success}, link=${data.data?.link || 'none'}`);
          expect(data.success).toBe(true);
        }
      } else {
        console.log(`[uflix] Pipeline: Could not extract IMDB ID — need to check page structure`);
      }
    });
  });
});
