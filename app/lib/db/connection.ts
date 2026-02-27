/**
 * Database Connection Management - Cross-platform SQLite
 * Uses Bun's SQLite in Bun runtime and better-sqlite3 in Node.js
 */

import * as path from 'path';
import * as fs from 'fs';
import { ALL_TABLES, SCHEMA_VERSION, TABLES } from './schema';

// Dynamic import for database based on runtime
let Database: any;
let isBunRuntime = false;
let dbLoaded = false;

// Lazy load database to avoid webpack bundling bun:sqlite
const loadDatabase = () => {
  if (dbLoaded) return;
  
  // Check if running in Bun by checking for Bun global
  const runningInBun = typeof globalThis !== 'undefined' && 'Bun' in globalThis;
  
  if (runningInBun) {
    // Running in Bun - use dynamic import to avoid webpack analysis
    try {
      // Use eval to prevent webpack from analyzing this require
      const bunSqlite = eval('require')('bun:sqlite');
      Database = bunSqlite.Database;
      isBunRuntime = true;
      console.log('Using Bun SQLite');
    } catch (error) {
      console.warn('Bun SQLite not available, falling back to better-sqlite3');
      Database = require('better-sqlite3');
      isBunRuntime = false;
    }
  } else {
    // Running in Node.js
    try {
      Database = require('better-sqlite3');
      isBunRuntime = false;
      console.log('Using better-sqlite3 for Node.js');
    } catch (error) {
      console.error('better-sqlite3 not available:', error);
      throw new Error('No SQLite implementation available. Install better-sqlite3: npm install better-sqlite3');
    }
  }
  
  dbLoaded = true;
};

class DatabaseConnection {
  private static instance: DatabaseConnection | null = null;
  private db: any = null;
  private dbPath: string;
  private isInitialized = false;

  private constructor() {
    // Determine database path based on environment
    if (process.env.DATABASE_PATH) {
      // Custom database path from environment
      this.dbPath = process.env.DATABASE_PATH;
    } else {
      // Local development - use file-based database
      const dbDir = path.join(process.cwd(), 'data');
      try {
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }
        this.dbPath = path.join(dbDir, 'analytics.db');
      } catch (error) {
        console.warn('Cannot create data directory, using in-memory database:', error);
        this.dbPath = ':memory:';
      }
    }
  }

  /**
   * Get singleton database instance
   */
  static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  /**
   * Initialize database connection and schema
   */
  async initialize(): Promise<void> {
    if (this.isInitialized && this.db) {
      return;
    }

    try {
      // Load database driver
      loadDatabase();
      
      // Create database connection
      console.log(`Initializing database at: ${this.dbPath}`);
      this.db = new Database(this.dbPath);

      // Configure database settings
      try {
        // For in-memory databases, skip WAL mode
        if (this.dbPath === ':memory:') {
          this.db.exec('PRAGMA journal_mode = MEMORY;');
        } else {
          // Enable WAL mode for better concurrency (may fail in some environments)
          this.db.exec('PRAGMA journal_mode = WAL;');
        }
      } catch (walError) {
        console.warn('WAL mode not available, using default journal mode');
        this.db.exec('PRAGMA journal_mode = DELETE;');
      }
      
      // Enable foreign keys
      this.db.exec('PRAGMA foreign_keys = ON;');
      
      // Set synchronous mode for better performance
      if (this.dbPath === ':memory:') {
        this.db.exec('PRAGMA synchronous = OFF;');
      } else {
        this.db.exec('PRAGMA synchronous = NORMAL;');
      }
      
      // Set cache size (64MB)
      this.db.exec('PRAGMA cache_size = -64000;');

      // Create all tables
      for (const tableSQL of ALL_TABLES) {
        this.db.exec(tableSQL);
      }

      // Check and update schema version
      await this.ensureSchemaVersion();

      this.isInitialized = true;
      const dbType = this.dbPath === ':memory:' ? 'in-memory' : 'file-based';
      console.log(`✓ SQLite database initialized successfully (${isBunRuntime ? 'Bun' : 'Node.js'} runtime, ${dbType})`);
    } catch (error) {
      console.error('Failed to initialize database:', error);
      console.error('Database path:', this.dbPath);
      console.error('Current working directory:', process.cwd());
      console.error('Environment:', {
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_PATH: process.env.DATABASE_PATH
      });
      throw new Error(`Database initialization failed: ${error}`);
    }
  }

  /**
   * Ensure schema version is tracked
   */
  private async ensureSchemaVersion(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const existingVersion = this.db
      .prepare(`SELECT version FROM ${TABLES.SCHEMA_MIGRATIONS} ORDER BY version DESC LIMIT 1`)
      .get() as { version: number } | null;

    if (!existingVersion) {
      // First time setup
      this.db
        .prepare(`INSERT INTO ${TABLES.SCHEMA_MIGRATIONS} (version, name) VALUES (?, ?)`)
        .run(SCHEMA_VERSION, 'initial_schema');
    }
  }

  /**
   * Get database instance
   */
  getDatabase(): any {
    if (!this.db || !this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Execute a query with error handling
   */
  executeQuery<T = any>(query: string, params: any[] = []): T {
    try {
      const db = this.getDatabase();
      const stmt = db.prepare(query);
      return stmt.get(...params) as T;
    } catch (error) {
      console.error('Query execution failed:', error);
      throw new Error(`Query failed: ${error}`);
    }
  }

  /**
   * Execute multiple queries in a transaction
   */
  transaction<T>(callback: (db: any) => T): T {
    const db = this.getDatabase();
    if (isBunRuntime) {
      // Bun SQLite transaction syntax
      const transactionFn = db.transaction(() => {
        return callback(db);
      });
      return transactionFn();
    } else {
      // better-sqlite3 transaction syntax
      const transactionFn = db.transaction(callback);
      return transactionFn();
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      DatabaseConnection.instance = null;
      console.log('✓ Database connection closed');
    }
  }

  /**
   * Check if database is healthy
   */
  healthCheck(): boolean {
    try {
      const db = this.getDatabase();
      const result = db.prepare('SELECT 1 as health').get() as { health: number };
      return result.health === 1;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }
}

// Initialize and export database instance
let dbInstance: DatabaseConnection | null = null;

export const initializeDB = async () => {
  if (!dbInstance) {
    dbInstance = DatabaseConnection.getInstance();
    await dbInstance.initialize();
  }
  return dbInstance;
};

export const getDB = () => {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initializeDB() first.');
  }
  return dbInstance.getDatabase();
};

// Export for direct access
export { DatabaseConnection };
