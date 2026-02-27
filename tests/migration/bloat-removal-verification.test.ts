/**
 * Property-Based Test: All Bloat Files and Directories Removed
 * Feature: nextjs-cloudflare-full-migration, Property 3: All Bloat Files and Directories Removed
 * **Validates: Requirements 5.1-5.10, 6.1-6.11, 11.1-11.3**
 *
 * For any path in the defined bloat removal list (quantum clients, fortress client,
 * phantom shield, honeypot traps, temporal entropy, GPU fingerprint, test pages,
 * debug routes, diagnostic dashboards, demo components, test utilities),
 * the path SHALL not exist in the filesystem.
 *
 * This is an invariant: after migration, the bloat file set and the filesystem
 * should have zero intersection.
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Bloat Paths (from design document)
// ============================================

const BLOAT_PATHS: { path: string; description: string; requirements: string }[] = [
  // Stream protection bloat (Req 5.1, 5.2)
  { path: 'app/lib/stream/quantum-client.ts', description: 'Quantum Shield v1', requirements: '5.1' },
  { path: 'app/lib/stream/quantum-client-v2.ts', description: 'Quantum Shield v2', requirements: '5.1' },
  { path: 'app/lib/stream/quantum-client-v3.ts', description: 'Quantum Shield v3', requirements: '5.1' },
  { path: 'app/lib/stream/fortress-client.ts', description: 'Fortress Client', requirements: '5.2' },

  // Bot detection bloat (Req 5.3-5.7, 11.1)
  { path: 'app/lib/utils/phantom-shield.ts', description: 'Phantom Shield', requirements: '5.3' },
  { path: 'app/lib/utils/honeypot-traps.ts', description: 'Honeypot Traps', requirements: '5.4' },
  { path: 'app/lib/utils/temporal-entropy.ts', description: 'Temporal Entropy', requirements: '5.5' },
  { path: 'app/lib/utils/gpu-fingerprint.ts', description: 'GPU Fingerprint', requirements: '5.6' },
  { path: 'app/lib/utils/global-behavioral-tracker.ts', description: 'Global Behavioral Tracker', requirements: '11.1' },
  { path: 'app/lib/hooks/usePhantomShield.ts', description: 'usePhantomShield hook', requirements: '5.7' },

  // Test/debug pages (Req 6.1-6.6, 5.8)
  { path: 'app/test-quantum', description: 'Test Quantum page', requirements: '6.1' },
  { path: 'app/test-quantum-v3', description: 'Test Quantum v3 page', requirements: '6.2' },
  { path: 'app/test-multi-language', description: 'Test Multi-Language page', requirements: '6.3' },
  { path: 'app/debug-og', description: 'Debug OG page', requirements: '6.4' },
  { path: 'app/api/test-subtitles', description: 'Test Subtitles API', requirements: '6.5' },
  { path: 'app/api/debug', description: 'Debug API routes', requirements: '6.6' },
  { path: 'app/api/user/trust', description: 'User Trust API (bloat)', requirements: '5.8' },

  // Dashboard/test components (Req 6.7-6.10, 11.2, 11.3)
  { path: 'app/components/DiagnosticDashboard', description: 'Diagnostic Dashboard', requirements: '6.7' },
  { path: 'app/components/PerformanceDashboard', description: 'Performance Dashboard', requirements: '6.8' },
  { path: 'app/components/MediaPlayerTest.js', description: 'MediaPlayerTest component', requirements: '6.9' },
  { path: 'app/components/SubtitleDemo.js', description: 'SubtitleDemo component', requirements: '11.3' },
  { path: 'app/components/SubtitleServiceTest.js', description: 'SubtitleServiceTest component', requirements: '11.3' },
  { path: 'app/components/MultiLanguageSubtitleDemo.js', description: 'MultiLanguageSubtitleDemo component', requirements: '11.3' },
  { path: 'app/hooks/useDiagnosticDashboard.js', description: 'useDiagnosticDashboard hook', requirements: '6.10' },

  // Test utility files (Req 11.2)
  { path: 'app/utils/testEnhancedVttParser.js', description: 'testEnhancedVttParser utility', requirements: '11.2' },
  { path: 'app/utils/testMultiLanguageSubtitleManager.js', description: 'testMultiLanguageSubtitleManager utility', requirements: '11.2' },

  // Neon compatibility shim (Req 2.1)
  { path: 'app/lib/db/neon-connection.ts', description: 'Neon compatibility shim', requirements: '2.1' },
];

// ============================================
// Property-Based Tests
// ============================================

describe('Feature: nextjs-cloudflare-full-migration, Property 3: All Bloat Files and Directories Removed', () => {
  const rootDir = process.cwd();

  test('Property 3: No bloat path exists in the filesystem', () => {
    /**
     * Feature: nextjs-cloudflare-full-migration, Property 3: All Bloat Files and Directories Removed
     * **Validates: Requirements 5.1-5.10, 6.1-6.11, 11.1-11.3**
     *
     * For any path in the bloat removal list, the path SHALL not exist
     * in the filesystem. The bloat file set and the filesystem should
     * have zero intersection.
     */

    const bloatPathArb = fc.constantFrom(...BLOAT_PATHS);

    fc.assert(
      fc.property(bloatPathArb, (entry) => {
        const fullPath = path.resolve(rootDir, entry.path);
        const exists = fs.existsSync(fullPath);

        if (exists) {
          throw new Error(
            `Bloat path still exists: ${entry.path} (${entry.description}). ` +
            `Requirements: ${entry.requirements}. This file/directory should have been deleted.`
          );
        }

        return true;
      }),
      { numRuns: BLOAT_PATHS.length * 5 }
    );
  });

  test('Property 3: Exhaustive check - every bloat path is removed', () => {
    /**
     * **Validates: Requirements 5.1-5.10, 6.1-6.11, 11.1-11.3**
     *
     * Deterministic exhaustive check: iterate every bloat path and verify
     * none exist. Complements the property test with 100% path coverage.
     */
    const surviving: string[] = [];

    for (const entry of BLOAT_PATHS) {
      const fullPath = path.resolve(rootDir, entry.path);
      if (fs.existsSync(fullPath)) {
        surviving.push(`${entry.path} (${entry.description}) [Req ${entry.requirements}]`);
      }
    }

    if (surviving.length > 0) {
      throw new Error(
        `Found ${surviving.length} bloat path(s) still present:\n` +
        surviving.map(s => `  • ${s}`).join('\n')
      );
    }
  });
});
