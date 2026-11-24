# 📊 Stock Capture App

Aplikasi otomatisasi untuk mengambil (*scrape*), mencatat, dan menganalisis data pasar modal Indonesia dari **Stockbit** (Orderbook dan Broker Summary), dilengkapi dengan backend Node.js transaksional MySQL dan antarmuka web.

---

## 📂 Struktur Repositori

Proyek ini terdiri dari dua modul utama:

- **[`backend/`](file:///d:/UserData/user/Code/stockCaptureApp/backend/README.md):**
  Layanan backend berbasis **Node.js**, **Express.js**, **Puppeteer**, dan **MySQL (`mysql2/promise`)**.
  - Engine scraping Orderbook & Broker Summary.
  - REST API untuk memicu scraping dan membaca riwayat snapshot.
  - Integrasi Windows Task Scheduler untuk capture otomatis harian.
  - *Silakan baca [backend/README.md](file:///d:/UserData/user/Code/stockCaptureApp/backend/README.md) untuk dokumentasi lengkap konfigurasi, API, dan skema database.*

- **`frontend/`:**
  Aplikasi web antarmuka pengguna untuk menampilkan visualisasi data pergerakan emiten, antrean orderbook, dan analisis akumulasi/distribusi broker.

---

## ⚡ Memulai Cepat (Backend)

```powershell
# 1. Pindah ke direktori backend
cd backend

# 2. Pasang dependensi
npm install

# 3. Buat file .env dan jalankan migrasi database
cp .env.example .env
npm run db:migrate

# 4. Salin cookies login Stockbit ke backend/cookies.json

# 5. Jalankan server pengembangan
npm run dev
```

Server backend akan aktif di `http://localhost:5000`.

---

## 📖 Dokumentasi Lengkap
Untuk panduan detail mengenai:
- Skema database (`capture_sessions`, `orderbook_entries`, `broker_summaries`)
- Format request dan response REST API
- Setup Windows Task Scheduler harian jam 17:15 WITA
- Cara export cookies Stockbit dari Google Chrome DevTools

👉 **Buka [Dokumentasi Lengkap Backend (backend/README.md)](file:///d:/UserData/user/Code/stockCaptureApp/backend/README.md)**
