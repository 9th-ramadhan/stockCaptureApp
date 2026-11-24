# 📈 Stockbit Data Capture Backend

Backend service berbasis **Node.js**, **Express.js (ES Modules)**, **Puppeteer**, **Chrome DevTools Protocol (CDP)**, dan **MySQL (`mysql2/promise`)** yang dirancang untuk:
1. **Streaming Real-Time Orderbook (Mode 2):** Menangkap antrean Bid/Offer (level 1–10) secara real-time via WebSocket CDP dengan sampling interval & throttling 30 detik selama jam bursa BEI (`09:55–17:16 WITA`).
   - **Mekanisme Fallback Otomatis:** Apabila runner `stream:orderbook` dipaksa dijalankan di luar jam operasional (misal malam hari atau akhir pekan), sistem otomatis mendeteksi status `isPastClosingTime()` dan beralih menjalankan **capture snapshot Orderbook terakhir** (melewati streaming berkelanjutan) lalu menyimpannya ke database dengan status sesi `AFTER_HOURS`.
2. **Capture Broker Summary Harian (Mode 1):** Ekstraksi batch rekapitulasi data broker transaksi harian (Buyer & Seller) setelah bursa tutup (`17:25 WITA`) dan deduplikasi otomatis per tanggal transaksi.

---

## 📑 Daftar Isi

