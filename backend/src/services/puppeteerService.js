import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveStockCapture, getMarketSession } from '../models/stockModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Deteksi path Google Chrome reguler di sistem pengguna (Windows/Linux/Mac)
 * Menggunakan Chrome asli sistem untuk kestabilan dan bypass proteksi automasi
 */
function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
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
  path.resolve(process.cwd(), 'cookies.json'), // root/cookies.json
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', mei: '05', may: '05',
    jun: '06', jul: '07', agu: '08', ags: '08', aug: '08', sep: '09',
    okt: '10', oct: '10', nov: '11', des: '12', dec: '12',
  };

  const match = str.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const monthKey = match[2].toLowerCase().slice(0, 3);
    const month = monthMap[monthKey] || '01';
    let year = match[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  const slashMatch = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0');
    const month = slashMatch[2].padStart(2, '0');
    let year = slashMatch[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalisasi berbagai format cookies menjadi format array Puppeteer
 */
function normalizeCookies(data) {
  if (!data) return [];

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

  if (typeof data === 'object' && data !== null) {
    return Object.entries(data).map(([name, value]) => ({
      name: String(name).trim(),
      value: typeof value === 'string' ? value : JSON.stringify(value),
      domain: '.stockbit.com',
      path: '/',
    }));
  }

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
        parsed = content;
      }

      const normalized = normalizeCookies(parsed);
      if (normalized.length > 0) {
        return normalized;
      }
    } catch {
      // Lanjut
    }
  }

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
        return normalized;
      }
    } catch {
      // Abaikan
    }
  }

  return null;
}

/**
 * Menerapkan cookies sesi login ke Puppeteer page
 */
export async function applyCookies(page) {
  const cookies = await loadCookies();
  if (cookies && cookies.length > 0) {
    await page.setCookie(...cookies);
    return true;
  } else {
    console.warn('⚠️ Tidak ada cookies.json yang ditemukan. Puppeteer akan berjalan tanpa login.');
    return false;
  }
}

/**
 * Fungsi opsional untuk menyimpan sesi login Stockbit (mode headless: false)
 */
let loginInProgressPromise = null;

/**
 * Memicu sesi login manual di Chromium (headless: false) dengan mutex pencegah tab ganda.
 * Menyalin dan memperbarui cookies.json secara otomatis saat pengguna menyelesaikan login.
 *
 * @param {string} [targetPath=null]
 * @param {number} [timeoutMs=180000]
 * @returns {Promise<Object>}
 */
export async function promptManualLoginAndRefreshCookies(targetPath = null, timeoutMs = 180000) {
  if (loginInProgressPromise) {
    console.log('⏳ Sesi login manual sedang berlangsung di jendela lain, menunggu...');
    return await loginInProgressPromise;
  }

  loginInProgressPromise = (async () => {
    try {
      return await saveLoginSession(targetPath, timeoutMs);
    } finally {
      loginInProgressPromise = null;
    }
  })();

  return await loginInProgressPromise;
}

/**
 * Memastikan halaman dalam status terautentikasi.
 * Jika terdeteksi redirect ke /login (karena cookies kedaluwarsa atau belum ada),
 * fungsi ini otomatis membuka tab Chromium (headless: false) agar pengguna login manual,
 * langsung menyalin cookies baru ke cookies.json, memasangnya ke page aktif, dan memuat ulang URL target.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} targetUrl
 * @returns {Promise<boolean>}
 */
