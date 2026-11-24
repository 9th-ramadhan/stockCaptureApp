import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findChromeExecutable } from './browserService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lokasi default file cookies.json
export const DEFAULT_COOKIES_PATHS = [
  process.env.COOKIES_PATH,
  path.resolve(__dirname, '../../cookies.json'), // backend/cookies.json
  path.resolve(process.cwd(), 'cookies.json'), // root/cookies.json
  path.resolve(process.cwd(), 'backend/cookies.json'),
].filter(Boolean);

/**
 * Normalisasi berbagai format cookies menjadi format array Puppeteer
 * @param {any} data
 * @returns {Array<Object>}
 */
export function normalizeCookies(data) {
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
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>}
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

// Mutex pencegah pembukaan jendela login ganda
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
