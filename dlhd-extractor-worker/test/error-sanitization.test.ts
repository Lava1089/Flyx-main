import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  sanitizeErrorMessage,
  createSafeErrorMessage,
  containsFilePath,
  containsStackTrace,
  containsConfigDetails,
  containsUpstreamUrl,
  containsSensitiveInfo,
  getSafeErrorMessage,
  isMessageSafe,
} from '../src/utils/sanitize';

/**
 * Property 16: Error Message Sanitization
 * **Validates: Requirements 8.4**
 * 
 * *For any* error response to an unauthenticated or unauthorized request, 
 * the error message SHALL NOT contain:
 * - Internal file paths
 * - Stack traces
 * - Configuration details
 * - Upstream URLs
 */
describe('Property 16: Error Message Sanitization', () => {
  // Generators for sensitive content
  const filePathArb = fc.oneof(
    // Unix-style paths
    fc.tuple(
      fc.constantFrom('/src/', '/app/', '/home/', '/var/', '/usr/'),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'), { minLength: 1, maxLength: 20 }),
      fc.constantFrom('.ts', '.js', '.json', '.mjs')
    ).map(([prefix, name, ext]) => `${prefix}${name}${ext}`),
    // Windows-style paths
    fc.tuple(
      fc.constantFrom('C:\\', 'D:\\'),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'), { minLength: 1, maxLength: 20 }),
      fc.constantFrom('.ts', '.js', '.json')
    ).map(([prefix, name, ext]) => `${prefix}Users\\code\\${name}${ext}`)
  );

  const stackTraceArb = fc.tuple(
    fc.constantFrom('Error', 'TypeError', 'ReferenceError'),
    fc.string({ minLength: 5, maxLength: 30 }),
    fc.array(
      fc.tuple(
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 3, maxLength: 15 }),
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 3, maxLength: 15 }),
        fc.nat({ max: 1000 }),
        fc.nat({ max: 100 })
      ),
      { minLength: 1, maxLength: 5 }
    )
  ).map(([errorType, message, frames]) => {
    const stackLines = frames.map(([fn, file, line, col]) => 
      `    at ${fn} (/src/${file}.ts:${line}:${col})`
    ).join('\n');
    return `${errorType}: ${message}\n${stackLines}`;
  });

  const configDetailArb = fc.oneof(
    fc.constant('wrangler.toml'),
    fc.constant('.env.local'),
    fc.constant('.env.production'),
    fc.constant('config.json'),
    fc.stringOf(fc.constantFrom(...'abcdef0123456789'), { minLength: 32, maxLength: 36 })
      .map(id => `KV_NAMESPACE_ID=${id}`)
  );

  const upstreamUrlArb = fc.oneof(
    // Internal URLs
    fc.tuple(
      fc.constantFrom('http://', 'https://'),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 3, maxLength: 10 }),
      fc.constantFrom('.internal', '.local', '.private', '.cdn'),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz/'), { minLength: 0, maxLength: 20 })
    ).map(([proto, host, suffix, path]) => `${proto}${host}${suffix}/${path}`),
    // IP addresses
    fc.tuple(
      fc.constantFrom('http://', 'https://'),
      fc.nat({ max: 255 }),
      fc.nat({ max: 255 }),
      fc.nat({ max: 255 }),
      fc.nat({ max: 255 })
    ).map(([proto, a, b, c, d]) => `${proto}${a}.${b}.${c}.${d}/stream`),
    // Localhost
    fc.tuple(
      fc.constantFrom('http://', 'https://'),
      fc.nat({ max: 65535 })
    ).map(([proto, port]) => `${proto}localhost:${port}/api`)
  );

  // Generator for safe messages (no sensitive content)
  const safeMessageArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?-'),
    { minLength: 5, maxLength: 100 }
  ).filter(msg => !containsSensitiveInfo(msg));

  describe('File Path Detection and Sanitization', () => {
    it('should detect file paths in error messages', () => {
      fc.assert(
        fc.property(filePathArb, (filePath) => {
          const message = `Error occurred in ${filePath}`;
          expect(containsFilePath(message)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should sanitize messages containing file paths', () => {
      fc.assert(
        fc.property(filePathArb, (filePath) => {
          const message = `Error occurred in ${filePath}`;
          const sanitized = sanitizeErrorMessage(message);
          
          // Sanitized message should not contain the file path
          expect(sanitized).not.toContain(filePath);
          // Should return a safe generic message
          expect(sanitized).toBe('An internal error occurred');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Stack Trace Detection and Sanitization', () => {
    it('should detect stack traces in error messages', () => {
      fc.assert(
        fc.property(stackTraceArb, (stackTrace) => {
          expect(containsStackTrace(stackTrace)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should sanitize messages containing stack traces', () => {
      fc.assert(
        fc.property(stackTraceArb, (stackTrace) => {
          const sanitized = sanitizeErrorMessage(stackTrace);
          
          // Sanitized message should not contain stack trace
          expect(sanitized).not.toContain('at ');
          expect(sanitized).toBe('An internal error occurred');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Configuration Details Detection and Sanitization', () => {
    it('should detect configuration details in error messages', () => {
      fc.assert(
        fc.property(configDetailArb, (configDetail) => {
          const message = `Failed to load ${configDetail}`;
          expect(containsConfigDetails(message)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should sanitize messages containing configuration details', () => {
      fc.assert(
        fc.property(configDetailArb, (configDetail) => {
          const message = `Failed to load ${configDetail}`;
          const sanitized = sanitizeErrorMessage(message);
          
          // Sanitized message should not contain config details
          expect(sanitized).not.toContain(configDetail);
          expect(sanitized).toBe('An internal error occurred');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Upstream URL Detection and Sanitization', () => {
    it('should detect upstream URLs in error messages', () => {
      fc.assert(
        fc.property(upstreamUrlArb, (upstreamUrl) => {
          const message = `Failed to fetch from ${upstreamUrl}`;
          expect(containsUpstreamUrl(message)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should sanitize messages containing upstream URLs', () => {
      fc.assert(
        fc.property(upstreamUrlArb, (upstreamUrl) => {
          const message = `Failed to fetch from ${upstreamUrl}`;
          const sanitized = sanitizeErrorMessage(message);
          
          // Sanitized message should not contain upstream URL
          expect(sanitized).not.toContain(upstreamUrl);
          expect(sanitized).toBe('An internal error occurred');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Safe Messages Pass Through', () => {
    it('should allow safe messages to pass through unchanged', () => {
      fc.assert(
        fc.property(safeMessageArb, (safeMessage) => {
          const sanitized = sanitizeErrorMessage(safeMessage);
          
          // Safe messages should pass through unchanged
          expect(sanitized).toBe(safeMessage);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Unauthenticated Request Handling', () => {
    const errorCodeArb = fc.constantFrom(
      'UNAUTHORIZED',
      'FORBIDDEN',
      'INTERNAL_ERROR',
      'PARSE_ERROR',
      'FETCH_ERROR'
    );

    it('should always return safe messages for unauthenticated requests', () => {
      fc.assert(
        fc.property(
          errorCodeArb,
          fc.oneof(filePathArb, stackTraceArb, configDetailArb, upstreamUrlArb),
          (errorCode, sensitiveMessage) => {
            const safeMessage = createSafeErrorMessage(errorCode, sensitiveMessage, false);
            
            // Should not contain any sensitive information
            expect(containsSensitiveInfo(safeMessage)).toBe(false);
            // Should be a known safe message
            expect(isMessageSafe(safeMessage)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Known Error Codes', () => {
    const knownErrorCodes = [
      'UNAUTHORIZED',
      'FORBIDDEN',
      'INVALID_API_KEY',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
      'PARSE_ERROR',
      'FETCH_ERROR',
      'PROXY_ERROR',
      'EXTRACTION_ERROR',
      'CHANNEL_NOT_FOUND',
      'PLAYER_UNAVAILABLE',
      'ALL_PLAYERS_FAILED',
      'UPSTREAM_ERROR',
      'TIMEOUT',
    ];

    it('should return safe messages for all known error codes', () => {
      for (const errorCode of knownErrorCodes) {
        const safeMessage = getSafeErrorMessage(errorCode);
        
        expect(safeMessage).toBeDefined();
        expect(safeMessage.length).toBeGreaterThan(0);
        expect(isMessageSafe(safeMessage)).toBe(true);
      }
    });

    it('should return generic message for unknown error codes', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ_'), { minLength: 5, maxLength: 20 })
            .filter(code => !knownErrorCodes.includes(code)),
          (unknownCode) => {
            const safeMessage = getSafeErrorMessage(unknownCode);
            
            expect(safeMessage).toBe('An internal error occurred');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
