import puppeteer from 'puppeteer';
import { saveStockCapture } from '../models/stockModel.js';
import { getMarketSession } from '../utils/marketScheduleHelper.js';
import { parseAbbreviatedNumber, randomDelay } from '../utils/formatters.js';
import { applyCookies, ensurePageAuthenticated } from './authCookieService.js';

/**
 * Ekstraksi daftar kode emiten dari tabel Watchlist Stockbit
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Array<string>>}
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

/**
 * Ekstraksi baris antrean Orderbook dari DOM halaman aktif (mendukung 10 level)
 * @param {import('puppeteer').Page} page
 * @param {string} symbol
 * @returns {Promise<Object|null>}
 */
export async function extractOrderbookFromPage(page, symbol) {
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
