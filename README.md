# 📊 Stock Capture App

Aplikasi otomatisasi untuk mengambil (*scrape*), mencatat, dan menganalisis data pasar modal Indonesia dari **Stockbit** dengan arsitektur terpisah:
1. **Streaming Real-Time Orderbook (Mode 2):** Menangkap antrean 10 level Bid/Offer via **Chrome DevTools Protocol (CDP) WebSocket** dengan *sampling interval* & throttling 30 detik selama jam bursa BEI (`09:55–17:16 WITA`).
2. **Capture Broker Summary Harian (Mode 1):** Ekstraksi batch rekapitulasi data broker transaksi harian (Buyer & Seller) secara otomatis setiap sore (`17:25 WITA`) ke database MySQL secara transaksional.

---

## 📂 Struktur Repositori

- **[`backend/`](file:///d:/UserData/user/Code/stockCaptureApp/backend/README.md):**
  Layanan backend berbasis **Node.js**, **Express.js (ES Modules)**, **Puppeteer (CDP WebSocket)**, dan **MySQL (`mysql2/promise`)**.
  - Dual Engine: Real-time Orderbook streaming & Batch Broker Summary.
  - REST API untuk kontrol streaming (`/api/stream/orderbook/start`, `/stop`, `/status`) dan ekstraksi Broksum (`/api/capture/broksum`).
  - Integrasi Windows Task Scheduler (09:55 WITA untuk Orderbook, 17:25 WITA untuk Broker Summary).
  - Skema database dengan penanda sesi bursa BEI (`SESSION_1`, `SESSION_2`, `POST_CLOSING`, `AFTER_HOURS`) dan kalkulasi akumulasi/distribusi otomatis.
  - *Silakan baca [backend/README.md](file:///d:/UserData/user/Code/stockCaptureApp/backend/README.md) untuk dokumentasi lengkap konfigurasi, API, skema database, dan task scheduler.*

- **`frontend/`:**
  Aplikasi web antarmuka pengguna untuk menampilkan visualisasi data pergerakan emiten, antrean orderbook, dan analisis akumulasi/distribusi broker.

---

## ⚡ Perintah Cepat (Backend)

```powershell
cd backend

# Pasang dependensi
npm install

# Setup env dan migrasi database
cp .env.example .env
npm run db:migrate

# Jalankan server Express
npm run dev

# Jalankan stream Orderbook manual
npm run stream:orderbook

# Jalankan capture Broker Summary manual
npm run capture:broksum
```

---

## 📖 Dokumentasi Lengkap
👉 **Buka [Dokumentasi Lengkap Backend (backend/README.md)](file:///d:/UserData/user/Code/stockCaptureApp/backend/README.md)**
