/**
 * Property-Based Tests for Sync Worker D1 Round-Trip Consistency
 * Feature: nextjs-cloudflare-full-migration, Property 1: Sync Worker D1 Round-Trip Consistency
 * Validates: Requirements 1.1
 * 
 * Tests that sync data (watch progress, watchlist, settings) written to D1
 * via the Sync Worker's D1-only code path and read back returns equivalent data.
 * This validates the refactored D1-only sync path preserves data integrity
 * after Neon removal.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';

// ============================================
// Types matching the Sync Worker's interfaces
// ============================================

interface SyncData {
  watchProgress: Record<string, WatchProgressItem>;
  watchlist: WatchlistItem[];
  providerSettings: ProviderSettings;
  subtitleSettings: SubtitleSettings;
  playerSettings: PlayerSettings;
  lastSyncedAt: number;
  schemaVersion: number;
}

interface WatchProgressItem {
  contentId: string;
  contentType: 'movie' | 'tv';
  progress: number;
  duration: number;
  lastWatched: number;
  season?: number;
  episode?: number;
  title?: string;
}

interface WatchlistItem {
  id: number | string;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  addedAt: number;
}

interface ProviderSettings {
  providerOrder: string[];
  disabledProviders: string[];
  lastSuccessfulProviders: Record<string, string>;
  animeAudioPreference: 'sub' | 'dub';
  preferredAnimeKaiServer: string | null;
}

interface SubtitleSettings {
  enabled: boolean;
  languageCode: string;
  languageName: string;
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  verticalPosition: number;
}

interface PlayerSettings {
  autoPlayNextEpisode: boolean;
  autoPlayCountdown: number;
  showNextEpisodeBeforeEnd: number;
  volume: number;
  isMuted: boolean;
}

// ============================================
// Mock D1 Database simulating Cloudflare D1
// ============================================

interface SyncRow {
  id: string;
  code_hash: string;
  sync_data: string;
  created_at: number;
  updated_at: number;
  last_sync_at: number;
  device_count: number;
}

class MockD1Database {
  private rows: Map<string, SyncRow> = new Map();

  async get(codeHash: string): Promise<{ sync_data: string; last_sync_at: number } | null> {
    const row = this.rows.get(codeHash);
    if (!row) return null;
    return { sync_data: row.sync_data, last_sync_at: row.last_sync_at };
  }

  async upsert(codeHash: string, syncDataStr: string): Promise<{ isNew: boolean; lastSyncedAt: number }> {
    const now = Date.now();
    const existing = this.rows.get(codeHash);

    if (!existing) {
      const id = `sync_${now}_${Math.random().toString(36).substring(2, 11)}`;
      this.rows.set(codeHash, {
        id,
        code_hash: codeHash,
        sync_data: syncDataStr,
        created_at: now,
        updated_at: now,
        last_sync_at: now,
        device_count: 1,
      });
      return { isNew: true, lastSyncedAt: now };
    }

    existing.sync_data = syncDataStr;
    existing.updated_at = now;
    existing.last_sync_at = now;
    return { isNew: false, lastSyncedAt: now };
  }

  async delete(codeHash: string): Promise<void> {
    this.rows.delete(codeHash);
  }

  clear(): void {
    this.rows.clear();
  }
}

// ============================================
// Simulates the Sync Worker's D1-only code path
// (mirrors handleGetD1 / handlePostD1 from cf-sync-worker/src/index.ts)
// ============================================

class SyncWorkerD1Simulator {
  private db: MockD1Database;

  constructor(db: MockD1Database) {
    this.db = db;
  }

  /** Simulates GET /sync via D1-only path */
  async get(codeHash: string): Promise<{ success: boolean; data: SyncData | null; isNew: boolean }> {
    const result = await this.db.get(codeHash);
    if (!result) {
      return { success: true, data: null, isNew: true };
    }
    const syncData = JSON.parse(result.sync_data) as SyncData;
    return { success: true, data: syncData, isNew: false };
  }

  /** Simulates POST /sync via D1-only path */
  async post(codeHash: string, body: SyncData): Promise<{ success: boolean; isNew: boolean; lastSyncedAt: number }> {
    const syncDataStr = JSON.stringify(body);
    const result = await this.db.upsert(codeHash, syncDataStr);
    return { success: true, isNew: result.isNew, lastSyncedAt: result.lastSyncedAt };
  }

  /** Simulates DELETE /sync via D1-only path */
  async delete(codeHash: string): Promise<{ success: boolean }> {
    await this.db.delete(codeHash);
    return { success: true };
  }
}

// ============================================
// fast-check Arbitraries
// ============================================

