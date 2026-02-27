/**
 * Database Adapter Abstraction
 * 
 * Provides a unified interface for database operations using Cloudflare D1.
 * This adapter is D1-only for the Cloudflare-native architecture.
 * 
 * Requirements: 3.6, 12.8
 */

import type { D1Env } from './d1-connection';
import {
  queryD1,
  queryD1First,
  executeD1,
  batchD1,
  getD1Database,
  queryAdminD1,
  queryAdminD1First,
  executeAdminD1,
  getAdminD1Database,
} from './d1-connection';

// ============================================
// Types
// ============================================

/**
 * Database adapter type - D1 only after migration
 */
export type DatabaseType = 'd1';

/**
 * Unified query result interface
 */
export interface AdapterQueryResult<T> {
  data: T[] | null;
  error: string | null;
  source: DatabaseType;
}

/**
 * Unified single row result interface
 */
export interface AdapterSingleResult<T> {
  data: T | null;
  error: string | null;
  source: DatabaseType;
}

/**
 * Unified execute result interface
 */
export interface AdapterExecuteResult {
  success: boolean;
  error: string | null;
  changes?: number;
  lastRowId?: number;
  source: DatabaseType;
}

/**
 * Database adapter configuration
 */
export interface AdapterConfig {
  /** D1 environment (optional, for Workers context) */
  d1Env?: D1Env;
}

// ============================================
// Default Configuration
// ============================================

const defaultConfig: AdapterConfig = {};

let globalConfig: AdapterConfig = { ...defaultConfig };

/**
 * Configure the database adapter globally
 */