- [Fitur Utama](#-fitur-utama)
- [Arsitektur Sistem Terpisah (Dual Engine)](#-arsitektur-sistem-terpisah-dual-engine)
- [Struktur Folder](#-struktur-folder)
- [Prasyarat Sistem](#-prasyarat-sistem)
- [Instalasi & Migrasi Database](#-instalasi--migrasi-database)
- [Konfigurasi Environment (.env)](#-konfigurasi-environment-env)
- [Skema Database & Relasi](#-skema-database--relasi)
- [Manajemen Sesi & Cookies Stockbit](#-manajemen-sesi--cookies-stockbit)
- [Dokumentasi REST API](#-dokumentasi-rest-api)
- [Jadwal Otomasi & Windows Task Scheduler](#-jadwal-otomasi--windows-task-scheduler)
- [Strategi CDP WebSocket & Throttling 30 Detik](#-strategi-cdp-websocket--throttling-30-detik)
- [Troubleshooting & Solusi Error](#-troubleshooting--solusi-error)

---

## 🌟 Fitur Utama

1. **Streaming Real-Time Orderbook via Chrome DevTools Protocol (CDP):**
   - Mendengarkan event jaringan `Network.webSocketFrameReceived` langsung dari aliran WebSocket Stockbit.
   - Dilengkapi **parser adaptif** (JSON/Socket.io text frames) serta **DOM reader fallback aktif** agar seluruh level antrean (1–10) selalu tersinkronisasi presisi di memori (*In-Memory State Map*).
   - **Throttling 30 Detik:** Timer otomatis melakukan flushing bulk insert ke MySQL hanya ketika terjadi perubahan data (`isDirty = true`), menjaga stabilitas I/O disk database.
2. **Batch Capture Broker Summary (Broksum) Harian:**
   - Melewati parsing DOM Orderbook untuk kecepatan ekstraksi maksimal.
   - Menghitung akumulasi dan distribusi bersih (`net_lot` dan `net_value`) langsung via MySQL Stored Generated Columns.
   - Deduplikasi otomatis (menghapus data lama pada `stock_code` dan `trade_date` yang sama sebelum insert).
3. **Pencatatan Sesi Bursa Otomatis (`market_session`):**
   - Otomatis mengklasifikasikan waktu pengambilan data ke dalam sesi perdagangan BEI zona waktu WITA (`Asia/Makassar`):
     - `SESSION_1` (Senin–Kamis 10:00–13:00 / Jumat 10:00–12:30 WITA)
     - `SESSION_2` (Senin–Kamis 14:30–17:00 / Jumat 15:00–17:00 WITA)
     - `POST_CLOSING` (17:00–17:15 WITA)
     - `AFTER_HOURS` (Di luar jam bursa & akhir pekan)
4. **Hybrid Execution (Runner Otomatis):**
   - Baik `runOrderbookStream.js` maupun `runDailyBroksum.js` otomatis mendeteksi apakah server Express sedang aktif:
     - Jika Express aktif: memanggil API REST.
     - Jika Express offline: menjalankan Puppeteer Chromium & database pool secara mandiri.
5. **Manajemen Jam Bursa & Graceful Shutdown:**
   - Runner streaming otomatis berhenti saat jam bursa berakhir (`> 17:15 WITA`).
   - Menerima sinyal `SIGINT`/`SIGTERM` untuk menutup browser dan menyimpan sisa buffer secara bersih.

---

## 🏗 Arsitektur Sistem Terpisah (Dual Engine)

```
                              ┌─────────────────────────────────────────────────────────┐
                              │                 Windows Task Scheduler                  │
                              └────────────┬───────────────────────────────┬─────────────┘
                                           │                               │
                 (Setiap hari kerja 09:55 WITA)           (Setiap hari kerja 17:25 WITA)
                                           ▼                               ▼
                       ┌───────────────────────────────┐ ┌───────────────────────────────┐
                       │  runOrderbookStream.js        │ │  runDailyBroksum.js           │
                       │  (run_orderbook_stream.bat)   │ │  (run_broksum_task.bat)       │
                       └───────────────┬───────────────┘ └───────────────┬───────────────┘
                                       │                                 │
                   ┌───────────────────┴───────────────────┐             │
                   ▼                                       ▼             ▼
       [CDP WebSocket Listener]                [DOM Reader Fallback]     │ [Scrape Broksum Card]
                   │                                       │             │
                   └───────────────────┬───────────────────┘             │
                                       ▼                                 │
                       ┌───────────────────────────────┐                 │
                       │   In-Memory State Map         │                 │
                       │   (latestOrderbookMap)        │                 │
                       └───────────────┬───────────────┘                 │
                                       │ (Interval 30s)                  │
                                       ▼                                 ▼
                       ┌───────────────────────────────┐ ┌───────────────────────────────┐
                       │ saveStockCapture (ORDERBOOK)  │ │ saveStockCapture (BROKSUM)    │
                       └───────────────┬───────────────┘ └───────────────┬───────────────┘
                                       │                                 │
                                       └────────────────┬────────────────┘
                                                        ▼
                                       ┌─────────────────────────────────┐
                                       │       MySQL Database            │
                                       │       (stock_capture_db)        │
                                       └─────────────────────────────────┘
```

---

## 📁 Struktur Folder

```
backend/
├── database/
│   ├── 02_alter_realtime_support.sql  # Migrasi incremental (market_session & index)
│   ├── migrate.js                     # Runner migrasi otomatis
│   └── schema.sql                     # Skema dasar DDL lengkap
├── logs/
│   ├── orderbook_stream.log           # Log aktivitas streaming real-time
│   ├── daily_broksum.log              # Log aktivitas capture broker summary
│   └── task_scheduler.log             # Log umum Windows Task Scheduler
├── src/
│   ├── config/
│   │   └── db.js                      # MySQL connection pool
│   ├── controllers/
│   │   └── stockController.js         # Handler request API Orderbook stream & Broksum
│   ├── models/
│   │   └── stockModel.js              # Bulk insert transaksional & helper sesi bursa
│   ├── routes/
│   │   └── stockRoutes.js             # Definisi rute Express
│   ├── scripts/
│   │   ├── runOrderbookStream.js      # Runner penjadwalan Orderbook stream (09:55 WITA)
│   │   ├── runDailyBroksum.js         # Runner penjadwalan Broker Summary (17:25 WITA)
│   │   └── saveLoginSession.js        # Helper login interaktif simpan cookies
│   ├── services/
│   │   └── puppeteerService.js        # CDP WebSocket engine, throttling & parser
│   └── server.js                      # HTTP server Express
├── .env.example                       # Template konfigurasi environment
├── cookies.json                       # Sesi Stockbit aktif (JANGAN DI-COMMIT)
├── package.json                       # Dependensi dan npm scripts
├── run_orderbook_stream.bat           # Wrapper batch Orderbook Task Scheduler
└── run_broksum_task.bat               # Wrapper batch Broker Summary Task Scheduler
```

---

## 💻 Prasyarat Sistem

- **Node.js**: Versi `18.x`, `20.x`, atau `22.x+`
- **Database**: MySQL Server 8.0+ atau MariaDB 10.4+
- **Browser**: Google Chrome atau browser Chromium asli sistem
- **OS**: Windows 10/11 (mendukung batch Task Scheduler) / Linux / macOS

---

## 🚀 Instalasi & Migrasi Database

```powershell
# 1. Pindah ke direktori backend
cd d:\UserData\user\Code\stockCaptureApp\backend

# 2. Install dependensi
npm install

# 3. Buat file .env dari template
cp .env.example .env

# 4. Jalankan migrasi database
npm run db:migrate

# 5. Jalankan server pengembangan
npm run dev
```

---

## ⚙️ Konfigurasi Environment (.env)

| Variabel | Tipe | Default | Keterangan |
|---|---|---|---|
| `PORT` | Number | `5000` | Port listen server Express |
| `DB_HOST` | String | `localhost` | Host MySQL |
| `DB_PORT` | Number | `3306` | Port MySQL |
| `DB_USER` | String | `root` | Username MySQL |
| `DB_PASSWORD` | String | `""` | Password database |
| `DB_NAME` | String | `stock_capture_db` | Nama database |
| `COOKIES_PATH`| String | `./cookies.json` | Path file cookies Stockbit |
| `STREAM_INTERVAL_MS` | Number | `30000` | Interval sampling Orderbook (30 detik) |
| `MAX_STREAM_SYMBOLS` | Number | `5` | Batas jumlah emiten stream simultan |
| `DEBUG_WS` | Boolean | `false` | Cetak sampel frame mentah WebSocket ke konsol |

---

## 🗄 Skema Database & Relasi

### 1. `capture_sessions`
```sql
CREATE TABLE capture_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    stock_code VARCHAR(10) NOT NULL,
    capture_type ENUM('ORDERBOOK', 'BROKSUM', 'BOTH') NOT NULL,
    market_session ENUM('SESSION_1', 'SESSION_2', 'POST_CLOSING', 'AFTER_HOURS') NOT NULL DEFAULT 'AFTER_HOURS',
    last_price INT UNSIGNED DEFAULT NULL,
    price_change_pct DECIMAL(6, 2) DEFAULT NULL,
    captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_time (stock_code, captured_at),
    INDEX idx_market_session (market_session, captured_at)
);
```

### 2. `orderbook_entries`
Menyimpan antrean bid & offer per level (1–10).
```sql
CREATE TABLE orderbook_entries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    stock_code VARCHAR(10) NOT NULL,
    level_order TINYINT UNSIGNED NOT NULL COMMENT '1 = Best Bid / Offer',
    bid_freq INT UNSIGNED DEFAULT 0,
    bid_lot BIGINT UNSIGNED DEFAULT 0,
    bid_price INT UNSIGNED DEFAULT NULL,
    offer_price INT UNSIGNED DEFAULT NULL,
    offer_lot BIGINT UNSIGNED DEFAULT 0,
    offer_freq INT UNSIGNED DEFAULT 0,
    captured_at DATETIME NOT NULL,
    FOREIGN KEY (session_id) REFERENCES capture_sessions(id) ON DELETE CASCADE,
    INDEX idx_ob_stock_time (stock_code, captured_at)
);
```

### 3. `broker_summaries`
Menyimpan rekapitulasi data broker transaksi harian dengan kalkulasi net otomatis.
```sql
CREATE TABLE broker_summaries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    stock_code VARCHAR(10) NOT NULL,
    trade_date DATE NOT NULL,
    broker_code VARCHAR(5) NOT NULL,
    broker_category ENUM('LOCAL', 'FOREIGN', 'GOVERNMENT', 'UNKNOWN') DEFAULT 'UNKNOWN',
    buy_lot BIGINT UNSIGNED DEFAULT 0,
    buy_value DECIMAL(18, 2) DEFAULT 0.00,
    avg_buy_price DECIMAL(10, 2) DEFAULT 0.00,
    sell_lot BIGINT UNSIGNED DEFAULT 0,
    sell_value DECIMAL(18, 2) DEFAULT 0.00,
    avg_sell_price DECIMAL(10, 2) DEFAULT 0.00,
    is_daily_final TINYINT(1) NOT NULL DEFAULT 1,
    net_lot BIGINT GENERATED ALWAYS AS (CAST(buy_lot AS SIGNED) - CAST(sell_lot AS SIGNED)) STORED,
    net_value DECIMAL(18, 2) GENERATED ALWAYS AS (buy_value - sell_value) STORED,
    captured_at DATETIME NOT NULL,
    FOREIGN KEY (session_id) REFERENCES capture_sessions(id) ON DELETE CASCADE,
    INDEX idx_bs_stock_date (stock_code, trade_date),
    INDEX idx_bs_broker (broker_code, trade_date),
    INDEX idx_bs_stock_date_broker (stock_code, trade_date, broker_code)
);
```

---

## 🍪 Manajemen Sesi & Cookies Stockbit

Stockbit mewajibkan sesi login untuk data Watchlist dan Broker Summary. Sistem dilengkapi dengan **Fallback Otomatis saat Cookies Kedaluwarsa**:

### 1. Fallback Otomatis Saat Sesi Kedaluwarsa (Auto-Relogin)
Jika proses scraping mendeteksi bahwa sesi cookies sudah kedaluwarsa (terdeteksi redirect ke `stockbit.com/login`):
- Sistem **secara otomatis membuka jendela browser Chromium** (`headless: false`) langsung ke halaman login Stockbit.
- Pengguna cukup melakukan login manual di jendela tersebut.
- Sistem **otomatis mendeteksi token sesi**, menyalin seluruh cookies terbaru, dan **langsung memperbarui `cookies.json`**.
- Browser login manual ditutup, cookies baru langsung dipasang ke halaman scraper yang aktif, dan proses scraping dilanjutkan tanpa error.

### 2. Login Manual Kapan Saja via API / NPM Script:
- **Via REST API:** Kirim `POST /api/auth/save-session` atau buka browser ke `http://localhost:5000/api/auth/save-session`.
- **Via CLI / Terminal:**
  ```powershell
  npm run login
  ```
  Jendela browser akan terbuka, login ke akun Anda, dan `cookies.json` akan ter-update otomatis.

### 3. Alternatif: Export Cookies Manual via Chrome DevTools:
1. Buka browser Chrome biasa dan login ke [https://stockbit.com](https://stockbit.com).
2. Tekan `F12` lalu buka tab **Console**.
3. Jalankan kode berikut:
   ```javascript
   const cookies = document.cookie.split('; ').map(c => {
     const [name, ...rest] = c.split('=');
     return { name: name.trim(), value: rest.join('='), domain: '.stockbit.com', path: '/' };
   });
   copy(JSON.stringify(cookies, null, 2));
   console.log('✅ Cookies tersalin ke clipboard!', cookies.length, 'cookies');
   ```
4. Tempel (*paste*) isi clipboard ke file `backend/cookies.json`.

---

## 📡 Dokumentasi REST API

Base URL: `http://localhost:5000/api`

### 1. Streaming Real-Time Orderbook (Mode 2)

#### `POST /stream/orderbook/start`
Memulai streaming antrean Orderbook via CDP WebSocket.
- **Request Body (Opsional):**
  ```json
  {
    "symbols": ["BBCA", "BBRI", "TLKM"], // Kosongkan untuk pakai watchlist
    "intervalSeconds": 30,                // Sampling throttling (default: 30)
    "headless": true
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "status": "success",
    "data": {
      "status": "started",
      "message": "Streaming real-time Orderbook berhasil dimulai",
      "monitoredSymbols": ["BBCA", "BBRI", "TLKM"],
      "intervalSeconds": 30,
      "startTime": "2026-11-24T02:00:00.000Z"
    }
  }
  ```

#### `POST /stream/orderbook/stop`
Menghentikan layanan streaming Orderbook secara aman.
- **Response (200 OK):**
  ```json
  {
    "status": "success",
    "data": {
      "status": "stopped",
      "message": "Layanan streaming Orderbook telah dihentikan",
      "totalSessionsSaved": 48,
      "lastFlushTime": "2026-11-24T09:15:00.000Z"
    }
  }
  ```

#### `GET /stream/orderbook/status`
Memeriksa status aktif streaming.
- **Response (200 OK):**
  ```json
  {
    "status": "success",
    "data": {
      "isRunning": true,
      "monitoredSymbols": ["BBCA", "BBRI"],
      "intervalSeconds": 30,
      "startTime": "2026-11-24T02:00:00.000Z",
      "lastFlushTime": "2026-11-24T02:05:30.000Z",
      "totalSessionsSaved": 12,
      "activeTabs": 2,
      "marketSession": "SESSION_1"
    }
  }
  ```

---

### 2. Capture Broker Summary (Mode 1)

#### `POST /capture/broksum`
Scraping khusus data Broker Summary harian.
- **Request Body (Opsional):**
  ```json
  {
    "symbols": ["BBCA", "BBRI"],
    "limit": 10,
    "headless": true
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "status": "success",
    "message": "Proses capture Broker Summary selesai",
    "data": {
      "success": true,
      "captureType": "BROKSUM",
      "durationSeconds": 14.2,
      "totalProcessed": 2,
      "successCount": 2,
      "failedCount": 0,
      "successList": [
        {
          "symbol": "BBCA",
          "lastPrice": 5500,
          "tradeDate": "2026-11-24",
          "broksumCount": 48,
          "sessionId": 29
        }
      ]
    }
  }
  ```

#### `POST /capture/orderbook` (Snapshot / Fallback)
Scraping snapshot Orderbook terakhir untuk seluruh/sebagian emiten (digunakan saat runner streaming dipaksa berjalan di luar jam bursa atau on-demand).
- **Request Body (Opsional):**
  ```json
  {
    "symbols": ["BBCA", "BBRI"],
    "limit": 10,
    "headless": true
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "status": "success",
    "message": "Proses capture snapshot Orderbook selesai",
    "data": {
      "success": true,
      "captureType": "ORDERBOOK",
      "isFallback": true,
      "totalProcessed": 2,
      "successCount": 2,
      "failedCount": 0,
      "successList": [
        {
          "symbol": "BBCA",
          "lastPrice": 5500,
          "marketSession": "AFTER_HOURS",
          "orderbookCount": 10,
          "sessionId": 31
        }
      ]
    }
  }
  ```

---

### 3. Riwayat Sesi Database

#### `GET /sessions`
Daftar riwayat sesi.
- **Query Params:** `?limit=20&offset=0&stockCode=BBCA`

#### `GET /sessions/:id`
Detail snapshot Orderbook dan Broker Summary lengkap suatu sesi.

---

## ⏰ Jadwal Otomasi & Windows Task Scheduler

Kedua tugas scraping dipisahkan secara independen ke dalam jadwal Task Scheduler:

| Tugas | Skrip Runner | File Batch | Waktu Eksekusi |
|---|---|---|---|
| **Real-time Orderbook Stream** | `src/scripts/runOrderbookStream.js` | `run_orderbook_stream.bat` | **Setiap hari kerja pukul 09:55 WITA** (berhenti otomatis 17:16 WITA) |
| **Final Broker Summary** | `src/scripts/runDailyBroksum.js` | `run_broksum_task.bat` | **Setiap hari kerja pukul 17:25 WITA** (setelah rekap harian final bursa) |

### Pendaftaran Otomatis via PowerShell (Administrator):

```powershell
# 1. Daftarkan Task Real-Time Orderbook Stream (09:55 WITA)
$actionOb = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c "d:\UserData\user\Code\stockCaptureApp\backend\run_orderbook_stream.bat"'
$triggerOb = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "09:55"
$settingsOb = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "StockbitRealtimeOrderbookStream" -Action $actionOb -Trigger $triggerOb -Settings $settingsOb -Description "Stream Orderbook via CDP WebSocket jam bursa"

# 2. Daftarkan Task Broker Summary Harian (17:25 WITA)
$actionBs = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c "d:\UserData\user\Code\stockCaptureApp\backend\run_broksum_task.bat"'
$triggerBs = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "17:25"
$settingsBs = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "StockbitDailyBrokerSummary" -Action $actionBs -Trigger $triggerBs -Settings $settingsBs -Description "Capture Broker Summary harian setelah tutup bursa"
```

---

## 🛡 Strategi CDP WebSocket & Throttling 30 Detik

1. **Efisiensi Memori & Bandwidth:**
   Saat membuka tab emiten untuk streaming, resource berat seperti gambar (`image`), font (`font`), dan media otomatis diblokir via `setRequestInterception(true)`.
2. **Kombinasi CDP Frame + DOM Observer:**
   Stockbit memancarkan data harga dan tick transaksi via WebSocket. Parser mendengarkan event frame dan memperbarui state di memori. Jika terjadi perubahan tick atau perbedaan DOM pada antrean level 1–10, flag `isDirty` diaktifkan.
3. **Penyimpanan Berkala (Throttling 30 Detik):**
   Alih-alih melakukan penulisan database pada setiap tick milidetik yang menyebabkan lonjakan CPU/Disk, sistem melakukan *sampling snapshot* setiap 30 detik. Hanya emiten yang mengalami perubahan data yang disimpan ke database.

---

## 🔧 Troubleshooting & Solusi Error

- **Status `AFTER_HOURS` di luar jam bursa:**
  Perilaku normal jika pengujian dilakukan di luar jam 10:00–17:15 WITA atau pada hari Sabtu/Minggu.
- **Cookies Expired / Halaman Watchlist Timeout:**
  Buka Chrome, login ke Stockbit, dan perbarui isi `backend/cookies.json` dengan `copy(document.cookie)`.
- **Port Conflict (EADDRINUSE: 5000):**
  Ubah `PORT=5001` di file `.env` jika port 5000 sedang digunakan oleh aplikasi lain.
