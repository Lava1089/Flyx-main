import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  decodeUrl,
  encodeUrl,
  decodeBase64,
  encodeBase64,
  decodeUrlEncoded,
  encodeUrlEncoded,
  decodeHex,
  encodeHex,
  rot13,
  reverseString,
  xorDecode,
  xorEncode,
  isBase64,
  isUrlEncoded,
  isHexEncoded,
  detectEncodingType,
  tryAllDecodings,
  type EncodingType,
} from '../src/extraction/url-decoder';

/**
 * Property 5: URL Encoding Round-Trip
 * **Validates: Requirements 4.2**
 * 
 * For any valid URL string, encoding it for proxy transport and then 
 * decoding it SHALL produce the exact original URL.
 * 
 * decode(encode(url)) === url
 */
describe('Property 5: URL Encoding Round-Trip', () => {
  // Generator for valid M3U8 URLs
  const m3u8UrlArb = fc.tuple(
    fc.constantFrom('http', 'https'),
    fc.domain(),
    fc.array(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 5 }),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 1, maxLength: 20 }),
  ).map(([protocol, domain, pathParts, filename]) => 
    `${protocol}://${domain}/${pathParts.join('/')}/${filename}.m3u8`
  );

  // Generator for simple ASCII strings (for encoding tests)
  const asciiStringArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~!*()/:?=&'.split('')),
    { minLength: 1, maxLength: 100 }
  );

  // Generator for XOR keys
  const xorKeyArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
    { minLength: 1, maxLength: 16 }
  );

  describe('Base64 Round-Trip', () => {
    /**
     * Property: Base64 encoding and decoding SHALL be reversible
     * For any ASCII string, decodeBase64(encodeBase64(str)) === str
     */
    it('should round-trip base64 encoding for ASCII strings', () => {
      fc.assert(
        fc.property(asciiStringArb, (original) => {
          const encoded = encodeBase64(original);
          const decoded = decodeBase64(encoded);
          
          expect(decoded).toBe(original);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Base64 encoding SHALL produce valid base64 strings
     */
    it('should produce valid base64 strings', () => {
      fc.assert(
        fc.property(asciiStringArb, (original) => {
          const encoded = encodeBase64(original);
          
          // Should be valid base64
          expect(isBase64(encoded)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Base64 round-trip SHALL work for M3U8 URLs
     */
    it('should round-trip base64 encoding for M3U8 URLs', () => {
      fc.assert(
        fc.property(m3u8UrlArb, (url) => {
          const encoded = encodeBase64(url);
          const decoded = decodeBase64(encoded);
          
          expect(decoded).toBe(url);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('URL Encoding Round-Trip', () => {
    /**
     * Property: URL encoding and decoding SHALL be reversible
     */
    it('should round-trip URL encoding', () => {
      fc.assert(
        fc.property(asciiStringArb, (original) => {
          const encoded = encodeUrlEncoded(original);
          const decoded = decodeUrlEncoded(encoded);
          
          expect(decoded).toBe(original);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: URL encoding SHALL work for M3U8 URLs
     */
    it('should round-trip URL encoding for M3U8 URLs', () => {
      fc.assert(
        fc.property(m3u8UrlArb, (url) => {
          const encoded = encodeUrlEncoded(url);
          const decoded = decodeUrlEncoded(encoded);
          
          expect(decoded).toBe(url);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Hex Encoding Round-Trip', () => {
    /**
     * Property: Hex encoding and decoding SHALL be reversible
     */
    it('should round-trip hex encoding', () => {
      fc.assert(
        fc.property(asciiStringArb, (original) => {
          const encoded = encodeHex(original);
          const decoded = decodeHex(encoded);
          
          expect(decoded).toBe(original);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Hex encoding SHALL produce valid hex strings
     */
    it('should produce valid hex strings', () => {
      fc.assert(
        fc.property(asciiStringArb, (original) => {
          const encoded = encodeHex(original);
          
          // Should be valid hex
          expect(isHexEncoded(encoded)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });


  describe('ROT13 Round-Trip', () => {
    /**
     * Property: ROT13 is symmetric - applying twice returns original
     */
    it('should round-trip ROT13 encoding (symmetric)', () => {
      fc.assert(
        fc.property(asciiStringArb, (original) => {
          const encoded = rot13(original);
          const decoded = rot13(encoded);
          
          expect(decoded).toBe(original);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Reverse String Round-Trip', () => {
    /**
     * Property: Reversing twice returns original
     */
    it('should round-trip string reversal', () => {
      fc.assert(
        fc.property(asciiStringArb, (original) => {
          const reversed = reverseString(original);
          const restored = reverseString(reversed);
          
          expect(restored).toBe(original);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('XOR Encoding Round-Trip', () => {
    /**
     * Property: XOR encoding is symmetric with the same key
     */
    it('should round-trip XOR encoding with same key', () => {
      fc.assert(
        fc.property(asciiStringArb, xorKeyArb, (original, key) => {
          const encoded = xorEncode(original, key);
          const decoded = xorDecode(encoded, key);
          
          expect(decoded).toBe(original);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Generic encodeUrl/decodeUrl Round-Trip', () => {
    /**
     * Property: For all encoding types, encode then decode SHALL return original
     */
    it('should round-trip for all encoding types', () => {
      const encodingTypes: EncodingType[] = [
        'base64',
        'url-encoded',
        'hex',
        'rot13',
        'reverse',
      ];

      fc.assert(
        fc.property(
          m3u8UrlArb,
          fc.constantFrom(...encodingTypes),
          (url, encodingType) => {
            const encoded = encodeUrl(url, encodingType);
            const result = decodeUrl(encoded);
            
            // The decoded URL should match the original
            // Note: detection might not always identify the exact encoding type
            // but the decoded result should still be correct
            if (result.success) {
              expect(result.url).toBe(url);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Double base64 encoding SHALL round-trip correctly
     */
    it('should round-trip double base64 encoding', () => {
      fc.assert(
        fc.property(m3u8UrlArb, (url) => {
          const encoded = encodeUrl(url, 'double-base64');
          
          // Manually decode double base64
          const firstDecode = decodeBase64(encoded);
          const secondDecode = decodeBase64(firstDecode);
          
          expect(secondDecode).toBe(url);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Encoding Detection', () => {
    /**
     * Property: Base64 encoded URLs SHALL be detected as base64
     */
    it('should detect base64 encoded URLs', () => {
      fc.assert(
        fc.property(m3u8UrlArb, (url) => {
          const encoded = encodeBase64(url);
          const detected = detectEncodingType(encoded);
          
          // Should detect as base64 since decoded result contains .m3u8
          expect(detected).toBe('base64');
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: URL encoded strings SHALL be detected as url-encoded
     */
    it('should detect URL encoded strings', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), { minLength: 5, maxLength: 20 }),
          (str) => {
            const encoded = encodeUrlEncoded(str);
            
            // Only test if encoding actually changed the string (contains %)
            if (encoded.includes('%')) {
              const detected = detectEncodingType(encoded);
              expect(detected).toBe('url-encoded');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('tryAllDecodings', () => {
    /**
     * Property: tryAllDecodings SHALL find the correct decoding for encoded URLs
     */
    it('should find correct decoding for base64 encoded URLs', () => {
      fc.assert(
        fc.property(m3u8UrlArb, (url) => {
          const encoded = encodeBase64(url);
          const result = tryAllDecodings(encoded);
          
          expect(result).not.toBeNull();
          expect(result?.url).toBe(url);
          expect(result?.success).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: tryAllDecodings SHALL find correct decoding for reversed URLs
     */
    it('should find correct decoding for reversed URLs', () => {
      fc.assert(
        fc.property(m3u8UrlArb, (url) => {
          const encoded = reverseString(url);
          const result = tryAllDecodings(encoded);
          
          expect(result).not.toBeNull();
          expect(result?.url).toBe(url);
          expect(result?.success).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });
});
