import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Deteksi path Google Chrome reguler di sistem pengguna (Windows/Linux/Mac)
 * Menggunakan Chrome asli dapat menghindari blokir keamanan Google OAuth ("This browser or app may not be secure")
 */
function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fsSync.existsSync(p)) return p;
    } catch {
      // Abaikan jika tidak ada akses
    }
  }
  return undefined;
}

// Lokasi default file cookies.json
const DEFAULT_COOKIES_PATHS = [
  process.env.COOKIES_PATH,
  path.resolve(__dirname, '../../cookies.json'), // backend/cookies.json
  path.resolve(process.cwd(), 'cookies.json'),   // root/cookies.json
  path.resolve(process.cwd(), 'backend/cookies.json'),
].filter(Boolean);

/**
 * Jeda acak (jitter) dalam milidetik untuk mencegah rate-limit
 * @param {number} min - Batas bawah milidetik (default: 1500ms)
 * @param {number} max - Batas atas milidetik (default: 3000ms)
 */
export function randomDelay(min = 1500, max = 3000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalisasi angka singkatan Stockbit (B = Miliar, M = Juta, K = Ribu, '-' = 0)
 * Contoh:
 *   '12.5B'  -> 12500000000
 *   '350M'   -> 350000000
 *   '45.2K'  -> 45200
 *   '-'      -> 0
 *   '1,450'  -> 1450
 *
 * @param {string|number} rawValue
 * @returns {number}
 */
export function parseAbbreviatedNumber(rawValue) {
  if (rawValue === null || rawValue === undefined) return 0;
  if (typeof rawValue === 'number') return isNaN(rawValue) ? 0 : rawValue;

  const str = String(rawValue).trim();
  if (!str || str === '-' || str.toLowerCase() === 'n/a') return 0;

  const isNegative = str.startsWith('-') || (str.startsWith('(') && str.endsWith(')'));
  let cleaned = str.replace(/[()\-+]/g, '').trim();

  let multiplier = 1;
  const upper = cleaned.toUpperCase();

  if (upper.endsWith('B')) {
    multiplier = 1_000_000_000;
    cleaned = cleaned.slice(0, -1).trim();
  } else if (upper.endsWith('M')) {
    multiplier = 1_000_000;
    cleaned = cleaned.slice(0, -1).trim();
  } else if (upper.endsWith('K')) {
    multiplier = 1_000;
    cleaned = cleaned.slice(0, -1).trim();
  }

  if (multiplier !== 1) {
    // Angka singkatan (misal: "12,5B" atau "12.5B") -> desimal titik
    cleaned = cleaned.replace(',', '.');
  } else {
    // Format angka biasa: tangani pemisah ribuan titik/koma
    if (cleaned.includes('.') && cleaned.includes(',')) {
      if (cleaned.lastIndexOf('.') < cleaned.lastIndexOf(',')) {
        // Format Indonesia/Eropa: 1.250,50
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        // Format US: 1,250.50
        cleaned = cleaned.replace(/,/g, '');
      }
    } else if (cleaned.includes('.')) {
      const parts = cleaned.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
        // Titik sebagai pemisah ribuan (misal: 1.250 atau 1.000.000)
        cleaned = cleaned.replace(/\./g, '');
      }
    } else if (cleaned.includes(',')) {
      const parts = cleaned.split(',');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
        cleaned = cleaned.replace(/,/g, '');
      } else {
        cleaned = cleaned.replace(',', '.');
      }
    }
  }

  // Hapus karakter non-numerik yang tersisa kecuali titik desimal
  cleaned = cleaned.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return 0;

  const result = parsed * multiplier;
  return isNegative ? -result : result;
}

/**
 * Mengonversi tanggal teks Broker Summary Stockbit (misal: "16 Nov 26" atau "16 Nov 2026")
 * ke format SQL YYYY-MM-DD.
 *
 * @param {string} rawDateStr
 * @returns {string} Tanggal format YYYY-MM-DD
 */
