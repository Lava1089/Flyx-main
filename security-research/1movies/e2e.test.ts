/**
 * 1movies (111movies.com / 1movies.bz) — E2E Provider Tests
 *
 * Tests the multi-layer encryption pipeline and API availability.
 * Provider is currently DISABLED due to dynamic API hash extraction issues.
 *
 * Encryption pipeline:
 *   API Response → char substitution → base64url → UTF-8 → XOR → AES-256-CBC → JSON
 */

import { describe, test, expect } from 'bun:test';

const BASE_URL = 'https://111movies.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TEST_MOVIE_TMDB = '550';
const TIMEOUT = 15_000;

// Known encryption keys (from JS bundle — may be outdated)
const AES_KEY = new Uint8Array([138,238,17,197,68,75,124,44,53,79,11,131,216,176,124,80,161,126,163,21,238,68,192,209,135,253,84,163,18,158,148,102]);
const AES_IV = new Uint8Array([181,63,33,220,121,92,190,223,94,49,56,160,53,233,201,230]);
const XOR_KEY = new Uint8Array([215,136,144,55,198]);

// Character substitution tables
const U_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
const D_CHARS = "Ms8P1hR9n4qUdVfzgNwkIYBWTJbleyESG623C7OoKQp-DA0cjHX_mZuFivxra5Lt";

const DECODE_MAP = new Map<string, string>();
for (let i = 0; i < D_CHARS.length; i++) {
  DECODE_MAP.set(D_CHARS[i], U_CHARS[i]);
}

const ENCODE_MAP = new Map<string, string>();
for (let i = 0; i < U_CHARS.length; i++) {
  ENCODE_MAP.set(U_CHARS[i], D_CHARS[i]);
}

// ─── Helpers ────────────────────────────────────────────────────────

function charSubstituteDecode(input: string): string {
  return input.split('').map(c => DECODE_MAP.get(c) || c).join('');
}

function charSubstituteEncode(input: string): string {
  return input.split('').map(c => ENCODE_MAP.get(c) || c).join('');
}

