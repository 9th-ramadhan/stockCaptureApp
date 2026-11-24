CREATE DATABASE IF NOT EXISTS stock_capture_db;
USE stock_capture_db;

-- 1. Tabel Induk: Mencatat setiap sesi / snapshot pengambilan data
CREATE TABLE IF NOT EXISTS capture_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    stock_code VARCHAR(10) NOT NULL COMMENT 'Kode emiten, misal: BBCA, BBRI, TLKM',
    capture_type ENUM('ORDERBOOK', 'BROKSUM', 'BOTH') NOT NULL,
    market_session ENUM('SESSION_1', 'SESSION_2', 'POST_CLOSING', 'AFTER_HOURS') NOT NULL DEFAULT 'AFTER_HOURS' COMMENT 'Sesi bursa saat capture (WITA/WIB)',
    last_price INT UNSIGNED DEFAULT NULL COMMENT 'Harga terakhir saat capture',
    price_change_pct DECIMAL(6, 2) DEFAULT NULL COMMENT 'Persentase perubahan harga',
    captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_time (stock_code, captured_at),
    INDEX idx_market_session (market_session, captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Tabel Detail Orderbook (Antrean Bid & Offer per level harga)
CREATE TABLE IF NOT EXISTS orderbook_entries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    stock_code VARCHAR(10) NOT NULL,
    level_order TINYINT UNSIGNED NOT NULL COMMENT 'Urutan baris antrean: 1 = terbaik/teratas (1-10)',
    bid_freq INT UNSIGNED DEFAULT 0,
    bid_lot BIGINT UNSIGNED DEFAULT 0,
    bid_price INT UNSIGNED DEFAULT NULL,
    offer_price INT UNSIGNED DEFAULT NULL,
    offer_lot BIGINT UNSIGNED DEFAULT 0,
    offer_freq INT UNSIGNED DEFAULT 0,
    captured_at DATETIME NOT NULL,
    FOREIGN KEY (session_id) REFERENCES capture_sessions(id) ON DELETE CASCADE,
    INDEX idx_ob_stock_time (stock_code, captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Tabel Detail Broker Summary (Rekap Buy, Sell, dan Net per Kode Broker)
CREATE TABLE IF NOT EXISTS broker_summaries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    stock_code VARCHAR(10) NOT NULL,
    trade_date DATE NOT NULL COMMENT 'Tanggal transaksi bursa untuk data broksum',
    broker_code VARCHAR(5) NOT NULL COMMENT 'Kode sekuritas 2 huruf, misal: YP, CC, BK, AK',
    broker_category ENUM('LOCAL', 'FOREIGN', 'GOVERNMENT', 'UNKNOWN') DEFAULT 'UNKNOWN',
    buy_lot BIGINT UNSIGNED DEFAULT 0,
    buy_value DECIMAL(18, 2) DEFAULT 0.00 COMMENT 'Nilai beli dalam Rupiah',
    avg_buy_price DECIMAL(10, 2) DEFAULT 0.00,
    sell_lot BIGINT UNSIGNED DEFAULT 0,
    sell_value DECIMAL(18, 2) DEFAULT 0.00 COMMENT 'Nilai jual dalam Rupiah',
    avg_sell_price DECIMAL(10, 2) DEFAULT 0.00,
    is_daily_final TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 jika data rekap harian final setelah tutup bursa',
    net_lot BIGINT GENERATED ALWAYS AS (CAST(buy_lot AS SIGNED) - CAST(sell_lot AS SIGNED)) STORED,
    net_value DECIMAL(18, 2) GENERATED ALWAYS AS (buy_value - sell_value) STORED,
    captured_at DATETIME NOT NULL,
    FOREIGN KEY (session_id) REFERENCES capture_sessions(id) ON DELETE CASCADE,
    INDEX idx_bs_stock_date (stock_code, trade_date),
    INDEX idx_bs_broker (broker_code, trade_date),
    INDEX idx_bs_stock_date_broker (stock_code, trade_date, broker_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