export async function ensurePageAuthenticated(page, targetUrl) {
  const currentUrl = page.url();
  const isLoginPage =
    currentUrl.includes('/login') ||
    currentUrl.includes('/register') ||
    currentUrl.includes('accounts.google.com') ||
    (!currentUrl.includes('stockbit.com') && !currentUrl.includes('about:blank'));

  if (!isLoginPage) {
    return true;
  }

  console.warn(`\n⚠️ ============================================================`);
  console.warn(`⚠️ Sesi login Stockbit KEDALUWARSA / BELUM LOGIN (Redirect ke: ${currentUrl})`);
  console.warn(`🌐 MEMBUKA TAB CHROMIUM UNTUK LOGIN MANUAL PENGGUNA...`);
  console.warn(`   Silakan lakukan login di jendela browser yang muncul.`);
  console.warn(`   Sistem otomatis mendeteksi login, menyalin cookies, dan memperbarui cookies.json.`);
  console.warn(`============================================================\n`);

  const refreshResult = await promptManualLoginAndRefreshCookies();

  if (refreshResult && refreshResult.cookies && refreshResult.cookies.length > 0) {
    console.log(`✅ Memasang ${refreshResult.cookies.length} cookies baru ke halaman aktif...`);
    await page.setCookie(...refreshResult.cookies);

    console.log(`🔄 Mengulang navigasi ke: ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 35000,
    });

    const newUrl = page.url();
    if (newUrl.includes('/login')) {
      throw new Error('Gagal autentikasi: Halaman masih dialihkan ke /login setelah proses login manual.');
    }

    console.log(`🎉 Halaman berhasil dimuat dalam status terautentikasi!`);
    return true;
  } else {
    throw new Error('Gagal memperbarui cookies sesi login.');
  }
}

/**
 * Fungsi untuk menyimpan sesi login Stockbit (mode headless: false)
 * Membuka browser Chromium, mendeteksi token auth saat pengguna login,
 * menyalin dan memperbarui file cookies.json secara instan.
 *
 * @param {string} [outputPath] - Jalur file output penyimpanan cookies
 * @param {number} [timeoutMs=180000] - Batas waktu menunggu login (default 3 menit)
 * @returns {Promise<Object>}
 */
export async function saveLoginSession(outputPath = null, timeoutMs = 180000) {
  const targetPath = outputPath || path.resolve(__dirname, '../../cookies.json');
  console.log(`🚀 Meluncurkan browser Chromium untuk login manual ke Stockbit...`);

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

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    console.log(`🔗 Membuka halaman login: https://stockbit.com/login`);
    await page.goto('https://stockbit.com/login', { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('⏳ Menunggu login manual di jendela browser yang terbuka...');
    console.log('   Sistem otomatis mendeteksi login saat token auth tersimpan atau halaman berpindah.');

    const startTime = Date.now();
    let loggedIn = false;

    while (Date.now() - startTime < timeoutMs) {
      const currentUrl = page.url();
      const currentCookies = await page.cookies();

      const hasAuthCookie = currentCookies.some(
        (c) => c.name === 'credentialStorage' || c.name === 'sb_is_social_logged_in' || c.name === 'token'
      );

      const isNotOnLogin =
        !currentUrl.includes('/login') &&
        !currentUrl.includes('/register') &&
        !currentUrl.includes('accounts.google.com') &&
        !currentUrl.includes('google.com/signin');

      if ((hasAuthCookie && isNotOnLogin) || currentUrl.includes('/watchlist')) {
        console.log('🎯 Kondisi login terpenuhi! Memberi jeda 1 detik agar token tersimpan penuh...');
        await new Promise((r) => setTimeout(r, 1000));
        loggedIn = true;
        break;
      }

      await new Promise((r) => setTimeout(r, 1500));
    }

    if (!loggedIn) {
      throw new Error('Waktu tunggu login habis atau pengguna belum menyelesaikan login.');
    }

    console.log('🎉 Login berhasil terdeteksi! Mengambil dan menyalin seluruh cookies sesi...');
    const cookies = await page.cookies();

    // 1. Simpan ke targetPath (backend/cookies.json)
    await fs.writeFile(targetPath, JSON.stringify(cookies, null, 2), 'utf-8');
    console.log(`💾 ${cookies.length} cookie berhasil disimpan ke: ${targetPath}`);

    // 2. Sinkronkan juga ke lokasi cookies lainnya jika ada
    const rootCookiesPath = path.resolve(__dirname, '../../../cookies.json');
    try {
      if (fsSync.existsSync(path.dirname(rootCookiesPath))) {
        await fs.writeFile(rootCookiesPath, JSON.stringify(cookies, null, 2), 'utf-8');
      }
    } catch {}

    return {
      success: true,
      message: 'Sesi login berhasil disimpan dan diperbarui ke cookies.json',
      cookiesCount: cookies.length,
      savedPath: targetPath,
      cookies,
    };
  } finally {
    await browser.close();
    console.log('🔒 Browser login manual Chromium berhasil ditutup.');
  }
}

/**
 * Ekstraksi daftar kode emiten dari tabel Watchlist Stockbit
 */
export async function getWatchlistSymbols(page) {
  console.log('📋 Mengambil daftar emiten dari https://stockbit.com/watchlist...');

  await page.goto('https://stockbit.com/watchlist', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Jika dialihkan ke halaman login (cookies kedaluwarsa)
  if (page.url().includes('/login')) {
    await ensurePageAuthenticated(page, 'https://stockbit.com/watchlist');
  }

  try {
    await page.waitForSelector('tbody.ant-table-tbody tr.ant-table-row', { timeout: 25000 });
  } catch {
    if (page.url().includes('/login')) {
      await ensurePageAuthenticated(page, 'https://stockbit.com/watchlist');
      await page.waitForSelector('tbody.ant-table-tbody tr.ant-table-row', { timeout: 25000 });
    } else {
      throw new Error('Gagal memuat baris data watchlist Stockbit (timeout 25 detik).');
    }
  }

  await new Promise((r) => setTimeout(r, 800));

  const symbols = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('tbody.ant-table-tbody a[href*="/symbol/"]'));
    const stockCodes = links
      .map((a) => {
        const href = a.getAttribute('href') || '';
        const match = href.match(/\/symbol\/([A-Za-z0-9]+)/);
        return match ? match[1].toUpperCase() : null;
      })
      .filter(Boolean);

    if (stockCodes.length > 0) {
      return Array.from(new Set(stockCodes));
    }

    const rows = Array.from(document.querySelectorAll('tbody.ant-table-tbody tr.ant-table-row'));
    const result = [];
    for (const row of rows) {
      if (row.classList.contains('ant-table-measure-row')) continue;
      const firstCell = row.querySelector('td.ant-table-cell-fix-left') || row.children[0];
      if (!firstCell) continue;
      const codeWrapper = firstCell.querySelector('div[class*="sc-c5bdc04d"]') || firstCell;
      const text = (codeWrapper.innerText || codeWrapper.textContent || '').trim();
      if (text) {
        const match = text.match(/^[A-Z0-9]{4,6}/);
        if (match) result.push(match[0]);
      }
    }
    return Array.from(new Set(result));
  });

  console.log(`✅ Ditemukan ${symbols.length} emiten pada watchlist: ${symbols.join(', ')}`);
  return symbols;
}

/* ============================================================================
 * BAGIAN 1: MODE 1 - EKSTRAKSI KHUSUS BROKER SUMMARY (BATCH HARIAN)
 * ============================================================================ */

/**
 * Ekstraksi HANYA data Broker Summary pada halaman emiten (melewati parsing Orderbook)
 * @param {import('puppeteer').Page} page
 * @param {string} symbol - Kode saham (misal: 'BBCA')
 * @returns {Promise<Object>}
 */
export async function extractBrokerSummaryOnly(page, symbol) {
  const stockCode = symbol.toUpperCase().trim();
  const url = `https://stockbit.com/symbol/${stockCode}`;
  console.log(`🔍 [Broksum Mode] Mengunjungi emiten: ${url}`);

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Jika terdeteksi dialihkan ke form login (cookies kedaluwarsa)
  if (page.url().includes('/login')) {
    await ensurePageAuthenticated(page, url);
  }

  // Tunggu container utama
  try {
    await page.waitForSelector('main#main-container, [id="main-container"]', { timeout: 15000 });
  } catch {
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      await ensurePageAuthenticated(page, url);
      await page.waitForSelector('main#main-container, [id="main-container"]', { timeout: 15000 });
    }
  }

  // Scroll secukupnya ke bawah untuk memicu lazy-render kartu Broker Summary
  await page.evaluate(() => {
    window.scrollBy(0, 800);
    const mainContainer = document.querySelector('main#main-container');
    if (mainContainer) mainContainer.scrollTop = 800;
  });

  await new Promise((r) => setTimeout(r, 1200));

  // Ekstraksi data Broker Summary dalam DOM
  const rawData = await page.evaluate(() => {
    const main = document.querySelector('main#main-container') || document.body;
    let lastPriceRaw = '0';
    let priceChangePctRaw = '0';
    let rawTradeDate = '';
    const rawBuyerItems = [];
    const rawSellerItems = [];

    // 1. Ambil Header Harga dan Persentase Perubahan di atas halaman
    const priceRegex = /([0-9.,]+)\s+([+-]?[0-9.,]+)\s+\(([+-]?[0-9.,]+%)\)/;
    const bodyText = main.innerText || '';
    const matchHeader = bodyText.match(priceRegex);
    if (matchHeader) {
      lastPriceRaw = matchHeader[1];
      priceChangePctRaw = matchHeader[3];
    }

    // 2. Temukan container Broker Summary
    const allContainers = Array.from(main.querySelectorAll('div, section, table'));
    const broksumContainer = allContainers.find((el) => {
      const text = el.innerText || '';
      return (
        text.includes('Broker Summary') &&
        (text.includes('BY') || text.includes('B.val')) &&
        (text.includes('SL') || text.includes('S.val')) &&
        text.length < 9000
      );
    });

    if (broksumContainer) {
      // Tanggal Transaksi
      const bText = broksumContainer.innerText || '';
      const dateMatch = bText.match(/(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})/);
      if (dateMatch) rawTradeDate = dateMatch[1];

      // Kategori Broker helper
      const detectCategory = (el) => {
        if (!el) return 'UNKNOWN';
        const className = (el.className || '').toLowerCase();
        const color = (el.style?.color || '').toLowerCase();
        if (className.includes('foreign') || color.includes('red') || color.includes('orange')) return 'FOREIGN';
        if (className.includes('local') || className.includes('domestic')) return 'LOCAL';
        if (className.includes('gov') || className.includes('bumn')) return 'GOVERNMENT';
        return 'UNKNOWN';
      };

      // Cek baris 8 kolom
      const candidateRows = Array.from(broksumContainer.querySelectorAll('tr, div[class*="row"]'));
      for (const row of candidateRows) {
        const cells = Array.from(row.querySelectorAll('td, div[class*="col"], div'))
          .map((c) => ({ text: (c.innerText || '').trim(), element: c }))
          .filter((c) => c.text.length > 0 && c.text.length < 30);

        const texts = cells.map((c) => c.text);
        if (texts.length >= 8) {
          if (texts[0].toUpperCase() === 'BY' || texts[4]?.toUpperCase() === 'SL') continue;
          if (texts.join(' ').toLowerCase().includes('total')) continue;

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

      // Fallback format 2 sub-panel terpisah
      if (rawBuyerItems.length === 0 && rawSellerItems.length === 0) {
        const buyerSub = Array.from(broksumContainer.querySelectorAll('div, table')).find((el) => {
          const t = el.innerText || '';
          return t.includes('BY') && t.includes('B.val') && !t.includes('SL');
        });
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
      rawTradeDate,
      rawBuyerItems,
      rawSellerItems,
    };
  });

  // Normalisasi & Gabungkan per broker_code
  const brokerMap = new Map();

  for (const item of rawData.rawBuyerItems) {
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
    if (item.category && item.category !== 'UNKNOWN') existing.category = item.category;
    brokerMap.set(code, existing);
  }

  for (const item of rawData.rawSellerItems) {
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
  const effectiveTradeDate = parseTradeDate(rawData.rawTradeDate);

  const lastPrice = Math.round(parseAbbreviatedNumber(rawData.lastPriceRaw));
  let priceChangePct = 0;
  if (rawData.priceChangePctRaw) {
    const cleanedPct = rawData.priceChangePctRaw.replace(/[^0-9.-]/g, '');
    priceChangePct = parseFloat(cleanedPct) || 0;
  }

  return {
    stockCode,
    lastPrice: lastPrice > 0 ? lastPrice : null,
    priceChangePct: isNaN(priceChangePct) ? 0 : priceChangePct,
    tradeDate: effectiveTradeDate,
    capturedAt: new Date().toISOString(),
    captureType: 'BROKSUM',
    orderbookList: [], // Melewati Orderbook sesuai spesifikasi Mode 1
    broksumList: formattedBroksum,
  };
}

/**
 * Mode 1: Menjalankan capture Broker Summary harian untuk seluruh atau sebagian emiten
 * @param {Array<string>} [symbols=[]] - Daftar kode emiten
 * @param {Object} [options={}]
 * @param {boolean} [options.headless=true]
 * @param {number} [options.limit=null]
 * @returns {Promise<Object>}
 */
export async function captureBrokerSummaryOnly(symbols = [], { headless = true, limit = null } = {}) {
  let browser;
  const startTime = Date.now();
  const successList = [];
  const failedList = [];

  try {
    console.log(`🚀 [Mode 1] Memulai capture Broker Summary harian (headless: ${headless})...`);
    browser = await puppeteer.launch({
      headless: headless ? 'new' : false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    const hasCookies = await applyCookies(page);

    let targetSymbols = Array.isArray(symbols) && symbols.length > 0 ? symbols : null;
    if (!targetSymbols) {
      if (!hasCookies) {
        throw new Error('Sesi cookies.json diperlukan untuk membaca watchlist Stockbit.');
      }
      targetSymbols = await getWatchlistSymbols(page);
    }

    if (limit && Number(limit) > 0) {
      targetSymbols = targetSymbols.slice(0, Number(limit));
    }

    console.log(`🎯 [Mode 1] Total emiten yang akan diproses: ${targetSymbols.length}`);

    for (let i = 0; i < targetSymbols.length; i++) {
      const symbol = targetSymbols[i].toUpperCase().trim();
      console.log(`\n[${i + 1}/${targetSymbols.length}] Mengambil Broker Summary: ${symbol}`);

      try {
        const broksumData = await extractBrokerSummaryOnly(page, symbol);

        // Simpan ke database dengan capture_type = 'BROKSUM'
        const saveResult = await saveStockCapture({
          stockCode: symbol,
          lastPrice: broksumData.lastPrice,
          priceChangePct: broksumData.priceChangePct,
          tradeDate: broksumData.tradeDate,
          captureType: 'BROKSUM',
          orderbookList: [],
          broksumList: broksumData.broksumList,
          isDailyFinal: 1,
        });

        successList.push({
          symbol,
          lastPrice: broksumData.lastPrice,
          tradeDate: broksumData.tradeDate,
          broksumCount: broksumData.broksumList.length,
          sessionId: saveResult.sessionId,
        });

        console.log(`✅ [Broksum Sukses] ${symbol}: ${broksumData.broksumList.length} broker tercatat`);
      } catch (err) {
        console.error(`❌ [Broksum Gagal] ${symbol}:`, err.message);
        failedList.push({ symbol, error: err.message });
      }

      if (i < targetSymbols.length - 1) {
        const delayMs = Math.floor(Math.random() * (3000 - 1500 + 1)) + 1500;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n🏁 [Mode 1 Selesai] Total: ${targetSymbols.length}, Sukses: ${successList.length}, Gagal: ${failedList.length} (${durationSeconds}s)`);

    return {
      success: true,
      captureType: 'BROKSUM',
      durationSeconds: Number(durationSeconds),
      totalProcessed: targetSymbols.length,
      successCount: successList.length,
      failedCount: failedList.length,
      successList,
      failedList,
    };
  } finally {
    if (browser) {
      await browser.close();
      console.log('🔒 Browser instance Chromium [Mode 1] berhasil ditutup.');
    }
  }
}

/* ============================================================================
 * BAGIAN 2: MODE 2 - REAL-TIME ORDERBOOK STREAMING (CDP WEBSOCKET + THROTTLING 30 DETIK)
 * ============================================================================ */

/**
 * State global in-memory untuk streaming real-time Orderbook
 */
const streamingState = {
  isRunning: false,
  browser: null,
  pages: new Map(), // symbol -> page
  cdpClients: new Map(), // symbol -> client
  latestOrderbookMap: new Map(), // symbol -> { symbol, lastPrice, priceChangePct, orderbookList, isDirty, lastUpdated }
  intervalTimer: null,
  marketCheckTimer: null,
  monitoredSymbols: [],
  intervalMs: 30000,
  startTime: null,
  lastFlushTime: null,
  totalSessionsSaved: 0,
};

/**
 * Ekstraksi baris antrean Orderbook dari DOM halaman aktif (mendukung 10 level)
 */
async function extractOrderbookFromPage(page, symbol) {
  try {
    return await page.evaluate(() => {
      const main = document.querySelector('main#main-container') || document.body;
      let lastPriceRaw = '0';
      let priceChangePctRaw = '0';
      const rawRows = [];

      // 1. Ekstrak Header Harga
      const priceRegex = /([0-9.,]+)\s+([+-]?[0-9.,]+)\s+\(([+-]?[0-9.,]+%)\)/;
      const match = (main.innerText || '').match(priceRegex);
      if (match) {
        lastPriceRaw = match[1];
        priceChangePctRaw = match[3];
      }

      // 2. Cari kontainer Orderbook
      const allDivs = Array.from(main.querySelectorAll('div, section, table'));
      const obContainer = allDivs.find((el) => {
        const text = el.innerText || '';
        return (
          text.includes('Freq') &&
          text.includes('Lot') &&
          text.includes('Bid') &&
          text.includes('Offer') &&
          text.length < 5000
        );
      });

      if (obContainer) {
        let parentCard = obContainer;
        for (let i = 0; i < 4 && parentCard.parentElement; i++) {
          parentCard = parentCard.parentElement;
        }

        // Cari semua baris yang memuat 6 kolom antrean (Freq, Lot, Bid, Offer, Lot, Freq)
        const candidates = Array.from(parentCard.querySelectorAll('tr, div'));
        for (const d of candidates) {
          if (d.children.length === 6) {
            const cells = Array.from(d.children);
            const texts = cells.map((c) => (c.innerText || '').trim());
            const rowText = texts.join(' ').toLowerCase();

            // Abaikan header dan baris total
            if (rowText.includes('freq') || rowText.includes('total') || rowText.includes('lot') || rowText.includes('bid')) {
              continue;
            }

            // Cek apakah kolom 2 (bid price) atau kolom 3 (offer price) berupa angka harga valid
            const bidPriceVal = texts[2].replace(/[^0-9]/g, '');
            const offerPriceVal = texts[3].replace(/[^0-9]/g, '');
            const isPriceRow = (bidPriceVal.length > 0 && Number(bidPriceVal) > 0) || (offerPriceVal.length > 0 && Number(offerPriceVal) > 0);

            // Cek class atau data attribute
            const attrString = cells.map((c) => (c.getAttribute('data-cy') || '') + ' ' + (c.className || '')).join(' ').toLowerCase();
            const hasCyOrBidOffer = attrString.includes('bid') || attrString.includes('offer') || isPriceRow;

            if (isPriceRow && hasCyOrBidOffer) {
              rawRows.push({
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

        // Alternatif jika ada data-cy spesifik Stockbit
        if (rawRows.length === 0) {
          const bidButtons = Array.from(parentCard.querySelectorAll('[data-cy*="bid"], [data-cy*="Bid"]'));
          for (const btn of bidButtons) {
            let row = btn.parentElement;
            while (row && row.children.length !== 6 && row !== parentCard) {
              row = row.parentElement;
            }
            if (row && row.children.length === 6) {
              const texts = Array.from(row.children).map((c) => (c.innerText || '').trim());
              const rowText = texts.join(' ').toLowerCase();
              if (!rowText.includes('freq') && !rowText.includes('total')) {
                const isDuplicate = rawRows.some((r) => r.bidPrice === texts[2] && r.offerPrice === texts[3]);
                if (!isDuplicate) {
                  rawRows.push({
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
        }
      }

      return {
        lastPriceRaw,
        priceChangePctRaw,
        rawRows,
      };
    });
  } catch (err) {
    return null;
  }
}

/**
 * Parsing adaptif frame WebSocket yang diterima dari Stockbit
 */
function handleWebSocketFrame(symbol, payloadData) {
  if (!payloadData || typeof payloadData !== 'string') return;

  const isDebug = process.env.DEBUG_WS === 'true';
  if (isDebug) {
    const preview = payloadData.length > 150 ? payloadData.slice(0, 150) + '...' : payloadData;
    console.log(`📡 [CDP WS ${symbol}] Frame: ${preview}`);
  }

  // Stockbit sering menggunakan JSON string atau Socket.io packet (misal: '42["orderbook", {...}]')
  let parsedPayload = null;
  try {
    if (payloadData.startsWith('42[')) {
      const jsonStr = payloadData.slice(2);
      const arr = JSON.parse(jsonStr);
      if (Array.isArray(arr) && arr.length >= 2) {
        parsedPayload = arr[1];
      }
    } else if (payloadData.startsWith('{') || payloadData.startsWith('[')) {
      parsedPayload = JSON.parse(payloadData);
    }
  } catch {
    // Format frame non-JSON diabaikan secara elegan (fallback DOM aktif)
    return;
  }

  if (!parsedPayload) return;

  // Analisis apakah payload memuat data Orderbook / Price Tick
  const obData = parsedPayload.data || parsedPayload.orderbook || parsedPayload;
  const existing = streamingState.latestOrderbookMap.get(symbol);
  if (!existing) return;

  let hasUpdate = false;

  if (obData.last_price || obData.last || obData.close) {
    const p = Number(obData.last_price || obData.last || obData.close);
    if (!isNaN(p) && p > 0) {
      existing.lastPrice = Math.round(p);
      hasUpdate = true;
    }
  }

  if (obData.change_pct || obData.price_change_pct) {
    const pct = parseFloat(obData.change_pct || obData.price_change_pct);
    if (!isNaN(pct)) {
      existing.priceChangePct = pct;
      hasUpdate = true;
    }
  }

  // Jika payload menyediakan array bid/offer langsung
  if (Array.isArray(obData.bids) || Array.isArray(obData.offers)) {
    const bids = obData.bids || [];
    const offers = obData.offers || [];
    const maxLen = Math.max(bids.length, offers.length);
    const updatedList = [];

    for (let i = 0; i < maxLen; i++) {
      const b = bids[i] || {};
      const o = offers[i] || {};
      updatedList.push({
        level_order: i + 1,
        bidFreq: Number(b.freq || b.frequency || 0),
        bidLot: Number(b.lot || b.volume || 0),
        bidPrice: Number(b.price || 0) || null,
        offerPrice: Number(o.price || 0) || null,
        offerLot: Number(o.lot || o.volume || 0),
        offerFreq: Number(o.freq || o.frequency || 0),
      });
    }

    if (updatedList.length > 0) {
      existing.orderbookList = updatedList;
      hasUpdate = true;
    }
  }

  if (hasUpdate) {
    existing.isDirty = true;
    existing.lastUpdated = new Date().toISOString();
  }
}

/**
 * Sinkronisasi dan flushing in-memory orderbook ke database MySQL setiap interval 30 detik
 */
async function flushDirtyOrderbooksToDb() {
  if (!streamingState.isRunning) return;

  const entriesToSave = [];

  for (const [symbol, state] of streamingState.latestOrderbookMap.entries()) {
    // Sinkronisasi data terkini dari DOM halaman aktif agar seluruh level 1-10 selalu presisi
    const page = streamingState.pages.get(symbol);
    if (page && !page.isClosed()) {
      try {
        const domResult = await extractOrderbookFromPage(page, symbol);
        if (domResult && domResult.rawRows && domResult.rawRows.length > 0) {
          const formattedList = domResult.rawRows.map((r, idx) => ({
            level_order: idx + 1,
            bidFreq: Math.round(parseAbbreviatedNumber(r.bidFreq)),
            bidLot: Math.round(parseAbbreviatedNumber(r.bidLot)),
            bidPrice: Math.round(parseAbbreviatedNumber(r.bidPrice)),
            offerPrice: Math.round(parseAbbreviatedNumber(r.offerPrice)),
            offerLot: Math.round(parseAbbreviatedNumber(r.offerLot)),
            offerFreq: Math.round(parseAbbreviatedNumber(r.offerFreq)),
          }));

          const domPrice = Math.round(parseAbbreviatedNumber(domResult.lastPriceRaw));
          if (domPrice > 0) state.lastPrice = domPrice;

          if (domResult.priceChangePctRaw) {
            const pct = parseFloat(domResult.priceChangePctRaw.replace(/[^0-9.-]/g, ''));
            if (!isNaN(pct)) state.priceChangePct = pct;
          }

          state.orderbookList = formattedList;
          state.isDirty = true;
          state.lastUpdated = new Date().toISOString();
        }
      } catch (pageErr) {
        // Abaikan error evaluasi individual
      }
    }

    if (state.isDirty && state.orderbookList && state.orderbookList.length > 0) {
      entriesToSave.push(state);
    }
  }

  if (entriesToSave.length === 0) {
    return;
  }

  for (const entry of entriesToSave) {
    try {
      const marketSession = getMarketSession();
      const saveResult = await saveStockCapture({
        stockCode: entry.symbol,
        lastPrice: entry.lastPrice,
        priceChangePct: entry.priceChangePct,
        captureType: 'ORDERBOOK',
        marketSession,
        orderbookList: entry.orderbookList,
        broksumList: [],
        capturedAt: new Date(),
      });

      entry.isDirty = false;
      streamingState.totalSessionsSaved++;
      streamingState.lastFlushTime = new Date().toISOString();

      console.log(
        `💾 [Stream 30s] ${entry.symbol} Orderbook disimpan (Session #${saveResult.sessionId}, Sesi: ${marketSession}, Harga: ${entry.lastPrice}, OB: ${entry.orderbookList.length} baris)`
      );
    } catch (err) {
      console.error(`❌ [Stream Flush Error] Gagal menyimpan Orderbook ${entry.symbol}:`, err.message);
    }
  }
}

/**
 * Pengecekan otomatis jam tutup bursa BEI (WITA)
 */
function checkMarketClosingTime() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Makassar',
    hour12: false,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
  });
  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find((p) => p.type === type)?.value;

  const weekday = getPart('weekday');
  const hour = parseInt(getPart('hour') || '0', 10);
  const minute = parseInt(getPart('minute') || '0', 10);
  const timeInMinutes = hour * 60 + minute;

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const isPastClosing = timeInMinutes >= 17 * 60 + 16; // 17:16 WITA

  if (isWeekend || isPastClosing) {
    console.log(
      `⏰ [Stream] Batas waktu perdagangan bursa berakhir (${isWeekend ? 'Akhir Pekan' : 'Pukul 17:16 WITA'}). Menghentikan streaming secara otomatis...`
    );
    stopRealtimeOrderbookStream('MARKET_CLOSED');
  }
}

/**
 * Mode 2: Memulai streaming real-time Orderbook via Chrome DevTools Protocol (CDP) WebSocket
 * @param {Array<string>} [symbols=[]] - Daftar kode emiten yang akan dipantau
 * @param {Object} [options={}]
 * @param {number} [options.intervalMs=30000] - Interval throttling penyimpanan (default 30 detik)
 * @param {boolean} [options.headless=true]
 * @returns {Promise<Object>}
 */
export async function startRealtimeOrderbookStream(symbols = [], { intervalMs = 30000, headless = true } = {}) {
  if (streamingState.isRunning) {
    return {
      status: 'already_running',
      message: 'Streaming real-time Orderbook sudah berjalan aktif',
      monitoredSymbols: streamingState.monitoredSymbols,
      totalSessionsSaved: streamingState.totalSessionsSaved,
      lastFlushTime: streamingState.lastFlushTime,
    };
  }

  const maxSymbols = Number(process.env.MAX_STREAM_SYMBOLS) || 5;
  const configuredIntervalMs = Number(process.env.STREAM_INTERVAL_MS) || intervalMs || 30000;

  console.log(`\n=============================================================`);
  console.log(`🚀 [Mode 2] Memulai Real-Time Orderbook Stream via CDP WebSocket`);
  console.log(`   Sampling Interval: ${configuredIntervalMs / 1000} detik | Max Emiten: ${maxSymbols}`);
  console.log(`=============================================================`);

  // Luncurkan browser Chromium
  const realChromePath = findChromeExecutable();
  const browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
    executablePath: realChromePath || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--window-size=1600,900',
    ],
  });

  streamingState.browser = browser;
  streamingState.isRunning = true;
  streamingState.intervalMs = configuredIntervalMs;
  streamingState.startTime = new Date().toISOString();
  streamingState.totalSessionsSaved = 0;
  streamingState.pages.clear();
  streamingState.cdpClients.clear();
  streamingState.latestOrderbookMap.clear();

  try {
    // 1. Tentukan daftar target emiten
    let targetSymbols = Array.isArray(symbols) && symbols.length > 0 ? symbols : null;
    if (!targetSymbols) {
      const initPage = await browser.newPage();
      await initPage.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      );
      await applyCookies(initPage);
      targetSymbols = await getWatchlistSymbols(initPage);
      await initPage.close();
    }

    targetSymbols = targetSymbols.map((s) => s.toUpperCase().trim()).slice(0, maxSymbols);
    streamingState.monitoredSymbols = targetSymbols;

    console.log(`🎯 Emiten yang dipantau real-time: ${targetSymbols.join(', ')}`);

    // 2. Buka setiap emiten dalam tab terpisah dengan CDP Network WebSocket Listener
    for (const symbol of targetSymbols) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      );

      // Blokir aset berat untuk menghemat bandwidth & memori RAM
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'font', 'media'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await applyCookies(page);

      // Aktifkan Chrome DevTools Protocol Session
      const client = await page.createCDPSession();
      await client.send('Network.enable');

      // Dengarkan streaming WebSocket frames
      client.on('Network.webSocketFrameReceived', (params) => {
        const payloadData = params.response?.payloadData;
        handleWebSocketFrame(symbol, payloadData);
      });

      streamingState.pages.set(symbol, page);
      streamingState.cdpClients.set(symbol, client);

      // Inisialisasi state in-memory
      streamingState.latestOrderbookMap.set(symbol, {
        symbol,
        lastPrice: null,
        priceChangePct: null,
        orderbookList: [],
        isDirty: false,
        lastUpdated: null,
      });

      // Buka halaman emiten
      const url = `https://stockbit.com/symbol/${symbol}`;
      console.log(`🌐 [Stream Tab] Membuka ${symbol}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });

      if (page.url().includes('/login')) {
        await ensurePageAuthenticated(page, url);
      }

      // Beri jeda antar tab agar CPU tidak melonjak
      await new Promise((r) => setTimeout(r, 1500));
    }

    // 3. Jalankan timer throttling 30 detik
    streamingState.intervalTimer = setInterval(() => {
      flushDirtyOrderbooksToDb().catch((e) => console.error('Error saat flush 30s:', e.message));
    }, streamingState.intervalMs);

    // 4. Jalankan timer pengecekan jam tutup bursa setiap 1 menit
    streamingState.marketCheckTimer = setInterval(() => {
      checkMarketClosingTime();
    }, 60000);

    // Lakukan evaluasi pertama setelah 5 detik
    setTimeout(() => {
      flushDirtyOrderbooksToDb().catch((e) => console.error('Error inisiasi awal flush:', e.message));
    }, 5000);

    return {
      status: 'started',
      message: 'Streaming real-time Orderbook berhasil dimulai',
      monitoredSymbols: targetSymbols,
      intervalSeconds: streamingState.intervalMs / 1000,
      startTime: streamingState.startTime,
    };
  } catch (err) {
    console.error('❌ Gagal memulai Real-Time Orderbook Stream:', err.message);
    await stopRealtimeOrderbookStream('START_ERROR');
    throw err;
  }
}

/**
 * Menghentikan layanan streaming real-time Orderbook secara aman (Graceful Shutdown)
 * @param {string} [reason='MANUAL']
 */
export async function stopRealtimeOrderbookStream(reason = 'MANUAL') {
  if (!streamingState.isRunning) {
    return {
      status: 'not_running',
      message: 'Streaming tidak sedang berjalan',
    };
  }

  console.log(`🛑 Menghentikan Real-Time Orderbook Stream (Alasan: ${reason})...`);

  // Bersihkan interval timer
  if (streamingState.intervalTimer) {
    clearInterval(streamingState.intervalTimer);
    streamingState.intervalTimer = null;
  }
  if (streamingState.marketCheckTimer) {
    clearInterval(streamingState.marketCheckTimer);
    streamingState.marketCheckTimer = null;
  }

  // Flush data tersisa ke database
  try {
    console.log('💾 Menyimpan sisa buffer terakhir ke database...');
    await flushDirtyOrderbooksToDb();
  } catch (err) {
    console.error('Gagal menyimpan sisa buffer:', err.message);
  }

  // Tutup CDP sessions & pages
  for (const [symbol, client] of streamingState.cdpClients.entries()) {
    try {
      await client.detach();
    } catch {}
  }
  streamingState.cdpClients.clear();

  for (const [symbol, page] of streamingState.pages.entries()) {
    try {
      if (!page.isClosed()) await page.close();
    } catch {}
  }
  streamingState.pages.clear();

  // Tutup browser
  if (streamingState.browser) {
    try {
      await streamingState.browser.close();
    } catch {}
    streamingState.browser = null;
  }

  streamingState.isRunning = false;
  console.log('✅ Real-Time Orderbook Stream berhasil dihentikan secara bersih.');

  return {
    status: 'stopped',
    message: 'Layanan streaming Orderbook telah dihentikan',
    reason,
    totalSessionsSaved: streamingState.totalSessionsSaved,
    lastFlushTime: streamingState.lastFlushTime,
  };
}

/**
 * Mengambil status terkini dari streaming real-time Orderbook
 */
export function getRealtimeOrderbookStatus() {
  return {
    isRunning: streamingState.isRunning,
    monitoredSymbols: streamingState.monitoredSymbols,
    intervalSeconds: streamingState.intervalMs / 1000,
    startTime: streamingState.startTime,
    lastFlushTime: streamingState.lastFlushTime,
    totalSessionsSaved: streamingState.totalSessionsSaved,
    activeTabs: streamingState.pages.size,
    marketSession: getMarketSession(),
  };
}

// Alias fungsi
export const getStreamStatus = getRealtimeOrderbookStatus;

/* ============================================================================
 * BAGIAN 3: WORKFLOW LAMA (BACKWARD COMPATIBILITY)
 * ============================================================================ */

/**
 * Ekstraksi Orderbook dan Broker Summary lengkap (Workflow sebelumnya)
 */
export async function scrapeStockDetail(page, symbol) {
  const broksumData = await extractBrokerSummaryOnly(page, symbol);
  const orderbookData = await extractOrderbookFromPage(page, symbol);

  let formattedOrderbook = [];
  if (orderbookData && orderbookData.rawRows) {
    formattedOrderbook = orderbookData.rawRows.map((row, index) => ({
      level_order: index + 1,
      bidFreq: Math.round(parseAbbreviatedNumber(row.bidFreq)),
      bidLot: Math.round(parseAbbreviatedNumber(row.bidLot)),
      bidPrice: Math.round(parseAbbreviatedNumber(row.bidPrice)),
      offerPrice: Math.round(parseAbbreviatedNumber(row.offerPrice)),
      offerLot: Math.round(parseAbbreviatedNumber(row.offerLot)),
      offerFreq: Math.round(parseAbbreviatedNumber(row.offerFreq)),
    }));
  }

  return {
    stockCode: symbol.toUpperCase().trim(),
    lastPrice: broksumData.lastPrice,
    priceChangePct: broksumData.priceChangePct,
    tradeDate: broksumData.tradeDate,
    capturedAt: new Date().toISOString(),
    orderbookList: formattedOrderbook,
    broksumList: broksumData.broksumList,
  };
}

/**
 * Workflow gabungan lama untuk scraping watchlist
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
    browser = await puppeteer.launch({
      headless: headless ? 'new' : false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    const hasCookies = await applyCookies(page);
    let targetSymbols = symbols;
    if (!targetSymbols || targetSymbols.length === 0) {
      if (!hasCookies) {
        throw new Error('File cookies.json diperlukan untuk membaca watchlist.');
      }
      targetSymbols = await getWatchlistSymbols(page);
    }

    if (limit && Number(limit) > 0) {
      targetSymbols = targetSymbols.slice(0, Number(limit));
    }

    for (let i = 0; i < targetSymbols.length; i++) {
      const symbol = targetSymbols[i].toUpperCase().trim();
      try {
        const stockData = await scrapeStockDetail(page, symbol);
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
      } catch (err) {
        failedList.push({ symbol, error: err.message });
      }

      if (i < targetSymbols.length - 1) {
        await randomDelay(1500, 3000);
      }
    }

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
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
    if (browser) await browser.close();
  }
}

/**
 * Ekstraksi HANYA data Orderbook pada halaman emiten (melewati parsing Broker Summary)
 * @param {import('puppeteer').Page} page
 * @param {string} symbol - Kode saham (misal: 'BBCA')
 * @returns {Promise<Object>}
 */
export async function extractOrderbookOnly(page, symbol) {
  const stockCode = symbol.toUpperCase().trim();
  const url = `https://stockbit.com/symbol/${stockCode}`;
  console.log(`🔍 [Orderbook Mode] Mengunjungi emiten: ${url}`);

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Jika terdeteksi dialihkan ke form login (cookies kedaluwarsa)
  if (page.url().includes('/login')) {
    await ensurePageAuthenticated(page, url);
  }

  try {
    await page.waitForSelector('main#main-container, [id="main-container"]', { timeout: 15000 });
  } catch {
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      await ensurePageAuthenticated(page, url);
      await page.waitForSelector('main#main-container, [id="main-container"]', { timeout: 15000 });
    }
  }

  // Beri jeda singkat agar reaktif render selesai
  await new Promise((r) => setTimeout(r, 1200));

  const domResult = await extractOrderbookFromPage(page, stockCode);
  if (!domResult) {
    throw new Error(`Gagal mengekstrak elemen Orderbook untuk ${stockCode}`);
  }

  const lastPrice = Math.round(parseAbbreviatedNumber(domResult.lastPriceRaw));
  let priceChangePct = 0;
  if (domResult.priceChangePctRaw) {
    const cleanedPct = domResult.priceChangePctRaw.replace(/[^0-9.-]/g, '');
    priceChangePct = parseFloat(cleanedPct) || 0;
  }

  const formattedOrderbook = (domResult.rawRows || []).map((row, index) => ({
    level_order: index + 1,
    bidFreq: Math.round(parseAbbreviatedNumber(row.bidFreq)),
    bidLot: Math.round(parseAbbreviatedNumber(row.bidLot)),
    bidPrice: Math.round(parseAbbreviatedNumber(row.bidPrice)),
    offerPrice: Math.round(parseAbbreviatedNumber(row.offerPrice)),
    offerLot: Math.round(parseAbbreviatedNumber(row.offerLot)),
    offerFreq: Math.round(parseAbbreviatedNumber(row.offerFreq)),
  }));

  return {
    stockCode,
    lastPrice: lastPrice > 0 ? lastPrice : null,
    priceChangePct: isNaN(priceChangePct) ? 0 : priceChangePct,
    capturedAt: new Date().toISOString(),
    captureType: 'ORDERBOOK',
    orderbookList: formattedOrderbook,
  };
}