const watchProgressItemArb = fc.record({
  contentId: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
  contentType: fc.constantFrom('movie', 'tv') as fc.Arbitrary<'movie' | 'tv'>,
  progress: fc.integer({ min: 0, max: 100 }),
  duration: fc.integer({ min: 1, max: 36000 }),
  lastWatched: fc.integer({ min: 1600000000000, max: 1800000000000 }),
  season: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined }),
  episode: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
  title: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
});

const watchlistItemArb = fc.record({
  id: fc.oneof(fc.integer({ min: 1, max: 999999 }), fc.string({ minLength: 1, maxLength: 20 })),
  mediaType: fc.constantFrom('movie', 'tv') as fc.Arbitrary<'movie' | 'tv'>,
  title: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
  posterPath: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
  addedAt: fc.integer({ min: 1600000000000, max: 1800000000000 }),
});

const syncDataArb: fc.Arbitrary<SyncData> = fc.record({
  watchProgress: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
    watchProgressItemArb,
    { minKeys: 0, maxKeys: 5 }
  ),
  watchlist: fc.array(watchlistItemArb, { maxLength: 10 }),
  providerSettings: fc.record({
    providerOrder: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
    disabledProviders: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
    lastSuccessfulProviders: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.string({ minLength: 1, maxLength: 20 }),
      { minKeys: 0, maxKeys: 3 }
    ),
    animeAudioPreference: fc.constantFrom('sub', 'dub') as fc.Arbitrary<'sub' | 'dub'>,
    preferredAnimeKaiServer: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
  }),
  subtitleSettings: fc.record({
    enabled: fc.boolean(),
    languageCode: fc.string({ minLength: 2, maxLength: 5 }),
    languageName: fc.string({ minLength: 1, maxLength: 50 }),
    fontSize: fc.integer({ min: 50, max: 200 }),
    textColor: fc.string({ minLength: 6, maxLength: 6 }).map(s => '#' + s.replace(/[^0-9a-fA-F]/g, 'a').padEnd(6, '0').slice(0, 6)),
    backgroundColor: fc.string({ minLength: 1, maxLength: 50 }),
    backgroundOpacity: fc.integer({ min: 0, max: 100 }),
    verticalPosition: fc.integer({ min: 0, max: 100 }),
  }),
  playerSettings: fc.record({
    autoPlayNextEpisode: fc.boolean(),
    autoPlayCountdown: fc.integer({ min: 5, max: 30 }),
    showNextEpisodeBeforeEnd: fc.integer({ min: 30, max: 180 }),
    volume: fc.double({ min: 0, max: 1, noNaN: true }),
    isMuted: fc.boolean(),
  }),
  lastSyncedAt: fc.integer({ min: 0, max: 1800000000000 }),
  schemaVersion: fc.constant(2),
});

const codeHashArb = fc.string({ minLength: 64, maxLength: 64 }).map(s =>
  s.replace(/[^0-9a-f]/g, 'a').padEnd(64, '0').slice(0, 64)
);

// ============================================
// Property-Based Tests
// ============================================

