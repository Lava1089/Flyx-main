import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  parseKeyTag,
  buildKeyTag,
  rewriteKeyTag,
  findKeyTags,
  hasEncryptionKeys,
  getEncryptionMethod,
  rewriteAllKeyTags,
  extractKeyUris,
  KeyTagInfo,
} from '../src/proxy/key-rewriter';
import { isProxyUrl, decodeBase64Url } from '../src/proxy/url-encoder';

/**
 * Property 8: Encryption Key Proxying
 * **Validates: Requirements 5.5, 5.6**
 * 
 * For any M3U8 playlist containing #EXT-X-KEY tags with URI attributes,
 * the rewritten playlist SHALL have those URIs transformed to route
 * through the Worker's key proxy endpoint.
 */
describe('Property 8: Encryption Key Proxying', () => {
  const workerBaseUrl = 'https://worker.example.com';
  const baseUrl = 'https://cdn.example.com/streams/';
  const headers = { 'Referer': 'https://dlhd.link', 'Origin': 'https://dlhd.link' };

  // Generator for key filenames
  const keyFilenameArb = fc.tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 10 }),
  ).map(([name]) => `${name}.key`);

  // Generator for IV values (hex string)
  const ivArb = fc.hexaString({ minLength: 32, maxLength: 32 }).map(hex => `0x${hex.toUpperCase()}`);

  // Generator for encryption methods
  const methodArb = fc.constantFrom('AES-128', 'SAMPLE-AES');

  // Generator for key tag info
  const keyTagInfoArb = fc.tuple(
    methodArb,
    keyFilenameArb,
    fc.option(ivArb, { nil: undefined }),
  ).map(([method, uri, iv]): KeyTagInfo => ({
    method,
    uri,
    iv: iv ?? undefined,
  }));

  // Generator for #EXT-X-KEY tag lines
  const keyTagLineArb = keyTagInfoArb.map(info => buildKeyTag(info));

  // Generator for encrypted playlist content
  const encryptedPlaylistArb = fc.tuple(
    fc.integer({ min: 3, max: 10 }),
    keyFilenameArb,
    fc.option(ivArb, { nil: undefined }),
    fc.array(
      fc.tuple(
        fc.float({ min: 1, max: 12, noNaN: true }).map(d => d.toFixed(3)),
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 10 }).map(s => `${s}.ts`),
      ),
      { minLength: 1, maxLength: 5 }
    ),
  ).map(([targetDuration, keyFile, iv, segments]) => {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${targetDuration}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
    ];
    
    // Add key tag
    const keyParts = [`METHOD=AES-128`, `URI="${keyFile}"`];
    if (iv) {
      keyParts.push(`IV=${iv}`);
    }
    lines.push(`#EXT-X-KEY:${keyParts.join(',')}`);
    
    for (const [duration, filename] of segments) {
      lines.push(`#EXTINF:${duration},`);
      lines.push(filename);
    }
    
    lines.push('#EXT-X-ENDLIST');
    return lines.join('\n');
  });

  describe('Key tag parsing', () => {
    /**
     * Property: parseKeyTag SHALL extract all attributes from valid key tags
     */
    it('should parse all attributes from key tags', () => {
      fc.assert(
        fc.property(keyTagInfoArb, (keyInfo) => {
          const tagLine = buildKeyTag(keyInfo);
          const parsed = parseKeyTag(tagLine);
          
          expect(parsed).not.toBeNull();
          expect(parsed!.method).toBe(keyInfo.method);
          expect(parsed!.uri).toBe(keyInfo.uri);
          
          if (keyInfo.iv) {
            expect(parsed!.iv).toBe(keyInfo.iv);
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: buildKeyTag(parseKeyTag(tag)) SHALL produce equivalent tag
     */
    it('should round-trip key tag parsing and building', () => {
      fc.assert(
        fc.property(keyTagInfoArb, (keyInfo) => {
          const originalTag = buildKeyTag(keyInfo);
          const parsed = parseKeyTag(originalTag);
          const rebuilt = buildKeyTag(parsed!);
          
          // Parse both to compare (order may differ)
          const parsedOriginal = parseKeyTag(originalTag);
          const parsedRebuilt = parseKeyTag(rebuilt);
          
          expect(parsedRebuilt!.method).toBe(parsedOriginal!.method);
          expect(parsedRebuilt!.uri).toBe(parsedOriginal!.uri);
          expect(parsedRebuilt!.iv).toBe(parsedOriginal!.iv);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Key URI rewriting', () => {
    /**
     * Property: All key URIs SHALL be rewritten to proxy URLs
     */
    it('should rewrite key URIs to proxy URLs', () => {
      fc.assert(
        fc.property(keyTagLineArb, (tagLine) => {
          const result = rewriteKeyTag(tagLine, baseUrl, workerBaseUrl, headers);
          
          expect(result).not.toBeNull();
          expect(isProxyUrl(result!.proxyUrl, workerBaseUrl)).toBe(true);
          
          // The rewritten tag should contain the proxy URL
          expect(result!.rewrittenTag).toContain(workerBaseUrl);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Rewritten key URIs SHALL decode to original URIs
     */
    it('should allow decoding original key URIs from proxy URLs', () => {
      fc.assert(
        fc.property(keyTagLineArb, (tagLine) => {
          const result = rewriteKeyTag(tagLine, baseUrl, workerBaseUrl, headers);
          
          expect(result).not.toBeNull();
          
          // Extract the url parameter from proxy URL
          const url = new URL(result!.proxyUrl);
          const encodedUrl = url.searchParams.get('url');
          expect(encodedUrl).not.toBeNull();
          
          // Decode and verify it matches the resolved original
          const decodedUrl = decodeBase64Url(encodedUrl!);
          expect(decodedUrl).toContain(result!.keyInfo.uri);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Key proxy URLs SHALL use the /live/key endpoint
     */
    it('should use /live/key endpoint for key proxy URLs', () => {
      fc.assert(
        fc.property(keyTagLineArb, (tagLine) => {
          const result = rewriteKeyTag(tagLine, baseUrl, workerBaseUrl, headers);
          
          expect(result).not.toBeNull();
          expect(result!.proxyUrl).toContain('/live/key');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Playlist key rewriting', () => {
    /**
     * Property: All #EXT-X-KEY tags in playlist SHALL be rewritten
     */
    it('should rewrite all key tags in encrypted playlists', () => {
      fc.assert(
        fc.property(encryptedPlaylistArb, (playlist) => {
          const result = rewriteAllKeyTags(playlist, baseUrl, workerBaseUrl, headers);
          
          // Find key tags in rewritten content
          const keyTags = findKeyTags(result.content);
          
          // All key tags should have proxy URIs
          for (const tag of keyTags) {
            const parsed = parseKeyTag(tag);
            if (parsed && parsed.method !== 'NONE') {
              expect(isProxyUrl(parsed.uri, workerBaseUrl)).toBe(true);
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Number of key tags SHALL be preserved after rewriting
     */
    it('should preserve number of key tags', () => {
      fc.assert(
        fc.property(encryptedPlaylistArb, (playlist) => {
          const originalKeyTags = findKeyTags(playlist);
          const result = rewriteAllKeyTags(playlist, baseUrl, workerBaseUrl, headers);
          const rewrittenKeyTags = findKeyTags(result.content);
          
          expect(rewrittenKeyTags.length).toBe(originalKeyTags.length);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: No original key URIs SHALL remain after rewriting
     */
    it('should not contain original key URIs after rewriting', () => {
      fc.assert(
        fc.property(encryptedPlaylistArb, (playlist) => {
          // Extract original key URIs
          const originalUris = extractKeyUris(playlist, baseUrl);
          
          const result = rewriteAllKeyTags(playlist, baseUrl, workerBaseUrl, headers);
          
          // None of the original URIs should appear in the rewritten content
          // (except in encoded form within proxy URLs)
          const keyTags = findKeyTags(result.content);
          for (const tag of keyTags) {
            const parsed = parseKeyTag(tag);
            if (parsed && parsed.method !== 'NONE') {
              // The URI should be a proxy URL, not an original URL
              expect(parsed.uri.startsWith(workerBaseUrl)).toBe(true);
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Encryption detection', () => {
    /**
     * Property: hasEncryptionKeys SHALL return true for encrypted playlists
     */
    it('should detect encryption in encrypted playlists', () => {
      fc.assert(
        fc.property(encryptedPlaylistArb, (playlist) => {
          expect(hasEncryptionKeys(playlist)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: getEncryptionMethod SHALL return correct method
     */
    it('should return correct encryption method', () => {
      fc.assert(
        fc.property(encryptedPlaylistArb, (playlist) => {
          const method = getEncryptionMethod(playlist);
          expect(method).toBe('AES-128');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Edge cases', () => {
    it('should handle METHOD=NONE (no encryption)', () => {
      const tag = '#EXT-X-KEY:METHOD=NONE';
      const result = rewriteKeyTag(tag, baseUrl, workerBaseUrl, headers);
      
      // NONE method should not be rewritten
      expect(result).toBeNull();
    });

    it('should handle key tags with KEYFORMAT', () => {
      const tag = '#EXT-X-KEY:METHOD=AES-128,URI="key.key",KEYFORMAT="identity"';
      const result = rewriteKeyTag(tag, baseUrl, workerBaseUrl, headers);
      
      expect(result).not.toBeNull();
      expect(result!.keyInfo.keyformat).toBe('identity');
    });

    it('should handle absolute key URIs', () => {
      const tag = '#EXT-X-KEY:METHOD=AES-128,URI="https://other.cdn.com/key.key"';
      const result = rewriteKeyTag(tag, baseUrl, workerBaseUrl, headers);
      
      expect(result).not.toBeNull();
      expect(isProxyUrl(result!.proxyUrl, workerBaseUrl)).toBe(true);
    });
  });
});