export function configureAdapter(config: Partial<AdapterConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * Get current adapter configuration
 */
export function getAdapterConfig(): AdapterConfig {
  return { ...globalConfig };
}

/**
 * Reset adapter configuration to defaults
 */
export function resetAdapterConfig(): void {
  globalConfig = { ...defaultConfig };
}

// ============================================
// Database Detection
// ============================================

/**
 * Check if running in Cloudflare Workers/Pages environment
 */
export function isCloudflareEnvironment(): boolean {
  // Check for Cloudflare-specific globals
  if (typeof globalThis !== 'undefined') {
    // Check for caches API (Cloudflare Workers specific)
    if ('caches' in globalThis && typeof (globalThis as unknown as { caches: { default?: unknown } }).caches?.default !== 'undefined') {
      return true;
    }
    // Check for __cf_env__ set by OpenNext
    if ('__cf_env__' in globalThis) {
      return true;
    }
  }
  return false;
}

/**
 * Determine which database to use - always D1 after migration
 */
export function determineDatabase(): DatabaseType {
  return 'd1';
}

// ============================================
// Unified Database Adapter
// ============================================

/**
 * Database adapter class providing unified interface for D1
 */
export class DatabaseAdapter {
  private config: AdapterConfig;

  constructor(config: Partial<AdapterConfig> = {}) {
    this.config = { ...globalConfig, ...config };
  }

  /**
   * Get the current database type being used
   */
  getDatabaseType(): DatabaseType {
    return 'd1';
  }

  /**
   * Execute a SELECT query and return all results
   */
  async query<T>(sql: string, params: unknown[] = []): Promise<AdapterQueryResult<T>> {
    const result = await queryD1<T>(sql, params, this.config.d1Env);
    return {
      data: result.data,
      error: result.error,
      source: 'd1',
    };
  }

  /**
   * Execute a SELECT query and return the first result
   */
  async queryFirst<T>(sql: string, params: unknown[] = []): Promise<AdapterSingleResult<T>> {
    const result = await queryD1First<T>(sql, params, this.config.d1Env);
    return {
      data: result.data,
      error: result.error,
      source: 'd1',
    };
  }

  /**
   * Execute a write operation (INSERT, UPDATE, DELETE)
   */
  async execute(sql: string, params: unknown[] = []): Promise<AdapterExecuteResult> {
    const result = await executeD1(sql, params, this.config.d1Env);
    return {
      success: result.success,
      error: result.error,
      changes: result.changes,
      lastRowId: result.lastRowId,
      source: 'd1',
    };
  }

  /**
   * Execute multiple statements in a batch
   */
  async batch<T>(
    statements: Array<{ sql: string; params?: unknown[] }>
  ): Promise<AdapterQueryResult<T>[]> {
    const results = await batchD1<T>(statements, this.config.d1Env);
    return results.map(r => ({
      data: r.data,
      error: r.error,
      source: 'd1' as DatabaseType,
    }));
  }

  /**
   * Check if the database is healthy
   */
  async healthCheck(): Promise<{ healthy: boolean; source: DatabaseType; error?: string }> {
    try {
      const db = getD1Database(this.config.d1Env);
      const result = await db.prepare('SELECT 1 as health').first<{ health: number }>();
      return {
        healthy: result?.health === 1,
        source: 'd1',
      };
    } catch (err) {
      return {
        healthy: false,
        source: 'd1',
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Get a database adapter instance with default configuration
 */
export function getAdapter(config?: Partial<AdapterConfig>): DatabaseAdapter {
  return new DatabaseAdapter(config);
}

/**
 * Quick query function using default adapter
 */
export async function adapterQuery<T>(
  sql: string,
  params: unknown[] = []
): Promise<AdapterQueryResult<T>> {
  const adapter = new DatabaseAdapter();
  return adapter.query<T>(sql, params);
}

/**
 * Quick execute function using default adapter
 */
export async function adapterExecute(
  sql: string,
  params: unknown[] = []
): Promise<AdapterExecuteResult> {
  const adapter = new DatabaseAdapter();
  return adapter.execute(sql, params);
}

// ============================================
// SQL Compatibility Helpers
// ============================================

/**
 * Convert PostgreSQL-style placeholders ($1, $2) to SQLite-style (?)
 * Useful when migrating queries from PostgreSQL to D1
 */
export function pgToSqlite(sql: string): string {
  return sql.replace(/\$\d+/g, '?');
}

/**
 * Get the appropriate datetime function for D1 (SQLite)
 */
export function getDatetimeNow(): string {
  return "datetime('now')";
}

/**
 * Get the appropriate timestamp function for D1 (SQLite)
 */
export function getTimestampNow(): string {
  return "strftime('%s', 'now') * 1000";
}

// ============================================
// Admin Database Adapter
// ============================================

/**
 * Admin database adapter class for admin_users, feedback, etc.
 * Uses the ADMIN_DB binding instead of the main DB binding
 */
export class AdminDatabaseAdapter {
  private config: AdapterConfig;

  constructor(config: Partial<AdapterConfig> = {}) {
    this.config = { ...globalConfig, ...config };
  }

  /**
   * Get the current database type being used
   */
  getDatabaseType(): DatabaseType {
    return 'd1';
  }

  /**
   * Execute a SELECT query and return all results
   */
  async query<T>(sql: string, params: unknown[] = []): Promise<AdapterQueryResult<T>> {
    const result = await queryAdminD1<T>(sql, params, this.config.d1Env);
    return {
      data: result.data,
      error: result.error,
      source: 'd1',
    };
  }

  /**
   * Execute a SELECT query and return the first result
   */
  async queryFirst<T>(sql: string, params: unknown[] = []): Promise<AdapterSingleResult<T>> {
    const result = await queryAdminD1First<T>(sql, params, this.config.d1Env);
    return {
      data: result.data,
      error: result.error,
      source: 'd1',
    };
  }

  /**
   * Execute a write operation (INSERT, UPDATE, DELETE)
   */
  async execute(sql: string, params: unknown[] = []): Promise<AdapterExecuteResult> {
    const result = await executeAdminD1(sql, params, this.config.d1Env);
    return {
      success: result.success,
      error: result.error,
      changes: result.changes,
      lastRowId: result.lastRowId,
      source: 'd1',
    };
  }

  /**
   * Check if the database is healthy
   */
  async healthCheck(): Promise<{ healthy: boolean; source: DatabaseType; error?: string }> {
    try {
      const db = getAdminD1Database(this.config.d1Env);
      const result = await db.prepare('SELECT 1 as health').first<{ health: number }>();
      return {
        healthy: result?.health === 1,
        source: 'd1',
      };
    } catch (err) {
      return {
        healthy: false,
        source: 'd1',
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}

/**
 * Get an admin database adapter instance
 */
export function getAdminAdapter(config?: Partial<AdapterConfig>): AdminDatabaseAdapter {
  return new AdminDatabaseAdapter(config);
}
