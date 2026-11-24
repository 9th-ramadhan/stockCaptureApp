import puppeteer from 'puppeteer';
import { saveStockCapture } from '../models/stockModel.js';
import { parseAbbreviatedNumber, parseTradeDate } from '../utils/formatters.js';
import { applyCookies, ensurePageAuthenticated } from './authCookieService.js';
import { getWatchlistSymbols } from './orderbookScraperService.js';

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
    console.log(
      `\n🏁 [Mode 1 Selesai] Total: ${targetSymbols.length}, Sukses: ${successList.length}, Gagal: ${failedList.length} (${durationSeconds}s)`
    );

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
