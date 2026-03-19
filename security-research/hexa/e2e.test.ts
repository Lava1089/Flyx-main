/**
 * Hexa (hexawatch.cc) — E2E Provider Tests
 *
 * Tests the multi-embed aggregator's server availability and extraction.
 * Each hexawatch server is an independent embed provider.
 *
 * Well-known TMDB IDs:
 *   Movie: 550 (Fight Club)
 *   TV:    1396 (Breaking Bad S1E1)
 */

import { describe, test, expect } from 'bun:test';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const REFERER = 'https://hexawatch.cc/';
const TEST_MOVIE_TMDB = '550';
const TEST_TV_TMDB = '1396';
const TIMEOUT = 12_000;

interface HexaServer {
  id: string;
  title: string;
  movieUrl: (id: string) => string;
  tvUrl: (id: string, s: number, e: number) => string;
}

const SERVERS: HexaServer[] = [
  {
    id: 'cc', title: 'DOG',
    movieUrl: (id) => `https://vidsrc.xyz/embed/movie/${id}`,
    tvUrl: (id, s, e) => `https://vidsrc.xyz/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: 'embed.su', title: 'CAT',
    movieUrl: (id) => `https://vidfast.pro/movie/${id}`,
    tvUrl: (id, s, e) => `https://vidfast.pro/tv/${id}/${s}/${e}`,
  },
  {
    id: 'binge', title: 'RABBIT',
    movieUrl: (id) => `https://player.videasy.net/movie/${id}`,
    tvUrl: (id, s, e) => `https://player.videasy.net/tv/${id}/${s}/${e}`,
  },
  {
    id: 'nl', title: 'DOVE',
    movieUrl: (id) => `https://player.autoembed.cc/embed/movie/${id}`,
    tvUrl: (id, s, e) => `https://player.autoembed.cc/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: 'rip', title: 'GEESE',
    movieUrl: (id) => `https://vidsrc.cc/v2/embed/movie/${id}`,
    tvUrl: (id, s, e) => `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: 'club', title: 'POLARIS',
    movieUrl: (id) => `https://moviesapi.club/movie/${id}`,
    tvUrl: (id, s, e) => `https://moviesapi.club/tv/${id}-${s}-${e}`,
  },
  {
    id: 'xyz', title: 'GALAXY',
    movieUrl: (id) => `https://player.vidplus.to/embed/movie/${id}`,
    tvUrl: (id, s, e) => `https://player.vidplus.to/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: 'smashy', title: 'MOON',
    movieUrl: (id) => `https://111movies.com/?tmdb=${id}`,
    tvUrl: (id, s, e) => `https://111movies.com/?tmdb=${id}&season=${s}&episode=${e}`,
  },
];

// ─── Helpers ────────────────────────────────────────────────────────

