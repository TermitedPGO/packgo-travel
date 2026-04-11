import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  console.log('Connected to database');

  const migrations = [
    // Add calibration fields to tours table
    `ALTER TABLE tours 
      ADD COLUMN IF NOT EXISTS calibrationScore INT NULL COMMENT '0-100 total score',
      ADD COLUMN IF NOT EXISTS calibrationVerdict VARCHAR(20) NULL COMMENT 'pass | warn | fail',
      ADD COLUMN IF NOT EXISTS calibrationReport TEXT NULL COMMENT 'JSON - full CalibrationReport',
      ADD COLUMN IF NOT EXISTS calibratedAt TIMESTAMP NULL COMMENT 'when calibration was last run'`,
    
    // Add monitor fields to tours table
    `ALTER TABLE tours 
      ADD COLUMN IF NOT EXISTS lastMonitoredAt TIMESTAMP NULL COMMENT 'when the tour was last checked',
      ADD COLUMN IF NOT EXISTS monitorStatus VARCHAR(20) NULL COMMENT 'ok | changed | error',
      ADD COLUMN IF NOT EXISTS monitorChangeSummary TEXT NULL COMMENT 'latest change summary'`,
    
    // Create tourMonitorLogs table
    `CREATE TABLE IF NOT EXISTS tourMonitorLogs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tourId INT NOT NULL COMMENT 'references tours.id',
      monitoredAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'when this check ran',
      sourceUrl VARCHAR(1024) NULL COMMENT 'URL that was checked',
      departureDate VARCHAR(20) NULL COMMENT 'YYYY-MM-DD',
      previousStatus VARCHAR(20) NULL COMMENT 'open | soldout | confirmed | cancelled',
      currentStatus VARCHAR(20) NULL COMMENT 'open | soldout | confirmed | cancelled',
      previousPrice INT NULL COMMENT 'in TWD',
      currentPrice INT NULL COMMENT 'in TWD',
      priceChanged INT DEFAULT 0 COMMENT '0=no, 1=yes',
      previousSeats INT NULL,
      currentSeats INT NULL,
      seatsChanged INT DEFAULT 0 COMMENT '0=no, 1=yes',
      hasChanges INT DEFAULT 0 COMMENT '0=no changes, 1=changes detected',
      changesSummary TEXT NULL COMMENT 'human-readable summary of changes',
      rawSnapshot TEXT NULL COMMENT 'JSON - raw scraped data snapshot',
      runId VARCHAR(64) NULL COMMENT 'unique ID per monitoring run',
      status ENUM('success', 'failed', 'skipped') NOT NULL DEFAULT 'success',
      errorMessage TEXT NULL COMMENT 'if status=failed',
      durationMs INT NULL COMMENT 'how long this check took',
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tourId (tourId),
      INDEX idx_monitoredAt (monitoredAt),
      INDEX idx_runId (runId),
      INDEX idx_hasChanges (hasChanges)
    )`,
  ];

  for (const sql of migrations) {
    try {
      await conn.execute(sql);
      console.log('✅ Migration applied:', sql.substring(0, 60) + '...');
    } catch (err) {
      if (err.code === 'ER_TABLE_EXISTS_ERROR' || err.code === 'ER_DUP_FIELDNAME') {
        console.log('⏭️  Already exists, skipping:', sql.substring(0, 60) + '...');
      } else {
        console.error('❌ Migration failed:', err.message);
        throw err;
      }
    }
  }

  // Verify
  const [cols] = await conn.execute("SHOW COLUMNS FROM tours LIKE 'calibrationScore'");
  console.log('\n✅ Verification: calibrationScore exists:', cols.length > 0);
  
  const [cols2] = await conn.execute("SHOW COLUMNS FROM tours LIKE 'lastMonitoredAt'");
  console.log('✅ Verification: lastMonitoredAt exists:', cols2.length > 0);
  
  const [tables] = await conn.execute("SHOW TABLES LIKE 'tourMonitorLogs'");
  console.log('✅ Verification: tourMonitorLogs exists:', tables.length > 0);

  await conn.end();
  console.log('\n🎉 Round 32 DB migration completed!');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