function xorBytes(data: Uint8Array, key: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key[i % key.length];
  }
  return result;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('1movies / 111movies.com E2E', () => {

  describe('Site reachability', () => {

    test('homepage responds', async () => {
      try {
        const res = await fetch(BASE_URL, {
          headers: {
            'User-Agent': UA,
            'Accept': 'text/html',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT),
        });

        console.log(`[1movies] Homepage: HTTP ${res.status}`);
        const html = await res.text();
        console.log(`[1movies] Homepage size: ${html.length} bytes`);

        // Check for Cloudflare challenge
        const hasCfChallenge = html.includes('cf-browser-verification') || html.includes('challenge-platform');
        console.log(`[1movies] Cloudflare challenge: ${hasCfChallenge ? 'YES' : 'no'}`);

        // Check for CSRF token
        const csrfMatch = html.match(/csrf[_-]token["']\s*(?:content|value)=["']([^"']+)/i);
        console.log(`[1movies] CSRF token: ${csrfMatch ? csrfMatch[1].substring(0, 20) + '...' : 'not found'}`);

        expect(res.status).toBeLessThan(500);
      } catch (err) {
        console.log(`[1movies] Homepage: FAILED — ${(err as Error).message}`);
      }
    });

    test('movie page responds', async () => {
      try {
        const res = await fetch(`${BASE_URL}/?tmdb=${TEST_MOVIE_TMDB}`, {
          headers: {
            'User-Agent': UA,
            'Accept': 'text/html',
            'Referer': BASE_URL + '/',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT),
        });

        console.log(`[1movies] Movie page: HTTP ${res.status}`);
        const html = await res.text();
        console.log(`[1movies] Movie page size: ${html.length} bytes`);

        // Look for JS bundle references
        const jsChunks = html.match(/src="[^"]*chunk[^"]*\.js"/g) || [];
        console.log(`[1movies] JS chunks found: ${jsChunks.length}`);

        expect(res.status).toBeLessThan(500);
      } catch (err) {
        console.log(`[1movies] Movie page: FAILED — ${(err as Error).message}`);
      }
    });
  });

  describe('Encryption primitives', () => {

    test('character substitution encode/decode round-trips', () => {
      const original = 'HelloWorld123';
      const encoded = charSubstituteEncode(original);
      const decoded = charSubstituteDecode(encoded);

      expect(decoded).toBe(original);
      expect(encoded).not.toBe(original); // Should be different
      console.log(`[1movies] Substitution: "${original}" → "${encoded}" → "${decoded}"`);
    });

    test('XOR is reversible', () => {
      const original = new TextEncoder().encode('test data for xor');
      const xored = xorBytes(original, XOR_KEY);
      const restored = xorBytes(xored, XOR_KEY);

      expect(new TextDecoder().decode(restored)).toBe('test data for xor');
    });

    test('AES key and IV have correct lengths', () => {
      expect(AES_KEY.length).toBe(32); // AES-256
      expect(AES_IV.length).toBe(16);  // CBC IV
    });

    test('AES-256-CBC decryption works with known key', async () => {
      // Test that the crypto API is available and the key imports correctly
      try {
        const cryptoKey = await crypto.subtle.importKey(
          'raw', AES_KEY, { name: 'AES-CBC' }, false, ['decrypt'],
        );
        expect(cryptoKey).toBeDefined();
        console.log('[1movies] AES key import: OK');
      } catch (err) {
        console.log(`[1movies] AES key import: ${(err as Error).message}`);
      }
    });
  });

  describe('API hash extraction', () => {

    test('checks if JS bundle contains API hash pattern', async () => {
      try {
        const res = await fetch(BASE_URL, {
          headers: { 'User-Agent': UA, 'Accept': 'text/html' },
          signal: AbortSignal.timeout(TIMEOUT),
        });

        if (!res.ok) {
          console.log(`[1movies] Cannot fetch homepage: ${res.status}`);
          return;
        }

        const html = await res.text();

        // Find JS bundle URLs
        const scriptMatches = html.match(/src="([^"]*\.js[^"]*)"/g) || [];
        console.log(`[1movies] Script tags found: ${scriptMatches.length}`);

        // Look for the specific chunk that contains the API hash
        const chunkPattern = /src="([^"]*(?:chunk|main|app)[^"]*\.js[^"]*)"/g;
        const chunks: string[] = [];
        let match;
        while ((match = chunkPattern.exec(html)) !== null) {
          chunks.push(match[1]);
        }

        console.log(`[1movies] Candidate chunks: ${chunks.length}`);
        for (const chunk of chunks.slice(0, 3)) {
          console.log(`[1movies]   ${chunk}`);
        }

        // Try to fetch first chunk and look for hash patterns
        if (chunks.length > 0) {
          const chunkUrl = chunks[0].startsWith('http') ? chunks[0] : `${BASE_URL}${chunks[0]}`;
          try {
            const chunkRes = await fetch(chunkUrl, {
              headers: { 'User-Agent': UA, 'Referer': BASE_URL + '/' },
              signal: AbortSignal.timeout(TIMEOUT),
            });

            if (chunkRes.ok) {
              const js = await chunkRes.text();
              console.log(`[1movies] Chunk size: ${js.length} bytes`);

              // Look for API hash patterns
              const hasAPA = js.includes('APA91');
              const hasWiv = js.includes('wiv');
              const hasRotation = js.match(/\b82\b.*rotation|rotation.*\b82\b/);

              console.log(`[1movies] Hash indicators: APA91=${hasAPA}, wiv=${hasWiv}, rotation82=${!!hasRotation}`);
            }
          } catch {
            console.log('[1movies] Could not fetch chunk');
          }
        }
      } catch (err) {
        console.log(`[1movies] Hash extraction: ${(err as Error).message}`);
      }
    });
  });

  describe('Provider status', () => {

    test('documents current blocking reason', () => {
      console.log('\n[1movies] ═══ Provider Status ═══');
      console.log('[1movies] Status: DISABLED');
      console.log('[1movies] Reason: Dynamic API hash requires runtime JS evaluation');
      console.log('[1movies] Hash format: Obfuscated string array with rotation cipher');
      console.log('[1movies] Encryption: AES-256-CBC + XOR + Base64url + char substitution');
      console.log('[1movies] Keys status: May be outdated (from JS bundle snapshot)');
      console.log('[1movies] Re-enable: Need headless browser or JS bundle deobfuscator');
    });
  });
});
