USE stock_capture_db;

-- ============================================================================
-- MIGRASI 02: DUKUNGAN STREAMING REAL-TIME ORDERBOOK & PEMISAHAN BROKER SUMMARY
-- ============================================================================

-- 1. Tambah kolom market_session ke capture_sessions jika belum ada
SET @dbname = DATABASE();
SET @tablename = "capture_sessions";
SET @columnname = "market_session";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE capture_sessions ADD COLUMN market_session ENUM('SESSION_1', 'SESSION_2', 'POST_CLOSING', 'AFTER_HOURS') NOT NULL DEFAULT 'AFTER_HOURS' COMMENT 'Sesi bursa saat capture' AFTER capture_type"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2. Tambah kolom is_daily_final ke broker_summaries jika belum ada
SET @tablename = "broker_summaries";
SET @columnname = "is_daily_final";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE broker_summaries ADD COLUMN is_daily_final TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 jika data rekap harian final setelah tutup bursa' AFTER avg_sell_price"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. Tambah indeks komposit pencarian cepat (stock_code, trade_date, broker_code) pada broker_summaries
SET @indexname = "idx_bs_stock_date_broker";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (index_name = @indexname)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE broker_summaries ADD INDEX idx_bs_stock_date_broker (stock_code, trade_date, broker_code)"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
