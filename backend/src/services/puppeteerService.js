/**
 * ============================================================================
 * PUPPETEER SERVICE FACADE
 * ============================================================================
 * Berkas ini bertindak sebagai Facade arsitektural (mirip Facade pada Laravel)
 * yang mengagregasikan dan me-re-export seluruh sub-service Puppeteer & Scraper.
 *
 * Pemisahan Tanggung Jawab (Separation of Concerns):
 * 1. browserService.js            -> Deteksi binary Chromium & environment browser
 * 2. authCookieService.js         -> Manajemen cookies.json, auto-login modal, dan autentikasi
 * 3. brokerSummaryScraperService.js -> Scraper khusus Broker Summary (Mode 1 Batch Harian)
 * 4. orderbookScraperService.js   -> Scraper khusus antrean Orderbook (Snapshot/Fallback) & Watchlist
 * 5. orderbookStreamService.js    -> WebSocket CDP listener, State Machine, & Throttling (Mode 2)
 * 6. formatters.js & helper       -> Utilitas angka, regex tanggal, dan jam bursa
 *
 * Dengan pola ini, seluruh pemanggil eksternal (controller, script runner, cron)
 * tetap memiliki backward compatibility 100% tanpa risiko breaking changes.
 */

import puppeteer from 'puppeteer';

// 1. Re-export Utilitas Format & Jadwal Bursa
export {
  randomDelay,
  parseAbbreviatedNumber,
  parseTradeDate,
} from '../utils/formatters.js';

export {
  getMarketSession,
} from '../utils/marketScheduleHelper.js';

// 2. Re-export Browser & Autentikasi / Cookies
export {
  findChromeExecutable,
} from './browserService.js';

export {
  DEFAULT_COOKIES_PATHS,
  normalizeCookies,
  loadCookies,
  applyCookies,
  promptManualLoginAndRefreshCookies,
  ensurePageAuthenticated,
  saveLoginSession,
} from './authCookieService.js';

// 3. Re-export Scraper Orderbook & Watchlist
export {
  getWatchlistSymbols,
  extractOrderbookFromPage,
  extractOrderbookOnly,
  captureOrderbookSnapshotOnly,
} from './orderbookScraperService.js';

// 4. Re-export Scraper Broker Summary
export {
  extractBrokerSummaryOnly,
  captureBrokerSummaryOnly,
} from './brokerSummaryScraperService.js';

// 5. Re-export Streaming Real-Time Orderbook (Mode 2)
export {
  streamingState,
  handleWebSocketFrame,
  flushDirtyOrderbooksToDb,
  checkMarketClosingTime,
  startRealtimeOrderbookStream,
  stopRealtimeOrderbookStream,
  getRealtimeOrderbookStatus,
  getStreamStatus,
} from './orderbookStreamService.js';

// Internal imports untuk alur kerja legacy
import { parseAbbreviatedNumber, randomDelay } from '../utils/formatters.js';
import { applyCookies } from './authCookieService.js';
import { getWatchlistSymbols, extractOrderbookFromPage } from './orderbookScraperService.js';
import { extractBrokerSummaryOnly } from './brokerSummaryScraperService.js';

/* ============================================================================
 * BAGIAN: WORKFLOW LAMA (BACKWARD COMPATIBILITY)
 * ============================================================================ */

/**
 * Ekstraksi Orderbook dan Broker Summary lengkap (Workflow sebelumnya)
 * @param {import('puppeteer').Page} page
 * @param {string} symbol
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