export function parseTradeDate(rawDateStr) {
  if (!rawDateStr || typeof rawDateStr !== 'string') {
    return new Date().toISOString().slice(0, 10);
  }

  const str = rawDateStr.trim();

  // Jika sudah format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', mei: '05', may: '05',
    jun: '06', jul: '07', agu: '08', ags: '08', aug: '08', sep: '09',
    okt: '10', oct: '10', nov: '11', des: '12', dec: '12',
  };

  // Cocokkan pola: "16 Nov 26" atau "16 Nov 2026" atau rentang "16 Nov 26 - 16 Nov 26"
  // Ambil tanggal pertama atau satu-satunya yang cocok
  const match = str.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const monthKey = match[2].toLowerCase().slice(0, 3);
    const month = monthMap[monthKey] || '01';
    let year = match[3];
    if (year.length === 2) {
      year = `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }

  // Pola DD/MM/YYYY
  const slashMatch = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0');
    const month = slashMatch[2].padStart(2, '0');
    let year = slashMatch[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  // Fallback: gunakan tanggal hari ini
  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalisasi berbagai format cookies (Array, Object key-value, atau raw cookie string)
 * menjadi format array cookie yang valid untuk Puppeteer.
 */
function normalizeCookies(data) {
  if (!data) return [];

  // Jika sudah berupa Array objek Puppeteer [{ name, value, ... }]
  if (Array.isArray(data)) {
    return data
      .filter((c) => c && c.name && c.value !== undefined)
      .map((c) => ({
        name: String(c.name).trim(),
        value: String(c.value),
        domain: c.domain || '.stockbit.com',
        path: c.path || '/',
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
      }));
  }

  // Jika berupa Object key-value: { "credentialStorage": "...", "sb_is_social_logged_in": "y" }
  if (typeof data === 'object' && data !== null) {
    return Object.entries(data).map(([name, value]) => ({
      name: String(name).trim(),
      value: typeof value === 'string' ? value : JSON.stringify(value),
      domain: '.stockbit.com',
      path: '/',
    }));
  }

  // Jika berupa string mentah: "credentialStorage=...; sb_is_social_logged_in=y"
  if (typeof data === 'string') {
    return data
      .split(';')
      .map((pair) => {
        const idx = pair.indexOf('=');
        if (idx === -1) return null;
        return {
          name: pair.slice(0, idx).trim(),
          value: pair.slice(idx + 1).trim(),
          domain: '.stockbit.com',
          path: '/',
        };
      })
      .filter(Boolean);
  }

  return [];
}

/**
 * Membaca session cookies dari file JSON atau teks
 * @returns {Promise<Array<Object>|null>}
 */
export async function loadCookies() {
  for (const cookiePath of DEFAULT_COOKIES_PATHS) {
    try {
      const content = (await fs.readFile(cookiePath, 'utf-8')).trim();
      if (!content) continue;

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        // Jika bukan format JSON, coba parse sebagai cookie string biasa
        parsed = content;
      }

      const normalized = normalizeCookies(parsed);
      if (normalized.length > 0) {
        console.log(`🍪 Berhasil membaca cookies dari ${cookiePath} (${normalized.length} item)`);
        return normalized;
      }
    } catch {
      // Lanjut ke path berikutnya jika file tidak ada
    }
  }

  // Cek apakah ada cookie string dalam .env (STOCKBIT_COOKIES)
  if (process.env.STOCKBIT_COOKIES) {
    try {
      const envRaw = process.env.STOCKBIT_COOKIES.trim();
      let parsed;
      try {
        parsed = JSON.parse(envRaw);
      } catch {
        parsed = envRaw;
      }
      const normalized = normalizeCookies(parsed);
      if (normalized.length > 0) {
        console.log(`🍪 Berhasil membaca cookies dari variabel .env (${normalized.length} item)`);
        return normalized;
      }
    } catch {
      // Abaikan jika error
    }
  }

  return null;
}

/**
 * Menerapkan cookies sesi login ke Puppeteer page
 * @param {import('puppeteer').Page} page
 */
export async function applyCookies(page) {
  const cookies = await loadCookies();
  if (cookies && cookies.length > 0) {
    await page.setCookie(...cookies);
    console.log(`✅ ${cookies.length} session cookies berhasil dipasang ke halaman.`);
    return true;
  } else {
    console.warn('⚠️ Tidak ada cookies.json yang ditemukan. Puppeteer akan berjalan tanpa login.');
    return false;
  }
}

/**
 * Fungsi opsional untuk menyimpan sesi login Stockbit (mode headless: false)
 * Pengguna login manual di browser yang muncul hingga dialihkan ke /watchlist,
 * lalu cookies otomatis disimpan ke cookies.json.
 *
 * @param {string} [outputPath] - Jalur file output penyimpanan cookies
 * @param {number} [timeoutMs=180000] - Batas waktu menunggu login (default 3 menit)
 * @returns {Promise<Object>}
 */
export async function saveLoginSession(outputPath = null, timeoutMs = 180000) {
  const targetPath = outputPath || path.resolve(__dirname, '../../cookies.json');
  console.log(`🚀 Meluncurkan browser untuk login manual ke Stockbit...`);

  const realChromePath = findChromeExecutable();
  if (realChromePath) {
    console.log(`🌐 Menggunakan binary Chrome asli sistem: ${realChromePath}`);
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: realChromePath || undefined,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  try {
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    // Sembunyikan tanda-tanda navigator.webdriver
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    console.log(`🔗 Membuka halaman login: https://stockbit.com/login`);
    await page.goto('https://stockbit.com/login', { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('⏳ Silakan login ke akun Stockbit Anda di jendela browser...');
    console.log('   Sistem mendeteksi login otomatis saat halaman berpindah ke /watchlist.');

    // Tunggu hingga URL mengarah ke /watchlist atau elemen watchlist terdeteksi
    const startTime = Date.now();
    let loggedIn = false;

    while (Date.now() - startTime < timeoutMs) {
      const currentUrl = page.url();
      if (currentUrl.includes('/watchlist') || (!currentUrl.includes('/login') && !currentUrl.includes('/register'))) {
        // Pastikan halaman selesai merender
        try {
          await page.waitForSelector('tbody.ant-table-tbody, [class*="watchlist"]', { timeout: 8000 });
          loggedIn = true;
          break;
        } catch {
          // Jika url sudah watchlist tapi selector belum selesai muat, tunggu sejenak
          if (currentUrl.includes('/watchlist')) {
            loggedIn = true;
            break;
          }
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (!loggedIn) {
      throw new Error('Waktu tunggu login habis atau pengguna belum menyelesaikan login.');
    }

    console.log('🎉 Login berhasil terdeteksi! Mengambil cookies sesi...');
    const cookies = await page.cookies();

    // Simpan ke file cookies.json
    await fs.writeFile(targetPath, JSON.stringify(cookies, null, 2), 'utf-8');
    console.log(`💾 ${cookies.length} cookie berhasil disimpan ke: ${targetPath}`);

    return {
      success: true,
      message: 'Sesi login berhasil disimpan',
      cookiesCount: cookies.length,
      savedPath: targetPath,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Ekstraksi daftar kode emiten dari tabel Watchlist Stockbit (https://stockbit.com/watchlist)
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Array<string>>} Daftar kode saham (misal: ['BBCA', 'BBRI', 'AXIO'])
 */
export async function getWatchlistSymbols(page) {
  console.log('📋 Mengambil daftar emiten dari https://stockbit.com/watchlist...');

  await page.goto('https://stockbit.com/watchlist', {
    waitUntil: 'networkidle2',
    timeout: 45000,
  });

  // Periksa apakah halaman dialihkan ke halaman login (artinya cookies belum terpasang atau expired)
  const currentUrl = page.url();
  if (currentUrl.includes('/login') || (!currentUrl.includes('/watchlist') && !currentUrl.includes('stockbit.com'))) {
    throw new Error(
      'Halaman Watchlist memerlukan sesi akun yang sudah login (terdeteksi redirect ke: ' +
        currentUrl +
        '). ' +
        'Silakan login terlebih dahulu menggunakan perintah "npm run login" di terminal backend agar cookies.json tersimpan, ' +
        'atau kirim parameter "symbols" pada body request (contoh: { "symbols": ["BBCA", "BBRI"] }) jika ingin menentukan emiten secara manual.'
    );
  }

  // Tunggu container tabel ant-table selesai dimuat dengan proteksi timeout yang jelas
  try {
    await page.waitForSelector('tbody.ant-table-tbody', { timeout: 20000 });
  } catch (timeoutErr) {
    const checkUrl = page.url();
    if (checkUrl.includes('/login')) {
      throw new Error(
        'Sesi login Stockbit tidak valid atau belum dimuat. Halaman terlempar ke /login. ' +
          'Silakan jalankan "npm run login" untuk memperbarui sesi.'
      );
    }
    throw new Error(
      'Gagal memuat tabel watchlist Stockbit (tbody.ant-table-tbody tidak muncul dalam 20 detik). ' +
        'Pastikan akun Stockbit memiliki daftar saham pada watchlist default.'
    );
  }

  // Ekstraksi kode emiten di dalam DOM
  const symbols = await page.evaluate(() => {
    // Baris ant-table-row pada tabel watchlist Stockbit
    const rows = Array.from(document.querySelectorAll('tbody.ant-table-tbody > tr.ant-table-row'));
    const result = [];

    for (const row of rows) {
      // Abaikan measure-row yang dibuat oleh Ant Design untuk pengukuran lebar kolom
      if (row.classList.contains('ant-table-measure-row')) continue;

      // Sel pertama selalu fixed-left yang memuat kode emiten
      const firstCell = row.querySelector('td.ant-table-cell-fix-left');
      if (!firstCell) continue;

      // Wrapper styled-components (div[class*="sc-c5bdc04d"]) atau elemen turunan sel pertama
      const codeWrapper = firstCell.querySelector('div[class*="sc-c5bdc04d"]') || firstCell;
      const text = (codeWrapper.innerText || codeWrapper.textContent || '').trim();

      if (text) {
        // Ambil token kode saham pertama (4-6 karakter alfanumerik kapital, e.g. "BBCA", "AXIO")
        const match = text.match(/^[A-Z0-9]{4,6}/);
        if (match) {
          result.push(match[0]);
        } else {
          const firstWord = text.split(/\s+/)[0]?.toUpperCase();
          if (firstWord && /^[A-Z0-9]{4,6}$/.test(firstWord)) {
            result.push(firstWord);
          }
        }
      }
    }

    // Kembalikan daftar unik
    return Array.from(new Set(result));
  });

  console.log(`✅ Ditemukan ${symbols.length} emiten pada watchlist: ${symbols.join(', ')}`);
  return symbols;
}

/**
 * Ekstraksi Orderbook dan Broker Summary untuk satu emiten pada halaman https://stockbit.com/symbol/${symbol}
 *
 * @param {import('puppeteer').Page} page
 * @param {string} symbol - Kode saham (misal: 'BBCA')
 * @returns {Promise<Object>} Data terstruktur snapshot Orderbook & Broker Summary
 */
export async function scrapeStockDetail(page, symbol) {
  const stockCode = symbol.toUpperCase().trim();
  const url = `https://stockbit.com/symbol/${stockCode}`;
  console.log(`🔍 Mengunjungi halaman emiten: ${url}`);

  await page.goto(url, {
    waitUntil: 'networkidle2',
    timeout: 45000,
  });

  // Tunggu container utama halaman selesai dimuat
  try {
    await page.waitForSelector('main#main-container, [id="main-container"]', { timeout: 15000 });
  } catch {
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      throw new Error(
        `Gagal membuka emiten ${stockCode}: halaman dialihkan ke ${currentUrl}. Pastikan Anda telah login menggunakan "npm run login".`
      );
    }
    // Cek apakah halaman berada dalam mode tamu (tanpa session login)
    const isGuestView = await page.evaluate(() => {
      return !document.querySelector('main#main-container') && !!document.querySelector('a[href*="/login"]');
    });

    if (isGuestView) {
      throw new Error(
        `Halaman emiten ${stockCode} terbuka dalam mode tamu (belum login). ` +
        `Fitur antrean Orderbook dan data Broker Summary hanya tersedia untuk akun yang sudah login. ` +
        `Silakan simpan sesi login terlebih dahulu dengan perintah "npm run login".`
      );
    }
  }

  // Scroll secukupnya ke bawah untuk memicu lazy-render komponen di panel kanan (Broker Summary)
  await page.evaluate(() => {
    window.scrollBy(0, 700);
    const mainContainer = document.querySelector('main#main-container');
    if (mainContainer) {
      mainContainer.scrollTop = 700;
    }
  });

  // Beri jeda singkat agar reaktif state/fetch data Stockbit selesai
  await new Promise((r) => setTimeout(r, 1200));

  // Ekstraksi data Orderbook dan Broker Summary di dalam konteks DOM
  const extractedData = await page.evaluate(() => {
    /* =====================================================================
     * 1. IDENTIFIKASI CONTAINER UTAMA
     * ===================================================================== */
    const main = document.querySelector('main#main-container') || document.body;

    /* =====================================================================
     * 2. EKSTRAKSI ORDERBOOK
     * Strategi jangkar stabil:
     * - Cari elemen di dalam main yang memuat teks header kolom:
     *   "Freq", "Lot", "Bid", "Offer"
     * - Ambil harga terakhir dan persentase di header card Orderbook
     * - Ekstrak setiap baris antrean di bawah header Freq | Lot | Bid | Offer | Lot | Freq
     * ===================================================================== */
    let lastPriceRaw = '0';
    let priceChangePctRaw = '0';
    const rawOrderbookRows = [];

    // Cari seluruh kandidat elemen tabel atau container di dalam main
    const allContainers = Array.from(main.querySelectorAll('div, section, table'));

    // Temukan container Orderbook berdasarkan keberadaan teks header kolom
    const orderbookHeaderContainer = allContainers.find((el) => {
      const text = el.innerText || '';
      return (
        text.includes('Freq') &&
        text.includes('Lot') &&
        text.includes('Bid') &&
        text.includes('Offer') &&
        // Pastikan ini elemen container yang cukup spesifik (panjang teks tidak terlalu raksasa)
        text.length < 5000
      );
    });

    if (orderbookHeaderContainer) {
      // A. Ambil Header Harga Terakhir dan Perubahan (%)
      // Header harga berada di card induk Orderbook
      let parentCard = orderbookHeaderContainer;
      for (let i = 0; i < 4 && parentCard.parentElement; i++) {
        parentCard = parentCard.parentElement;
        const cardText = parentCard.innerText || '';
        // Cek apakah ada pola harga dan persentase perubahan: misal "140 +1 (+0.72%)" atau "9,850 -50 (-0.51%)"
        const priceRegex = /([0-9.,]+)\s+([+-]?[0-9.,]+)\s+\(([+-]?[0-9.,]+%)\)/;
        const match = cardText.match(priceRegex);
        if (match) {
          lastPriceRaw = match[1];
          priceChangePctRaw = match[3];
          break;
        }
      }

      // Jika pola lengkap belum dapat, cari elemen harga spesifik di card tersebut
      if (lastPriceRaw === '0') {
        const priceEls = Array.from(parentCard.querySelectorAll('h1, h2, h3, span, div'));
        for (const el of priceEls) {
          const t = (el.innerText || '').trim();
          // Cek teks persentase misal "(+0.72%)" atau "-1.25%"
          if (t.includes('%') && priceChangePctRaw === '0') {
            priceChangePctRaw = t;
          }
          // Cek teks harga murni angka
          if (/^[1-9][0-9.,]{1,8}$/.test(t) && lastPriceRaw === '0') {
            lastPriceRaw = t;
          }
        }
      }

      // B. Ekstrak Baris Antrean Orderbook
      // Cari baris-baris di dalam card Orderbook (parentCard) yang memuat 6 kolom antrean
      const allDivsInCard = Array.from(parentCard.querySelectorAll('tr, div'));
      for (const d of allDivsInCard) {
        // Cek jika elemen memiliki tepat 6 anak kolom langsung (Freq | Lot | Bid | Offer | Lot | Freq)
        if (d.children.length === 6) {
          const cells = Array.from(d.children);
          const hasBid = (cells[0].className + cells[1].className + cells[2].className).toLowerCase().includes('bid');
          const hasOffer = (cells[3].className + cells[4].className + cells[5].className).toLowerCase().includes('offer');
          const rowText = (d.innerText || '').toLowerCase();

          // Pastikan bukan header dan bukan ringkasan total
          if (hasBid && hasOffer && !rowText.includes('freq') && !rowText.includes('total')) {
            const texts = cells.map((c) => (c.innerText || '').trim());
            rawOrderbookRows.push({
              bidFreq: texts[0] || '0',
              bidLot: texts[1] || '0',
              bidPrice: texts[2] || '0',
              offerPrice: texts[3] || '0',
              offerLot: texts[4] || '0',
              offerFreq: texts[5] || '0',
            });
          }
        }
      }
    }

    /* =====================================================================
     * 3. EKSTRAKSI BROKER SUMMARY
     * Strategi jangkar stabil:
     * - Cari container bertuliskan judul "Broker Summary" dan
     *   header kolom: "BY", "B.val", "B.lot", "B.avg", "SL", "S.val", "S.lot", "S.avg"
     * - Ambil tanggal transaksi dari date picker card Broker Summary (contoh: "16 Nov 26")
     * - Ekstrak setiap baris data broker untuk sisi Buyer (BY) dan Seller (SL)
     * ===================================================================== */
    let rawTradeDate = '';
    const rawBuyerItems = [];
    const rawSellerItems = [];

    // Temukan container Broker Summary
    const broksumContainer = allContainers.find((el) => {
      const text = el.innerText || '';
      return (
        text.includes('Broker Summary') &&
        (text.includes('BY') || text.includes('B.val')) &&
        (text.includes('SL') || text.includes('S.val')) &&
        text.length < 8000
      );
    });

    if (broksumContainer) {
      // A. Ambil Tanggal Transaksi dari Date Picker
      // Biasanya tertera tanggal seperti "16 Nov 26" atau "16 Nov 2026"
      const broksumText = broksumContainer.innerText || '';
      const dateMatch = broksumText.match(/(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})/);
      if (dateMatch) {
        rawTradeDate = dateMatch[1];
      }

      // B. Ekstraksi Data Baris Buyer & Seller
      // Struktur Stockbit dapat berupa 1 baris utuh dengan 8 kolom:
      // [0: BY, 1: B.val, 2: B.lot, 3: B.avg, 4: SL, 5: S.val, 6: S.lot, 7: S.avg]
      // atau dua tabel berdampingan (Buyer Table dan Seller Table).

      // Cek apakah ada baris dengan 8 kolom
      const candidateBsRows = Array.from(
        broksumContainer.querySelectorAll('tr, div[class*="row"]')
      );

      for (const row of candidateBsRows) {
        const cells = Array.from(row.querySelectorAll('td, div[class*="col"], div'))
          .map((c) => ({
            text: (c.innerText || '').trim(),
            element: c,
          }))
          .filter((c) => c.text.length > 0 && c.text.length < 30);

        const texts = cells.map((c) => c.text);

        // Jika satu baris memuat 8 sel (4 Buyer + 4 Seller)
        if (texts.length >= 8) {
          // Abaikan baris header
          if (texts[0].toUpperCase() === 'BY' || texts[4]?.toUpperCase() === 'SL') continue;
          if (texts.join(' ').toLowerCase().includes('total')) continue;

          // Deteksi kategori broker (FOREIGN vs LOCAL vs GOVERNMENT vs UNKNOWN)
          const detectCategory = (el) => {
            if (!el) return 'UNKNOWN';
            const className = (el.className || '').toLowerCase();
            const color = (el.style?.color || '').toLowerCase();
            if (className.includes('foreign') || color.includes('red') || color.includes('orange')) {
              return 'FOREIGN';
            }
            if (className.includes('local') || className.includes('domestic')) {
              return 'LOCAL';
            }
            if (className.includes('gov') || className.includes('bumn')) {
              return 'GOVERNMENT';
            }
            return 'UNKNOWN';
          };

          // Buyer Side
          const buyerCode = texts[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          if (buyerCode.length >= 2 && buyerCode.length <= 5) {
            rawBuyerItems.push({
              brokerCode: buyerCode,
              category: detectCategory(cells[0]?.element),
              buyValue: texts[1] || '0',
              buyLot: texts[2] || '0',
              avgBuyPrice: texts[3] || '0',
            });
          }

          // Seller Side
          const sellerCode = texts[4].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          if (sellerCode.length >= 2 && sellerCode.length <= 5) {
            rawSellerItems.push({
              brokerCode: sellerCode,
              category: detectCategory(cells[4]?.element),
              sellValue: texts[5] || '0',
              sellLot: texts[6] || '0',
              avgSellPrice: texts[7] || '0',
            });
          }
        }
      }

      // Jika format baris 8 kolom belum terisi, coba parsing via dua sub-panel terpisah
      if (rawBuyerItems.length === 0 && rawSellerItems.length === 0) {
        // Cari container yang memuat header BY
        const buyerSub = Array.from(broksumContainer.querySelectorAll('div, table')).find((el) => {
          const t = el.innerText || '';
          return t.includes('BY') && t.includes('B.val') && !t.includes('SL');
        });

        // Cari container yang memuat header SL
        const sellerSub = Array.from(broksumContainer.querySelectorAll('div, table')).find((el) => {
          const t = el.innerText || '';
          return t.includes('SL') && t.includes('S.val') && !t.includes('BY');
        });

        if (buyerSub) {
          const bRows = Array.from(buyerSub.querySelectorAll('tr, div[class*="row"]'));
          for (const r of bRows) {
            const cols = Array.from(r.querySelectorAll('td, div')).map((c) => (c.innerText || '').trim()).filter(Boolean);
            if (cols.length >= 4 && cols[0].toUpperCase() !== 'BY' && !cols.join(' ').toLowerCase().includes('total')) {
              const code = cols[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
              if (code.length >= 2 && code.length <= 5) {
                rawBuyerItems.push({
                  brokerCode: code,
                  category: 'UNKNOWN',
                  buyValue: cols[1] || '0',
                  buyLot: cols[2] || '0',
                  avgBuyPrice: cols[3] || '0',
                });
              }
            }
          }
        }

        if (sellerSub) {
          const sRows = Array.from(sellerSub.querySelectorAll('tr, div[class*="row"]'));
          for (const r of sRows) {
            const cols = Array.from(r.querySelectorAll('td, div')).map((c) => (c.innerText || '').trim()).filter(Boolean);
            if (cols.length >= 4 && cols[0].toUpperCase() !== 'SL' && !cols.join(' ').toLowerCase().includes('total')) {
              const code = cols[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
              if (code.length >= 2 && code.length <= 5) {
                rawSellerItems.push({
                  brokerCode: code,
                  category: 'UNKNOWN',
                  sellValue: cols[1] || '0',
                  sellLot: cols[2] || '0',
                  avgSellPrice: cols[3] || '0',
                });
              }
            }
          }
        }
      }
    }

    return {
      lastPriceRaw,
      priceChangePctRaw,
      rawOrderbookRows,
      rawTradeDate,
      rawBuyerItems,
      rawSellerItems,
    };
  });

  /* =====================================================================
   * 4. NORMALISASI & FORMATTING DI LUAR EVALUATE
   * ===================================================================== */

  // A. Format Orderbook
  const formattedOrderbook = extractedData.rawOrderbookRows.map((row, index) => ({
    level_order: index + 1,
    bidFreq: Math.round(parseAbbreviatedNumber(row.bidFreq)),
    bidLot: Math.round(parseAbbreviatedNumber(row.bidLot)),
    bidPrice: Math.round(parseAbbreviatedNumber(row.bidPrice)),
    offerPrice: Math.round(parseAbbreviatedNumber(row.offerPrice)),
    offerLot: Math.round(parseAbbreviatedNumber(row.offerLot)),
    offerFreq: Math.round(parseAbbreviatedNumber(row.offerFreq)),
  }));

  // B. Format & Gabungkan Broker Summary per broker_code
  // Gunakan Map agar broker yang melakukan transaksi beli dan jual digabung menjadi 1 baris
  const brokerMap = new Map();

  // Proses Buyer Side
  for (const item of extractedData.rawBuyerItems) {
    const code = item.brokerCode;
    const existing = brokerMap.get(code) || {
      brokerCode: code,
      category: item.category || 'UNKNOWN',
      buyLot: 0,
      buyValue: 0,
      avgBuyPrice: 0,
      sellLot: 0,
      sellValue: 0,
      avgSellPrice: 0,
    };

    existing.buyLot = Math.round(parseAbbreviatedNumber(item.buyLot));
    existing.buyValue = parseAbbreviatedNumber(item.buyValue);
    existing.avgBuyPrice = parseAbbreviatedNumber(item.avgBuyPrice);
    if (item.category && item.category !== 'UNKNOWN') {
      existing.category = item.category;
    }
    brokerMap.set(code, existing);
  }

  // Proses Seller Side
  for (const item of extractedData.rawSellerItems) {
    const code = item.brokerCode;
    const existing = brokerMap.get(code) || {
      brokerCode: code,
      category: item.category || 'UNKNOWN',
      buyLot: 0,
      buyValue: 0,
      avgBuyPrice: 0,
      sellLot: 0,
      sellValue: 0,
      avgSellPrice: 0,
    };

    existing.sellLot = Math.round(parseAbbreviatedNumber(item.sellLot));
    existing.sellValue = parseAbbreviatedNumber(item.sellValue);
    existing.avgSellPrice = parseAbbreviatedNumber(item.avgSellPrice);
    if (item.category && item.category !== 'UNKNOWN' && existing.category === 'UNKNOWN') {
      existing.category = item.category;
    }
    brokerMap.set(code, existing);
  }

  const formattedBroksum = Array.from(brokerMap.values());
  const effectiveTradeDate = parseTradeDate(extractedData.rawTradeDate);

  // Normalisasi harga terakhir dan persentase perubahan
  const lastPrice = Math.round(parseAbbreviatedNumber(extractedData.lastPriceRaw));
  let priceChangePct = 0;
  if (extractedData.priceChangePctRaw) {
    const cleanedPct = extractedData.priceChangePctRaw.replace(/[^0-9.-]/g, '');
    priceChangePct = parseFloat(cleanedPct) || 0;
  }

  return {
    stockCode,
    lastPrice: lastPrice > 0 ? lastPrice : null,
    priceChangePct: isNaN(priceChangePct) ? 0 : priceChangePct,
    tradeDate: effectiveTradeDate,
    capturedAt: new Date().toISOString(),
    orderbookList: formattedOrderbook,
    broksumList: formattedBroksum,
  };
}

/**
 * Alur kerja lengkap (Workflow) pengambilan data:
 * 1. Menyalakan Chromium & memuat sesi cookies
 * 2. Mengambil daftar emiten dari Watchlist (atau daftar custom jika diberikan)
 * 3. Mengunjungi tiap emiten secara berurutan dengan jeda acak 1.5 - 3 detik
 * 4. Menyimpan data snapshot tiap emiten ke MySQL secara transaksional
 *
 * @param {Object} options
 * @param {Array<string>} [options.symbols] - Opsi emiten spesifik jika tidak ingin scrape seluruh watchlist
 * @param {number} [options.limit] - Batasi jumlah emiten untuk keperluan uji coba
 * @param {boolean} [options.headless=true] - Mode headless Chromium
 * @param {Function} [options.onStockCaptured] - Callback event tiap kali 1 emiten selesai disimpan
 * @returns {Promise<Object>} Ringkasan hasil seluruh capture
 */
export async function captureWatchlistWorkflow({
  symbols = null,
  limit = null,
  headless = true,
  onStockCaptured = null,
} = {}) {
  let browser;
  const startTime = Date.now();
  const successList = [];
  const failedList = [];

  try {
    // 1. Luncurkan browser Chromium
    console.log(`🚀 Menjalankan Puppeteer Chromium (headless: ${headless})...`);
    browser = await puppeteer.launch({
      headless: headless ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Set User-Agent desktop modern
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    // Optimasi request interception: blokir asset gambar, media, dan font yang tidak memengaruhi DOM data
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'media', 'font'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // 2. Pasang session cookies agar dapat mengakses data penuh Stockbit (termasuk Broker Summary)
    const hasCookies = await applyCookies(page);

    // 3. Tentukan daftar kode emiten
    let targetSymbols = symbols;
    if (!targetSymbols || targetSymbols.length === 0) {
      if (!hasCookies) {
        throw new Error(
          'Tidak dapat mengakses Watchlist karena file cookies.json belum tersedia (akun belum login). ' +
          'Silakan jalankan "npm run login" di terminal backend terlebih dahulu untuk login manual dan menyimpan cookies sesi, ' +
          'atau tentukan daftar emiten secara eksplisit pada body request: { "symbols": ["BBCA", "BBRI"] }.'
        );
      }
      targetSymbols = await getWatchlistSymbols(page);
    }

    if (limit && Number(limit) > 0) {
      targetSymbols = targetSymbols.slice(0, Number(limit));
    }

    console.log(`🎯 Total emiten yang akan diproses: ${targetSymbols.length}`);

    // 4. Iterasi tiap emiten secara berurutan
    for (let i = 0; i < targetSymbols.length; i++) {
      const symbol = targetSymbols[i].toUpperCase().trim();
      console.log(`\n--------------------------------------------------`);
      console.log(`[${i + 1}/${targetSymbols.length}] Memproses emiten: ${symbol}`);

      try {
        // Ekstraksi data Orderbook & Broker Summary
        const stockData = await scrapeStockDetail(page, symbol);

        // Panggil callback penyimpanan ke database jika disediakan
        let saveResult = null;
        if (typeof onStockCaptured === 'function') {
          saveResult = await onStockCaptured(stockData);
        }

        successList.push({
          symbol,
          lastPrice: stockData.lastPrice,
          priceChangePct: stockData.priceChangePct,
          tradeDate: stockData.tradeDate,
          orderbookCount: stockData.orderbookList.length,
          broksumCount: stockData.broksumList.length,
          sessionId: saveResult?.sessionId || null,
        });

        console.log(
          `✅ Berhasil: ${symbol} (Harga: ${stockData.lastPrice}, OB: ${stockData.orderbookList.length} baris, BS: ${stockData.broksumList.length} broker)`
        );
      } catch (err) {
        console.error(`❌ Gagal memproses emiten ${symbol}:`, err.message);
        failedList.push({
          symbol,
          error: err.message,
        });
      }

      // Jeda acak antar-emiten (1.5 - 3 detik) untuk mematuhi rate limit & pola wajar manusia
      if (i < targetSymbols.length - 1) {
        const delayMs = Math.floor(Math.random() * (3000 - 1500 + 1)) + 1500;
        console.log(`⏳ Jeda ${delayMs}ms sebelum emiten berikutnya...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n==================================================`);
    console.log(`🏁 Selesai! Diproses dalam ${durationSeconds} detik.`);
    console.log(`   Sukses: ${successList.length}, Gagal: ${failedList.length}`);

    return {
      success: true,
      durationSeconds: Number(durationSeconds),
      totalProcessed: targetSymbols.length,
      successCount: successList.length,
      failedCount: failedList.length,
      successList,
      failedList,
    };
  } finally {
    // 5. Selalu tutup browser di akhir proses untuk mencegah memory leak
    if (browser) {
      await browser.close();
      console.log('🔒 Browser instance Chromium berhasil ditutup.');
    }
  }
}

/**
 * Helper tunggal untuk melakukan capture 1 emiten secara mandiri
 * @param {string} stockCode
 * @param {boolean} [headless=true]
 */
export async function captureSingleStock(stockCode, headless = true) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: headless ? 'new' : false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await applyCookies(page);

    return await scrapeStockDetail(page, stockCode);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}