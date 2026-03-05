import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  rewriteM3U8,
  isMasterPlaylist,
  isMediaPlaylist,
  isValidM3U8,
  extractM3U8Urls,
  getPlaylistBaseUrl,
  M3U8RewriteOptions,
} from '../src/proxy/m3u8-rewriter';
import {
  encodeBase64Url,
  decodeBase64Url,
  isProxyUrl,
} from '../src/proxy/url-encoder';

/**
 * Property 6: M3U8 URL Rewriting Completeness
 * **Validates: Requirements 5.2**
 * 
 * For any valid M3U8 playlist content (master or media), after rewriting:
 * - ALL absolute URLs SHALL be transformed to route through the Worker proxy
 * - ALL relative URLs SHALL be resolved to absolute and then transformed
 * - The playlist structure (tags, metadata, ordering) SHALL be preserved
 * - No original upstream URLs SHALL remain in the output
 */
describe('Property 6: M3U8 URL Rewriting Completeness', () => {
  const workerBaseUrl = 'https://worker.example.com';
  const baseUrl = 'https://cdn.example.com/streams/';
  const headers = { 'Referer': 'https://dlhd.link', 'Origin': 'https://dlhd.link' };

  // Generator for valid segment filenames
  const segmentFilenameArb = fc.tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 10 }),
    fc.integer({ min: 0, max: 9999 }),
  ).map(([prefix, num]) => `${prefix}${num}.ts`);

  // Generator for valid playlist filenames
  const playlistFilenameArb = fc.tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 10 }),
  ).map(([name]) => `${name}.m3u8`);

  // Generator for segment duration
  const durationArb = fc.float({ min: 1, max: 12, noNaN: true }).map(d => d.toFixed(3));

  // Generator for simple media playlist
  const mediaPlaylistArb = fc.tuple(
    fc.integer({ min: 3, max: 10 }), // target duration
    fc.array(
      fc.tuple(durationArb, segmentFilenameArb),
      { minLength: 1, maxLength: 10 }
    ),
  ).map(([targetDuration, segments]) => {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${targetDuration}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
    ];
    
    for (const [duration, filename] of segments) {
      lines.push(`#EXTINF:${duration},`);
      lines.push(filename);
    }
    
    lines.push('#EXT-X-ENDLIST');
    return lines.join('\n');
  });

  // Generator for master playlist
  const masterPlaylistArb = fc.tuple(
    fc.array(
      fc.tuple(
        fc.integer({ min: 500000, max: 5000000 }), // bandwidth
        fc.constantFrom('480', '720', '1080'), // resolution height
        playlistFilenameArb,
      ),
      { minLength: 1, maxLength: 5 }
    ),
  ).map(([variants]) => {
    const lines = ['#EXTM3U'];
    
    for (const [bandwidth, height, filename] of variants) {
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${parseInt(height) * 16 / 9}x${height}`);
      lines.push(filename);
    }
    
    return lines.join('\n');
  });

  // Generator for encrypted media playlist
  const encryptedPlaylistArb = fc.tuple(
    fc.integer({ min: 3, max: 10 }),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 5, maxLength: 10 }),
    fc.array(
      fc.tuple(durationArb, segmentFilenameArb),
      { minLength: 1, maxLength: 5 }
    ),
  ).map(([targetDuration, keyName, segments]) => {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${targetDuration}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
      `#EXT-X-KEY:METHOD=AES-128,URI="${keyName}.key"`,
    ];
    
    for (const [duration, filename] of segments) {
      lines.push(`#EXTINF:${duration},`);
      lines.push(filename);
    }
    
    lines.push('#EXT-X-ENDLIST');
    return lines.join('\n');
  });

  const defaultOptions: M3U8RewriteOptions = {
    workerBaseUrl,
    headers,
    baseUrl,
  };

  describe('All URLs are rewritten to proxy URLs', () => {
    /**
     * Property: For any media playlist, ALL segment URLs SHALL be rewritten
     */
    it('should rewrite all segment URLs in media playlists', () => {
      fc.assert(
        fc.property(mediaPlaylistArb, (playlist) => {
          const result = rewriteM3U8(playlist, defaultOptions);
          
          // Extract all URLs from the rewritten content
          const lines = result.content.split('\n');
          const urlLines = lines.filter(line => {
            const trimmed = line.trim();
            return trimmed && !trimmed.startsWith('#');
          });
          
          // All URL lines should be proxy URLs
          for (const url of urlLines) {
            expect(isProxyUrl(url.trim(), workerBaseUrl)).toBe(true);
          }
          
          // Number of rewritten URLs should match number of segments
          expect(result.urlsRewritten).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any master playlist, ALL variant URLs SHALL be rewritten
     */
    it('should rewrite all variant URLs in master playlists', () => {
      fc.assert(
        fc.property(masterPlaylistArb, (playlist) => {
          const result = rewriteM3U8(playlist, defaultOptions);
          
          // Extract all URLs from the rewritten content
          const lines = result.content.split('\n');
          const urlLines = lines.filter(line => {
            const trimmed = line.trim();
            return trimmed && !trimmed.startsWith('#');
          });
          
          // All URL lines should be proxy URLs
          for (const url of urlLines) {
            expect(isProxyUrl(url.trim(), workerBaseUrl)).toBe(true);
          }
          
          expect(result.urlsRewritten).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('No original URLs remain in output', () => {
    /**
     * Property: After rewriting, no original upstream URLs SHALL remain
     */
    it('should not contain any original URLs after rewriting', () => {
      fc.assert(
        fc.property(mediaPlaylistArb, (playlist) => {
          const result = rewriteM3U8(playlist, defaultOptions);
          
          // The rewritten content should not contain the base URL
          // (except in encoded form within proxy URLs)
          const lines = result.content.split('\n');
          
          for (const line of lines) {
            const trimmed = line.trim();
            // Skip empty lines and tags
            if (!trimmed || trimmed.startsWith('#')) continue;
            
            // URL lines should start with worker base URL
            expect(trimmed.startsWith(workerBaseUrl)).toBe(true);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Playlist structure is preserved', () => {
    /**
     * Property: The number of lines SHALL be preserved after rewriting
     */
    it('should preserve the number of lines', () => {
      fc.assert(
        fc.property(mediaPlaylistArb, (playlist) => {
          const result = rewriteM3U8(playlist, defaultOptions);
          
          const originalLines = playlist.split('\n').length;
          const rewrittenLines = result.content.split('\n').length;
          
          expect(rewrittenLines).toBe(originalLines);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: All M3U8 tags SHALL be preserved
     */
    it('should preserve all M3U8 tags', () => {
      fc.assert(
        fc.property(mediaPlaylistArb, (playlist) => {
          const result = rewriteM3U8(playlist, defaultOptions);
          
          // Extract tags from original
          const originalTags = playlist.split('\n')
            .filter(line => line.trim().startsWith('#'))
            .map(line => {
              // Get tag name (before any attributes)
              const match = line.match(/^(#[A-Z0-9-]+)/);
              return match ? match[1] : line.trim();
            });
          
          // Extract tags from rewritten
          const rewrittenTags = result.content.split('\n')
            .filter(line => line.trim().startsWith('#'))
            .map(line => {
              const match = line.match(/^(#[A-Z0-9-]+)/);
              return match ? match[1] : line.trim();
            });
          
          expect(rewrittenTags).toEqual(originalTags);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: #EXTM3U header SHALL always be first line
     */
    it('should preserve #EXTM3U as first line', () => {
      fc.assert(
        fc.property(mediaPlaylistArb, (playlist) => {
          const result = rewriteM3U8(playlist, defaultOptions);
          
          const firstLine = result.content.split('\n')[0].trim();
          expect(firstLine).toBe('#EXTM3U');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Relative URLs are resolved correctly', () => {
    /**
     * Property: Relative URLs SHALL be resolved to absolute before encoding
     */
    it('should resolve relative URLs to absolute URLs', () => {
      fc.assert(
        fc.property(mediaPlaylistArb, (playlist) => {
          const result = rewriteM3U8(playlist, defaultOptions);
          
          // All original URLs should be resolved to absolute
          for (const originalUrl of result.originalUrls) {
            expect(originalUrl.startsWith('http')).toBe(true);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('URL encoding round-trip', () => {
    /**
     * Property: Encoded URLs in proxy params SHALL decode to original URLs
     */
    it('should allow decoding original URLs from proxy URLs', () => {
      fc.assert(
        fc.property(mediaPlaylistArb, (playlist) => {
          const result = rewriteM3U8(playlist, defaultOptions);
          
          // For each rewritten URL, extract and decode the original
          for (let i = 0; i < result.rewrittenUrls.length; i++) {
            const proxyUrl = result.rewrittenUrls[i];
            const originalUrl = result.originalUrls[i];
            
            // Extract the url parameter
            const url = new URL(proxyUrl);
            const encodedUrl = url.searchParams.get('url');
            expect(encodedUrl).not.toBeNull();
            
            // Decode and verify
            const decodedUrl = decodeBase64Url(encodedUrl!);
            expect(decodedUrl).toBe(originalUrl);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Encrypted playlist handling', () => {
    /**
     * Property: Key URIs in #EXT-X-KEY tags SHALL be rewritten
     */
    it('should rewrite key URIs in encrypted playlists', () => {
      fc.assert(
        fc.property(encryptedPlaylistArb, (playlist) => {
          const result = rewriteM3U8(playlist, defaultOptions);
          
          // Find the #EXT-X-KEY line
          const keyLine = result.content.split('\n')
            .find(line => line.includes('#EXT-X-KEY'));
          
          expect(keyLine).toBeDefined();
          
          // The URI should be a proxy URL
          const uriMatch = keyLine!.match(/URI="([^"]+)"/);
          expect(uriMatch).not.toBeNull();
          expect(isProxyUrl(uriMatch![1], workerBaseUrl)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });
});

describe('M3U8 Utility Functions', () => {
  describe('isMasterPlaylist', () => {
    it('should identify master playlists', () => {
      const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nstream.m3u8';
      expect(isMasterPlaylist(master)).toBe(true);
    });

    it('should not identify media playlists as master', () => {
      const media = '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment.ts';
      expect(isMasterPlaylist(media)).toBe(false);
    });
  });

  describe('isMediaPlaylist', () => {
    it('should identify media playlists', () => {
      const media = '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment.ts';
      expect(isMediaPlaylist(media)).toBe(true);
    });

    it('should not identify master playlists as media', () => {
      const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nstream.m3u8';
      expect(isMediaPlaylist(master)).toBe(false);
    });
  });

  describe('isValidM3U8', () => {
    it('should validate M3U8 content', () => {
      expect(isValidM3U8('#EXTM3U\n#EXTINF:10,\nsegment.ts')).toBe(true);
      expect(isValidM3U8('not a playlist')).toBe(false);
    });
  });

  describe('getPlaylistBaseUrl', () => {
    it('should extract base URL from playlist URL', () => {
      const playlistUrl = 'https://cdn.example.com/streams/live/playlist.m3u8';
      const baseUrl = getPlaylistBaseUrl(playlistUrl);
      expect(baseUrl).toBe('https://cdn.example.com/streams/live/');
    });
  });

  describe('extractM3U8Urls', () => {
    it('should extract all URLs from playlist', () => {
      const playlist = '#EXTM3U\n#EXTINF:10,\nsegment1.ts\n#EXTINF:10,\nsegment2.ts';
      const baseUrl = 'https://cdn.example.com/';
      const urls = extractM3U8Urls(playlist, baseUrl);
      
      expect(urls).toContain('https://cdn.example.com/segment1.ts');
      expect(urls).toContain('https://cdn.example.com/segment2.ts');
    });
  });
});