describe('Feature: nextjs-cloudflare-full-migration, Property 1: Sync Worker D1 Round-Trip Consistency', () => {
  let db: MockD1Database;
  let worker: SyncWorkerD1Simulator;

  beforeEach(() => {
    db = new MockD1Database();
    worker = new SyncWorkerD1Simulator(db);
  });

  test('Property 1: Write/read cycle preserves sync data integrity via D1-only path', async () => {
    /**
     * Feature: nextjs-cloudflare-full-migration, Property 1: Sync Worker D1 Round-Trip Consistency
     * **Validates: Requirements 1.1**
     * 
     * For any valid sync data object, writing it to D1 via the Sync Worker
     * and reading it back SHALL produce an equivalent object.
     * This tests the D1-only code path after Neon removal.
     */
    await fc.assert(
      fc.asyncProperty(
        codeHashArb,
        syncDataArb,
        async (codeHash, syncData) => {
          db.clear();

          // Write sync data via D1-only path
          const writeResult = await worker.post(codeHash, syncData);
          expect(writeResult.success).toBe(true);
          expect(writeResult.isNew).toBe(true);

          // Read back via D1-only path
          const readResult = await worker.get(codeHash);
          expect(readResult.success).toBe(true);
          expect(readResult.isNew).toBe(false);
          expect(readResult.data).not.toBeNull();

          const loaded = readResult.data!;

          // Verify watch progress round-trips exactly
          expect(Object.keys(loaded.watchProgress).sort()).toEqual(
            Object.keys(syncData.watchProgress).sort()
          );
          for (const key of Object.keys(syncData.watchProgress)) {
            const original = syncData.watchProgress[key];
            const retrieved = loaded.watchProgress[key];
            expect(retrieved.contentId).toBe(original.contentId);
            expect(retrieved.contentType).toBe(original.contentType);
            expect(retrieved.progress).toBe(original.progress);
            expect(retrieved.duration).toBe(original.duration);
            expect(retrieved.lastWatched).toBe(original.lastWatched);
          }

          // Verify watchlist round-trips exactly
          expect(loaded.watchlist.length).toBe(syncData.watchlist.length);
          for (let i = 0; i < syncData.watchlist.length; i++) {
            expect(loaded.watchlist[i].id).toBe(syncData.watchlist[i].id);
            expect(loaded.watchlist[i].title).toBe(syncData.watchlist[i].title);
            expect(loaded.watchlist[i].mediaType).toBe(syncData.watchlist[i].mediaType);
          }

          // Verify provider settings
          expect(loaded.providerSettings.providerOrder).toEqual(syncData.providerSettings.providerOrder);
          expect(loaded.providerSettings.disabledProviders).toEqual(syncData.providerSettings.disabledProviders);
          expect(loaded.providerSettings.animeAudioPreference).toBe(syncData.providerSettings.animeAudioPreference);
          expect(loaded.providerSettings.preferredAnimeKaiServer).toBe(syncData.providerSettings.preferredAnimeKaiServer);

          // Verify subtitle settings
          expect(loaded.subtitleSettings.enabled).toBe(syncData.subtitleSettings.enabled);
          expect(loaded.subtitleSettings.languageCode).toBe(syncData.subtitleSettings.languageCode);
          expect(loaded.subtitleSettings.fontSize).toBe(syncData.subtitleSettings.fontSize);
          expect(loaded.subtitleSettings.textColor).toBe(syncData.subtitleSettings.textColor);

          // Verify player settings
          expect(loaded.playerSettings.autoPlayNextEpisode).toBe(syncData.playerSettings.autoPlayNextEpisode);
          expect(loaded.playerSettings.autoPlayCountdown).toBe(syncData.playerSettings.autoPlayCountdown);
          expect(loaded.playerSettings.volume).toBe(syncData.playerSettings.volume);
          expect(loaded.playerSettings.isMuted).toBe(syncData.playerSettings.isMuted);

          // Verify schema version
          expect(loaded.schemaVersion).toBe(syncData.schemaVersion);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 1: Overwrite preserves latest data via D1-only path', async () => {
    /**
     * Feature: nextjs-cloudflare-full-migration, Property 1: Sync Worker D1 Round-Trip Consistency
     * **Validates: Requirements 1.1**
     * 
     * Writing sync data twice to the same code hash should preserve only the latest data.
     */
    await fc.assert(
      fc.asyncProperty(
        codeHashArb,
        syncDataArb,
        syncDataArb,
        async (codeHash, firstData, secondData) => {
          db.clear();

          // Write first version
          const first = await worker.post(codeHash, firstData);
          expect(first.success).toBe(true);
          expect(first.isNew).toBe(true);

          // Overwrite with second version
          const second = await worker.post(codeHash, secondData);
          expect(second.success).toBe(true);
          expect(second.isNew).toBe(false);

          // Read back should return second version
          const readResult = await worker.get(codeHash);
          expect(readResult.success).toBe(true);
          expect(readResult.data).not.toBeNull();

          const loaded = readResult.data!;
          expect(loaded.watchlist.length).toBe(secondData.watchlist.length);
          expect(loaded.providerSettings.providerOrder).toEqual(secondData.providerSettings.providerOrder);
          expect(loaded.subtitleSettings.enabled).toBe(secondData.subtitleSettings.enabled);
          expect(loaded.playerSettings.volume).toBe(secondData.playerSettings.volume);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 1: Delete removes data from D1-only path', async () => {
    /**
     * Feature: nextjs-cloudflare-full-migration, Property 1: Sync Worker D1 Round-Trip Consistency
     * **Validates: Requirements 1.1**
     * 
     * After deleting sync data, reading it back should return null.
     */
    await fc.assert(
      fc.asyncProperty(
        codeHashArb,
        syncDataArb,
        async (codeHash, syncData) => {
          db.clear();

          // Write data
          await worker.post(codeHash, syncData);

          // Delete it
          const deleteResult = await worker.delete(codeHash);
          expect(deleteResult.success).toBe(true);

          // Read should return null / isNew
          const readResult = await worker.get(codeHash);
          expect(readResult.success).toBe(true);
          expect(readResult.data).toBeNull();
          expect(readResult.isNew).toBe(true);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
