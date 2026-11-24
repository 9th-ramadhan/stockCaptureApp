# 📈 Stockbit Data Capture Backend

Backend service berbasis **Node.js**, **Express.js (ES Modules)**, **Puppeteer**, dan **MySQL (`mysql2/promise`)** yang dirancang untuk melakukan scraping otomatis data **Orderbook** dan **Broker Summary** dari [Stockbit](https://stockbit.com), serta menyimpannya ke database MySQL secara transaksional dengan dukungan penjadwalan otomatis (*Windows Task Scheduler*).

---

## 📑 Daftar Isi

- [Fitur Utama](#-fitur-utama)
- [Arsitektur Sistem](#-arsitektur-sistem)
- [Struktur Folder](#-struktur-folder)
- [Prasyarat Sistem](#-prasyarat-sistem)
- [Instalasi & Setup Cepat](#-instalasi--setup-cepat)
- [Konfigurasi Environment (.env)](#-konfigurasi-environment-env)
- [Skema & Migrasi Database](#-skema--migrasi-database)
- [Manajemen Sesi & Cookies Stockbit](#-manajemen-sesi--cookies-stockbit)
- [Dokumentasi REST API](#-dokumentasi-rest-api)
- [Otomasi & Windows Task Scheduler](#-otomasi--windows-task-scheduler)
- [Strategi Web Scraping & DOM Resilience](#-strategi-web-scraping--dom-resilience)
- [Troubleshooting & Solusi Error](#-troubleshooting--solusi-error)

---

## 🌟 Fitur Utama

1. **Scraping Watchlist Otomatis:**
   - Membaca daftar kode saham secara dinamis langsung dari halaman watchlist pengguna (`https://stockbit.com/watchlist`).
   - Opsi custom list (scrape hanya daftar emiten tertentu yang dikirim via body request).
2. **Ekstraksi Data Orderbook Komprehensif:**
   - Mengambil harga terakhir (*last price*), perubahan poin, dan persentase perubahan (*change %*).
   - Mengambil antrean Bid & Offer (frekuensi, volume lot, dan level harga).
3. **Ekstraksi Data Broker Summary (Broksum):**
   - Mengambil data transaksi Buyer (`BY`) dan Seller (`SL`): kode broker, nilai transaksi (`val`), lot, dan harga rata-rata (*average price*).
   - Menghitung nilai bersih akumulasi/distribusi (`net_lot` dan `net_value`) secara otomatis pada database.
   - Normalisasi otomatis singkatan angka bursa Stockbit (`B` = Miliar, `M` = Juta, `K` = Ribu).
4. **Bulk Insert Transaksional MySQL:**
   - Menggunakan `BEGIN TRANSACTION`, `COMMIT`, dan `ROLLBACK`. Jika ada kegagalan, data di-rollback sehingga integritas database tetap terjaga.
5. **Hybrid Daily Runner (Scheduler-Friendly):**
   - Script runner `runDailyCapture.js` secara cerdas mendeteksi apakah server Express sedang aktif:
     - Jika server aktif: panggil endpoint REST API `POST /api/capture/watchlist`.
     - Jika server offline: jalankan workflow Puppeteer + koneksi MySQL mandiri tanpa harus menyalakan server Express.
6. **Bypass & Anti-Detection:**
   - Deteksi otomatis path Google Chrome lokal pengguna untuk mengurangi pemblokiran bot/Google OAuth.
   - Jeda acak (*jitter delay*) 1.5 - 3 detik antar emiten untuk mencegah deteksi bot dan rate limit.

---

## 🏗 Arsitektur Sistem

```
┌────────────────────────────────────────────────────────┐
│               Windows Task Scheduler                   │
│           (Harian jam 17:15 WITA / 16:15 WIB)          │
└──────────────────────────┬─────────────────────────────┘
                           │ (Mengeksekusi run_capture_task.bat)
                           ▼
             ┌───────────────────────────┐
             │  src/scripts/             │
             │  runDailyCapture.js       │
             └─────────────┬─────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼ (Cek Server Status)       ▼
     [Server Online]             [Server Offline]
   POST /api/capture/watchlist   Panggil fungsi langsung
             │                           │
             └─────────────┬─────────────┘
                           ▼
             ┌───────────────────────────┐
             │  services/                │
             │  puppeteerService.js      │
             └─────────────┬─────────────┘
                           │ 1. Inject cookies.json
                           │ 2. Scrape Watchlist / Symbol
                           │ 3. Parse Orderbook & Broksum
                           ▼
             ┌───────────────────────────┐
             │  models/                  │
             │  stockModel.js            │
             └─────────────┬─────────────┘
                           │ Bulk Insert Transaksional
                           ▼
             ┌───────────────────────────┐
             │  MySQL Database           │
             │  (stock_capture_db)       │
             └───────────────────────────┘
```

---

## 📁 Struktur Folder

```
backend/
├── database/
│   ├── migrate.js               # Script runner migrasi skema database
│   └── schema.sql               # Definisi DDL tabel (sessions, orderbook, broksum)
├── logs/
│   ├── daily_capture.log        # Log aktivitas runner harian
│   └── task_scheduler.log       # Log output eksekusi Windows Task Scheduler
├── src/
│   ├── config/
│   │   └── db.js                # Konfigurasi connection pool mysql2/promise
│   ├── controllers/
│   │   └── stockController.js   # Handler request & response API
│   ├── models/
│   │   └── stockModel.js        # Operasi transaksi database & bulk insert
│   ├── routes/
│   │   └── stockRoutes.js       # Definisi endpoint routing Express
│   ├── scripts/
│   │   ├── runDailyCapture.js   # Script runner otomatis harian
│   │   └── saveLoginSession.js  # Helper interaktif simpan cookies login
│   ├── services/
│   │   └── puppeteerService.js  # Core engine scraping Puppeteer & parser DOM
│   └── server.js                # Entry point server Express.js
├── .env.example                 # Template konfigurasi environment
├── .gitignore                   # Daftar file yang diabaikan Git
├── cookies.json                 # File sesi Stockbit aktif (JANGAN DI-COMMIT)
├── cookies.json.example         # Contoh struktur format cookies.json
├── package.json                 # Konfigurasi dependencies & npm scripts
├── README.md                    # Dokumentasi lengkap backend
└── run_capture_task.bat         # Batch file wrapper untuk Task Scheduler
```

---

## 💻 Prasyarat Sistem

- **Node.js**: Versi `18.x`, `20.x`, atau `22.x+` (Direkomendasikan LTS)
- **Database**: MySQL Server 8.0+ atau MariaDB 10.4+ (misal via XAMPP)
- **Browser**: Google Chrome atau browser berbasis Chromium yang terinstal di sistem
- **OS**: Windows 10/11 (mendukung `.bat` dan Windows Task Scheduler) / Linux / macOS

---

## 🚀 Instalasi & Setup Cepat

### 1. Masuk ke direktori backend
```powershell
cd d:\UserData\user\Code\stockCaptureApp\backend
```

### 2. Install dependensi
```powershell
npm install
```

### 3. Konfigurasi Environment File
Salin file `.env.example` menjadi `.env`:
```powershell
cp .env.example .env
```
Sesuaikan konfigurasi database Anda di dalam `.env`.

### 4. Eksekusi Migrasi Database
Pastikan layanan MySQL sudah berjalan, lalu jalankan:
```powershell
npm run db:migrate
```
Output yang diharapkan:
```
⏳ Menjalankan migrasi schema.sql ke MySQL...
✅ Migrasi berhasil! Database dan seluruh tabel siap digunakan.
```

### 5. Jalankan Server Backend
- **Mode Development (Auto-Reload):**
  ```powershell
  npm run dev
  ```
- **Mode Production:**
  ```powershell
  npm start
  ```
Server akan aktif di `http://localhost:5000`.

---

## ⚙️ Konfigurasi Environment (.env)

| Variabel | Tipe | Nilai Default | Keterangan |
|---|---|---|---|
| `PORT` | Number | `5000` | Port listen server Express |
| `DB_HOST` | String | `localhost` | Host database MySQL |
| `DB_PORT` | Number | `3306` | Port database MySQL |
| `DB_USER` | String | `root` | Username database MySQL |
| `DB_PASSWORD`| String | `""` | Password user database |
| `DB_NAME` | String | `stock_capture_db` | Nama database yang digunakan |
| `COOKIES_PATH`| String | `./cookies.json` | Path file JSON penyimpan cookies login |
| `CHROME_BIN` | String | *(Auto-detect)* | *(Opsional)* Path kustom binary `chrome.exe` |

---

## 🗄 Skema & Migrasi Database

Skema SQL berada pada file [`database/schema.sql`](file:///d:/UserData/user/Code/stockCaptureApp/backend/database/schema.sql).

### Tabel 1: `capture_sessions`
Mencatat informasi induk setiap kali snapshot pengambilan data saham berlangsung.
```sql
CREATE TABLE capture_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    stock_code VARCHAR(10) NOT NULL COMMENT 'Kode emiten, misal: BBCA, BBRI',
    capture_type ENUM('ORDERBOOK', 'BROKSUM', 'BOTH') NOT NULL,
    last_price INT UNSIGNED DEFAULT NULL,
    price_change_pct DECIMAL(6, 2) DEFAULT NULL,
    captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_time (stock_code, captured_at)
);
```

### Tabel 2: `orderbook_entries`
Mencatat detail antrean orderbook per level kedalaman harga.
```sql
CREATE TABLE orderbook_entries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    stock_code VARCHAR(10) NOT NULL,
    level_order TINYINT UNSIGNED NOT NULL COMMENT '1 = Best Bid / Best Offer',
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

### Tabel 3: `broker_summaries`
Mencatat rekapitulasi data broker transaksi harian.
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
    -- Kolom terhitung otomatis (Virtual / Stored Column):
    net_lot BIGINT GENERATED ALWAYS AS (CAST(buy_lot AS SIGNED) - CAST(sell_lot AS SIGNED)) STORED,
    net_value DECIMAL(18, 2) GENERATED ALWAYS AS (buy_value - sell_value) STORED,
    captured_at DATETIME NOT NULL,
    FOREIGN KEY (session_id) REFERENCES capture_sessions(id) ON DELETE CASCADE,
    INDEX idx_bs_stock_date (stock_code, trade_date),
    INDEX idx_bs_broker (broker_code, trade_date)
);
```

---

## 🍪 Manajemen Sesi & Cookies Stockbit

Stockbit mewajibkan autentikasi akun untuk melihat data **Watchlist** privat dan **Broker Summary**. Sesi disimpan dalam file `backend/cookies.json`.

### Cara Export Cookies dari Google Chrome (Sangat Disarankan)
Karena Google memblokir login OAuth di lingkungan automated browser ("*This browser or app may not be secure*"), cara paling stabil adalah mengekspor cookies dari browser Chrome yang biasa Anda gunakan:

1. Buka browser Chrome biasa dan login ke [https://stockbit.com](https://stockbit.com).
2. Tekan `F12` untuk membuka **Chrome DevTools**.
3. Masuk ke tab **Console**, lalu tempel (*paste*) kode berikut dan tekan `Enter`:
   ```javascript
   const cookies = document.cookie.split('; ').map(c => {
     const [name, ...rest] = c.split('=');
     return { name: name.trim(), value: rest.join('='), domain: '.stockbit.com', path: '/' };
   });
   copy(JSON.stringify(cookies, null, 2));
   console.log('✅ Cookies berhasil disalin ke clipboard! Total:', cookies.length);
   ```
4. Buka file `backend/cookies.json` di editor Anda, lalu paste isi clipboard.
5. Selesai. Puppeteer akan otomatis memuat file ini.

> [!TIP]
> Cookie krusial yang menentukan status login adalah `credentialStorage` (berisi JSON web token) dan `sb_is_social_logged_in`. Sesi ini bertahan sekitar 7-30 hari tergantung masa aktif token Stockbit.

---

## 📡 Dokumentasi REST API

Base URL: `http://localhost:5000/api`

### 1. Health Check
Memeriksa status service Express backend.
- **Method:** `GET`
- **URL:** `/health`
- **Response (200 OK):**
  ```json
  {
    "status": "OK",
    "message": "Backend Stock Capture (Puppeteer + MySQL) siap digunakan",
    "timestamp": "2026-11-24T12:00:00.000Z"
  }
  ```

### 2. Database Connection Check
Memeriksa koneksi langsung ke server database MySQL.
- **Method:** `GET`
- **URL:** `/db-check`
- **Response (200 OK):**
  ```json
  {
    "status": "connected",
    "data": {
      "waktu_server": "2026-11-24T12:00:00.000Z",
      "nama_db": "stock_capture_db"
    }
  }
  ```

---

### 3. Capture Watchlist
Mengeksekusi workflow scraping seluruh atau sebagian emiten pada watchlist.
- **Method:** `POST`
- **URL:** `/capture/watchlist`
- **Headers:** `Content-Type: application/json`
- **Request Body (Opsional):**
  ```json
  {
    "symbols": ["BBCA", "BBRI", "TLKM"],  // Kosongkan untuk scrape seluruh watchlist
    "limit": 10,                            // Batasi jumlah emiten yang diproses
    "headless": true                        // Default: true
  }
  ```
- **Response Sukses (200 OK):**
  ```json
  {
    "status": "success",
    "message": "Proses capture watchlist selesai",
    "data": {
      "totalProcessed": 3,
      "successCount": 3,
      "failedCount": 0,
      "results": [
        {
          "stockCode": "BBCA",
          "status": "success",
          "sessionId": 14,
          "orderbookRows": 1,
          "broksumRows": 47
        }
      ]
    }
  }
  ```
- **Response Jika Belum Login (401 Unauthorized):**
  ```json
  {
    "status": "error",
    "requiresLogin": true,
    "message": "Sesi akun Stockbit (cookies.json) diperlukan untuk mengakses halaman Watchlist."
  }
  ```

---

### 4. Capture Emiten Tunggal
Melakukan scraping data untuk 1 kode saham spesifik.
- **Method:** `POST`
- **URL:** `/capture/symbol/:symbol`
- **Request Body (Opsional):**
  ```json
  {
    "headless": true
  }
  ```
- **Contoh Request:** `POST /api/capture/symbol/BBCA`
- **Response Sukses (200 OK):**
  ```json
  {
    "status": "success",
    "message": "Berhasil menangkap dan menyimpan data emiten BBCA",
    "data": {
      "sessionId": 17,
      "stockCode": "BBCA",
      "captureType": "BOTH",
      "insertedOrderbookCount": 1,
      "insertedBroksumCount": 48
    }
  }
  ```

---

### 5. Riwayat Capture Sessions
Mengambil daftar riwayat sesi penangkapan data dari database.
- **Method:** `GET`
- **URL:** `/sessions`
- **Query Parameters:**
  - `limit`: Jumlah data (default: 20)
  - `offset`: Offset paginasi (default: 0)
  - `stockCode`: Filter berdasarkan kode saham (contoh: `?stockCode=BBCA`)
- **Response Sukses (200 OK):**
  ```json
  {
    "status": "success",
    "count": 1,
    "data": [
      {
        "id": 16,
        "stock_code": "BBRI",
        "capture_type": "BOTH",
        "last_price": 3100,
        "price_change_pct": "0.00",
        "captured_at": "2026-11-17T14:20:00.000Z",
        "total_orderbook_rows": 1,
        "total_broksum_rows": 50
      }
    ]
  }
  ```

---

### 6. Detail Capture Session
Mengambil snapshot lengkap satu sesi termasuk seluruh array Orderbook dan Broker Summary.
- **Method:** `GET`
- **URL:** `/sessions/:id`
- **Contoh Request:** `GET /api/sessions/16`
- **Response Sukses (200 OK):**
  ```json
  {
    "status": "success",
    "data": {
      "session": {
        "id": 16,
        "stock_code": "BBRI",
        "capture_type": "BOTH",
        "last_price": 3100,
        "price_change_pct": "0.00",
        "captured_at": "2026-11-17T14:20:00.000Z"
      },
      "orderbook": [
        {
          "level_order": 1,
          "bid_freq": 120,
          "bid_lot": 45000,
          "bid_price": 3090,
          "offer_price": 3100,
          "offer_lot": 62000,
          "offer_freq": 145
        }
      ],
      "broker_summary": [
        {
          "broker_code": "YP",
          "broker_category": "UNKNOWN",
          "buy_lot": 25000,
          "buy_value": 77500000.00,
          "avg_buy_price": 3100.00,
          "sell_lot": 10000,
          "sell_value": 31000000.00,
          "avg_sell_price": 3100.00,
          "net_lot": 15000,
          "net_value": 46500000.00
        }
      ]
    }
  }
  ```

---

### 7. Trigger Interactive Login Session
Membuka browser berbasis UI untuk login manual ke Stockbit.
- **Method:** `POST`
- **URL:** `/auth/save-session`

---

## ⏰ Otomasi & Windows Task Scheduler

Service ini dilengkapi automasi batch script untuk mengeksekusi scraping secara terjadwal setiap sore setelah penutupan bursa IHSG (contoh: **17:15 WITA / 16:15 WIB**).

### Komponen Otomasi:
1. **`run_capture_task.bat`**: Mengatur environment `PATH` Node.js, berpindah ke direktori proyek, dan mengarahkan output log ke `logs/task_scheduler.log`.
2. **`src/scripts/runDailyCapture.js`**:
   - Menghubungi `/api/health` untuk mendeteksi apakah server backend aktif.
   - Jika aktif, memicu endpoint `/api/capture/watchlist`.
   - Jika tidak aktif, menjalankan *in-process headless Puppeteer engine* secara mandiri dan menutup pool database setelah selesai.

### Cara Mendaftarkan Task di Windows Task Scheduler

Buka **PowerShell as Administrator**, lalu jalankan perintah berikut:

```powershell
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c "d:\UserData\user\Code\stockCaptureApp\backend\run_capture_task.bat"'
$trigger = New-ScheduledTaskTrigger -Daily -At "17:15"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "StockbitDailyCaptureWatchlist" -Action $action -Trigger $trigger -Settings $settings -Description "Auto capture watchlist Stockbit harian setelah tutup bursa"
```

### Cara Verifikasi Status Task Scheduler:
```powershell
# Cek info jadwal task
Get-ScheduledTask -TaskName "StockbitDailyCaptureWatchlist" | Get-ScheduledTaskInfo

# Jalankan manual untuk tes
Start-ScheduledTask -TaskName "StockbitDailyCaptureWatchlist"

# Periksa log hasil eksekusi
Get-Content d:\UserData\user\Code\stockCaptureApp\backend\logs\task_scheduler.log -Tail 30
```

---

## 🛡 Strategi Web Scraping & DOM Resilience

Stockbit dibangun menggunakan React dan *styled-components* dengan hash CSS class dinamis (misal: `sc-f2987433-0`). Layanan ini menggunakan strategi selektor tahan perubahan:

1. **Navigasi `domcontentloaded` (Bukan `networkidle2`):**
   Stockbit memiliki persistent WebSocket connection untuk data streaming realtime. Menggunakan `networkidle2` akan memicu `TimeoutError`. Solusinya adalah menunggu event `domcontentloaded` lalu melakukan `waitForSelector` pada elemen kontainer spesifik.
2. **Anchor Teks & Struktur Kolom:**
   - Orderbook diidentifikasi melalui struktur kartu yang memiliki header kolom `Freq`, `Lot`, `Bid`, `Offer`.
   - Broker Summary diidentifikasi melalui header teks `Broker Summary` dan header kolom `BY`, `B.val`, `SL`, `S.val`.
3. **Pembersihan dan Konversi Angka Bursa:**
   - String `12.5B` dikonversi menjadi `12500000000` (dikalikan $10^9$).
   - String `350M` dikonversi menjadi `350000000` (dikalikan $10^6$).
   - String `45.2K` dikonversi menjadi `45200` (dikalikan $10^3$).
   - String `-` atau `n/a` dikonversi menjadi `0`.
4. **Resilient Watchlist Parser:**
   Mengambil kode saham dari atribut link `a[href*="/symbol/"]` pada tabel watchlist, menghindari kegagalan parsing jika styling atau struktur sel tabel mengalami perubahan kecil.

---

## 🔧 Troubleshooting & Solusi Error

### 1. `TimeoutError: Waiting for selector 'tbody.ant-table-tbody' failed`
- **Penyebab:** Sesi login kedaluwarsa atau file `cookies.json` belum diisi, sehingga Stockbit melakukan redirect ke halaman `/login`.
- **Solusi:** Perbarui `cookies.json` dengan cara export cookies dari Chrome DevTools sesuai panduan [Manajemen Sesi & Cookies Stockbit](#-manajemen-sesi--cookies-stockbit).

### 2. Google OAuth: *"Couldn't sign you in - This browser or app may not be secure"*
- **Penyebab:** Google memproteksi form login jika dijalankan melalui Chromium test binary bawaan Puppeteer.
- **Solusi:** Jangan lakukan login Google via script otomatis. Loginlah di Google Chrome biasa Anda, lalu salin `document.cookie` ke `cookies.json`.

### 3. `ECONNREFUSED 127.0.0.1:3306`
- **Penyebab:** MySQL Server belum menyala atau port berbeda.
- **Solusi:** Pastikan MySQL di XAMPP / Windows Service sudah dalam status **Running**, dan cek nilai `DB_PORT` serta `DB_PASSWORD` di `.env`.

### 4. Task Scheduler `LastTaskResult: 267009` atau `node: command not found`
- **Penyebab:** Environment Windows Task Scheduler tidak mewarisi `PATH` dari user profil yang memuat direktori instalasi Node.js.
- **Solusi:** `run_capture_task.bat` sudah dilengkapi `set PATH=D:\DevTools\nodejs;%PATH%`. Pastikan path Node.js pada file batch tersebut sesuai dengan path instalasi Node.js di komputer Anda.

---

## 📄 Lisensi

ISC License. Proyek ini dikembangkan untuk kebutuhan internal analisis data transaksi bursa efek.
