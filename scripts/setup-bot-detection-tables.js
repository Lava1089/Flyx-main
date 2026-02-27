/**
 * Bot Detection Tables Setup Script
 * Creates the bot_detections table and indexes for the unified admin panel
 */

const { getAdapter } = require('../app/lib/db/adapter');

async function setupBotDetectionTables() {
  try {
    console.log('🤖 Setting up bot detection tables...');
    
    const adapter = getAdapter();

    console.log('📊 Using D1 database');

    // Create bot_detections table (D1/SQLite)
    const createBotDetectionsTable = `CREATE TABLE IF NOT EXISTS bot_detections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          ip_address TEXT NOT NULL,
          user_agent TEXT,
          confidence_score INTEGER NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
          detection_reasons TEXT NOT NULL,
          status TEXT DEFAULT 'suspected' CHECK (status IN ('suspected', 'confirmed_bot', 'confirmed_human', 'pending_review')),
          reviewed_by TEXT,
          reviewed_at BIGINT,
          created_at BIGINT DEFAULT (strftime('%s', 'now') * 1000),
          updated_at BIGINT DEFAULT (strftime('%s', 'now') * 1000)
        )`;

    await adapter.execute(createBotDetectionsTable);
    console.log('✅ Created bot_detections table');

    // Create indexes for performance
    const indexes = [
      {
        name: 'idx_bot_detections_user_id',
        query: 'CREATE INDEX IF NOT EXISTS idx_bot_detections_user_id ON bot_detections(user_id)',
      },
      {
        name: 'idx_bot_detections_ip',
        query: 'CREATE INDEX IF NOT EXISTS idx_bot_detections_ip ON bot_detections(ip_address)',
      },
      {
        name: 'idx_bot_detections_confidence',
        query: 'CREATE INDEX IF NOT EXISTS idx_bot_detections_confidence ON bot_detections(confidence_score)',
      },
      {
        name: 'idx_bot_detections_status',
        query: 'CREATE INDEX IF NOT EXISTS idx_bot_detections_status ON bot_detections(status)',
      },
      {
        name: 'idx_bot_detections_created',
        query: 'CREATE INDEX IF NOT EXISTS idx_bot_detections_created ON bot_detections(created_at)',
      },
    ];

    for (const index of indexes) {
      try {
        await adapter.execute(index.query);
        console.log(`✅ Created index: ${index.name}`);
      } catch (e) {
        console.log(`⚠️  Index ${index.name} might already exist`);
      }
    }

    // Insert some sample bot detection data for testing
    const sampleDetections = [
      {
        user_id: 'bot_user_001',
        ip_address: '192.168.1.100',
        user_agent: 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        confidence_score: 85,
        detection_reasons: JSON.stringify(['Suspicious user agent: Mozilla/5.0 (compatible; Googlebot/2.1)', 'High request frequency: 120/min']),
        status: 'confirmed_bot',
      },
      {
        user_id: 'suspicious_user_002',
        ip_address: '10.0.0.50',
        user_agent: 'curl/7.68.0',
        confidence_score: 75,
        detection_reasons: JSON.stringify(['Suspicious user agent: curl/7.68.0', 'No JavaScript execution detected']),
        status: 'suspected',
      },
      {
        user_id: 'review_user_003',
        ip_address: '172.16.0.25',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        confidence_score: 45,
        detection_reasons: JSON.stringify(['Rapid navigation: 15 pages/min', 'Datacenter IP address detected']),
        status: 'pending_review',
      },
    ];

    const now = Date.now();
    
    for (const detection of sampleDetections) {
      const insertQuery = `INSERT OR IGNORE INTO bot_detections (user_id, ip_address, user_agent, confidence_score, detection_reasons, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

      const insertParams = [
        detection.user_id,
        detection.ip_address,
        detection.user_agent,
        detection.confidence_score,
        detection.detection_reasons,
        detection.status,
        now,
        now,
      ];

      try {
        await adapter.execute(insertQuery, insertParams);
        console.log(`✅ Inserted sample detection for ${detection.user_id}`);
      } catch (e) {
        console.log(`⚠️  Sample detection for ${detection.user_id} might already exist`);
      }
    }

    console.log('🎉 Bot detection tables setup completed successfully!');
    console.log('');
    console.log('📋 Summary:');
    console.log('- Created bot_detections table with proper constraints');
    console.log('- Created performance indexes');
    console.log('- Inserted sample detection data');
    console.log('');
    console.log('🔗 API Endpoints:');
    console.log('- GET /api/admin/bot-detection - View bot detection metrics');
    console.log('- POST /api/admin/bot-detection - Analyze user activity');
    console.log('- GET /api/admin/unified-stats - Includes bot detection metrics');

  } catch (error) {
    console.error('❌ Error setting up bot detection tables:', error);
    process.exit(1);
  }
}

// Run the setup if called directly
if (require.main === module) {
  setupBotDetectionTables();
}

module.exports = { setupBotDetectionTables };