/**
 * Capture Snapshot Orderbook Terakhir (Digunakan saat Fallback di luar jam bursa atau On-Demand)
 * @param {Array<string>} [symbols=[]] - Daftar kode emiten
 * @param {Object} [options={}]
 * @param {boolean} [options.headless=true]
 * @param {number} [options.limit=null]
 * @returns {Promise<Object>}
 */
export async function captureOrderbookSnapshotOnly(symbols = [], { headless = true, limit = null } = {}) {
  let browser;
  const startTime = Date.now();
  const successList = [];
  const failedList = [];

  try {
    console.log(`🚀 [Orderbook Fallback Snapshot] Memulai capture Orderbook terakhir (headless: ${headless})...`);
    browser = await puppeteer.launch({
      headless: headless ? 'new' : false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    const hasCookies = await applyCookies(page);

    let targetSymbols = Array.isArray(symbols) && symbols.length > 0 ? symbols : null;
    if (!targetSymbols) {
      if (!hasCookies) {
        throw new Error('Sesi cookies.json diperlukan untuk membaca watchlist Stockbit.');
      }
      targetSymbols = await getWatchlistSymbols(page);
    }

    if (limit && Number(limit) > 0) {
      targetSymbols = targetSymbols.slice(0, Number(limit));
    }

    console.log(`🎯 [Orderbook Snapshot] Total emiten yang akan diproses: ${targetSymbols.length}`);

    for (let i = 0; i < targetSymbols.length; i++) {
      const symbol = targetSymbols[i].toUpperCase().trim();
      console.log(`\n[${i + 1}/${targetSymbols.length}] Mengambil snapshot Orderbook: ${symbol}`);

      try {
        const obData = await extractOrderbookOnly(page, symbol);
        const marketSession = getMarketSession();

        const saveResult = await saveStockCapture({
          stockCode: symbol,
          lastPrice: obData.lastPrice,
          priceChangePct: obData.priceChangePct,
          captureType: 'ORDERBOOK',
          marketSession,
          orderbookList: obData.orderbookList,
          broksumList: [],
          capturedAt: new Date(),
        });

        successList.push({
          symbol,
          lastPrice: obData.lastPrice,
          priceChangePct: obData.priceChangePct,
          marketSession,
          orderbookCount: obData.orderbookList.length,
          sessionId: saveResult.sessionId,
        });

        console.log(
          `✅ [Snapshot Sukses] ${symbol}: Harga ${obData.lastPrice}, ${obData.orderbookList.length} baris orderbook tersimpan (Sesi: ${marketSession})`
        );
      } catch (err) {
        console.error(`❌ [Snapshot Gagal] ${symbol}:`, err.message);
        failedList.push({ symbol, error: err.message });
      }

      if (i < targetSymbols.length - 1) {
        await randomDelay(1500, 3000);
      }
    }

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `\n🏁 [Snapshot Selesai] Total: ${targetSymbols.length}, Sukses: ${successList.length}, Gagal: ${failedList.length} (${durationSeconds}s)`
    );

    return {
      success: true,
      captureType: 'ORDERBOOK',
      isFallback: true,
      durationSeconds: Number(durationSeconds),
      totalProcessed: targetSymbols.length,
      successCount: successList.length,
      failedCount: failedList.length,
      successList,
      failedList,
    };
  } finally {
    if (browser) {
      await browser.close();
      console.log('🔒 Browser instance Chromium [Snapshot] berhasil ditutup.');
    }
  }
}

/**
 * Capture 1 emiten tunggal (kompatibilitas lama)
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
    if (browser) await browser.close();
  }
}

// Tangani sinyal sistem untuk graceful shutdown
process.on('SIGINT', async () => {
  if (streamingState.isRunning) {
    console.log('\n🛑 Menerima sinyal SIGINT...');
    await stopRealtimeOrderbookStream('SIGINT');
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (streamingState.isRunning) {
    console.log('\n🛑 Menerima sinyal SIGTERM...');
    await stopRealtimeOrderbookStream('SIGTERM');
  }
  process.exit(0);
});