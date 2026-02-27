/**
 * Property-Based Test: No Forbidden Legacy References in Source Files
 * Feature: nextjs-cloudflare-full-migration, Property 2: No Forbidden Legacy References in Source Files
 * **Validates: Requirements 2.2, 7.2**
 *
 * Scans all TypeScript/JavaScript source files in app/ for:
 * - Imports from `neon-connection`
 * - References to `@neondatabase`
 * - The string "vercel" (case-insensitive) in code or comments
 *
 * This is a property over the file set: the set of forbidden patterns
 * should have zero matches across all source files.
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// File Discovery
// ============================================

function getAllSourceFiles(dir: string, extensions: string[] = ['.ts', '.tsx', '.js', '.jsx']): string[] {
  const results: string[] = [];

  function walk(currentDir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      // Skip node_modules and hidden directories
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

// ============================================
// Forbidden Patterns
// ============================================

const FORBIDDEN_PATTERNS = [
  {
    name: 'neon-connection import',
    regex: /from\s+['"].*neon-connection['"]/i,
    description: 'Import from neon-connection module',
  },
  {
    name: 'neon-connection require',
    regex: /require\s*\(\s*['"].*neon-connection['"]\s*\)/i,
    description: 'Require of neon-connection module',
  },
  {
    name: '@neondatabase reference',
    regex: /@neondatabase/i,
    description: 'Reference to @neondatabase package',
  },
  {
    name: 'vercel reference',
    regex: /vercel/i,
    description: 'Reference to Vercel in code or comments',
  },
];

// ============================================
// Property-Based Tests
// ============================================

describe('Feature: nextjs-cloudflare-full-migration, Property 2: No Forbidden Legacy References in Source Files', () => {
  // Collect all source files once
  const appDir = path.resolve(process.cwd(), 'app');
  const sourceFiles = getAllSourceFiles(appDir);

  test('Property 2: No source file in app/ contains forbidden legacy references', () => {
    /**
     * Feature: nextjs-cloudflare-full-migration, Property 2: No Forbidden Legacy References in Source Files
     * **Validates: Requirements 2.2, 7.2**
     *
     * For any TypeScript or JavaScript source file in the app/ directory,
     * the file SHALL not contain imports from neon-connection,
     * references to @neondatabase/serverless, or the string "vercel"
     * (case-insensitive) in code or comments.
     */

    // Build an arbitrary that picks from the actual source files
    expect(sourceFiles.length).toBeGreaterThan(0);

    const fileArb = fc.constantFrom(...sourceFiles);

    fc.assert(
      fc.property(fileArb, (filePath: string) => {
        const content = fs.readFileSync(filePath, 'utf-8');
        const relativePath = path.relative(process.cwd(), filePath);

        for (const pattern of FORBIDDEN_PATTERNS) {
          const match = pattern.regex.exec(content);
          if (match) {
            // Find line number for better error reporting
            const lines = content.substring(0, match.index).split('\n');
            const lineNumber = lines.length;
            throw new Error(
              `Forbidden pattern "${pattern.name}" found in ${relativePath}:${lineNumber} — ` +
              `matched: "${match[0]}". ${pattern.description}`
            );
          }
        }

        return true;
      }),
      { numRuns: Math.min(sourceFiles.length * 3, 500) }
    );
  });

  test('Property 2: Exhaustive scan - every source file is clean', () => {
    /**
     * **Validates: Requirements 2.2, 7.2**
     *
     * Deterministic exhaustive check: iterate every file and verify
     * no forbidden patterns exist. This complements the property test
     * by ensuring 100% file coverage.
     */
    const violations: string[] = [];

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(process.cwd(), filePath);

      for (const pattern of FORBIDDEN_PATTERNS) {
        const match = pattern.regex.exec(content);
        if (match) {
          const lines = content.substring(0, match.index).split('\n');
          const lineNumber = lines.length;
          violations.push(
            `${relativePath}:${lineNumber} — ${pattern.name}: "${match[0]}"`
          );
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} forbidden legacy reference(s):\n` +
        violations.map(v => `  • ${v}`).join('\n')
      );
    }
  });
});