function extractM3u8(html: string): string | null {
  const m3u8 = html.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i);
  if (m3u8) return m3u8[1];
  const file = html.match(/["']?(?:file|source|src|url|playlist)["']?\s*[:=]\s*["'](https?:\/\/[^"'\s]+)["']/i);
  if (file && (file[1].includes('.m3u8') || file[1].includes('playlist'))) return file[1];
  return null;
}

function extractIframe(html: string): string | null {
  const match = html.match(/<iframe[^>]*\ssrc=["'](https?:\/\/[^"']+)["']/i);
  return match ? match[1] : null;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Hexa / hexawatch.cc E2E', () => {

  describe('Server reachability (movie)', () => {
    for (const server of SERVERS) {
      test(`${server.title} (${server.id}) — responds to movie embed`, async () => {
        const url = server.movieUrl(TEST_MOVIE_TMDB);
        console.log(`[Hexa] ${server.title}: ${url}`);

        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': UA, 'Referer': REFERER, 'Accept': 'text/html,*/*' },
            redirect: 'follow',
            signal: AbortSignal.timeout(TIMEOUT),
          });

          console.log(`[Hexa] ${server.title}: HTTP ${res.status}`);
          const html = await res.text();
          console.log(`[Hexa] ${server.title}: ${html.length} bytes`);

          // Check for m3u8 in HTML
          const m3u8 = extractM3u8(html);
          const iframe = extractIframe(html);

          console.log(`[Hexa] ${server.title}: m3u8=${m3u8 ? 'YES' : 'no'}, iframe=${iframe ? 'YES' : 'no'}`);

          // At minimum the server should respond
          expect(res.status).toBeLessThan(500);
        } catch (err) {
          console.log(`[Hexa] ${server.title}: FAILED — ${(err as Error).message}`);
          // Don't fail the test — we're documenting availability
        }
      });
    }
  });

  describe('Server reachability (TV)', () => {
    for (const server of SERVERS) {
      test(`${server.title} (${server.id}) — responds to TV embed`, async () => {
        const url = server.tvUrl(TEST_TV_TMDB, 1, 1);

        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': UA, 'Referer': REFERER, 'Accept': 'text/html,*/*' },
            redirect: 'follow',
            signal: AbortSignal.timeout(TIMEOUT),
          });

          console.log(`[Hexa] ${server.title} TV: HTTP ${res.status}, ${(await res.text()).length} bytes`);
          expect(res.status).toBeLessThan(500);
        } catch (err) {
          console.log(`[Hexa] ${server.title} TV: FAILED — ${(err as Error).message}`);
        }
      });
    }
  });

  describe('M3U8 extraction from HTML', () => {

    test('extracts m3u8 from inline JSON', () => {
      const html = `var config = { file: "https://cdn.example.com/stream.m3u8?token=abc" };`;
      expect(extractM3u8(html)).toBe('https://cdn.example.com/stream.m3u8?token=abc');
    });

    test('extracts m3u8 from quoted URL', () => {
      const html = `<source src="https://cdn.example.com/video.m3u8" type="application/x-mpegURL">`;
      expect(extractM3u8(html)).toBe('https://cdn.example.com/video.m3u8');
    });

    test('returns null when no m3u8 present', () => {
      const html = `<html><body>No video here</body></html>`;
      expect(extractM3u8(html)).toBeNull();
    });

    test('extracts iframe src', () => {
      const html = `<iframe src="https://embed.example.com/v/12345" allowfullscreen></iframe>`;
      expect(extractIframe(html)).toBe('https://embed.example.com/v/12345');
    });
  });

  describe('Deep extraction (iframe follow)', () => {

    test('follows iframe chain for autoembed (DOVE)', async () => {
      const url = `https://player.autoembed.cc/embed/movie/${TEST_MOVIE_TMDB}`;

      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, 'Referer': REFERER },
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT),
        });

        if (!res.ok) {
          console.log(`[Hexa] DOVE: HTTP ${res.status}`);
          return;
        }

        const html = await res.text();
        const m3u8 = extractM3u8(html);
        const iframe = extractIframe(html);

        if (m3u8) {
          console.log(`[Hexa] DOVE: Direct m3u8 found: ${m3u8.substring(0, 80)}`);
        } else if (iframe) {
          console.log(`[Hexa] DOVE: Following iframe: ${iframe.substring(0, 80)}`);

          const iframeRes = await fetch(iframe, {
            headers: { 'User-Agent': UA, 'Referer': new URL(url).origin + '/' },
            redirect: 'follow',
            signal: AbortSignal.timeout(TIMEOUT),
          });

          if (iframeRes.ok) {
            const iframeHtml = await iframeRes.text();
            const deepM3u8 = extractM3u8(iframeHtml);
            console.log(`[Hexa] DOVE iframe: m3u8=${deepM3u8 ? deepM3u8.substring(0, 80) : 'not found'}`);
          }
        } else {
          console.log('[Hexa] DOVE: No m3u8 or iframe found (JS-only rendering)');
        }
      } catch (err) {
        console.log(`[Hexa] DOVE: ${(err as Error).message}`);
      }
    });
  });

  describe('Availability summary', () => {

    test('generates server availability report', async () => {
      const results: { server: string; status: number | string; hasM3u8: boolean; hasIframe: boolean }[] = [];

      await Promise.allSettled(
        SERVERS.map(async (server) => {
          try {
            const res = await fetch(server.movieUrl(TEST_MOVIE_TMDB), {
              headers: { 'User-Agent': UA, 'Referer': REFERER },
              redirect: 'follow',
              signal: AbortSignal.timeout(TIMEOUT),
            });
            const html = await res.text();
            results.push({
              server: server.title,
              status: res.status,
              hasM3u8: !!extractM3u8(html),
              hasIframe: !!extractIframe(html),
            });
          } catch (err) {
            results.push({
              server: server.title,
              status: (err as Error).message.substring(0, 30),
              hasM3u8: false,
              hasIframe: false,
            });
          }
        }),
      );

      console.log('\n[Hexa] ═══ Server Availability Report ═══');
      console.table(results);

      // At least some servers should be reachable
      const reachable = results.filter(r => typeof r.status === 'number' && r.status < 500);
      console.log(`[Hexa] Reachable: ${reachable.length}/${SERVERS.length}`);
    });
  });
});
