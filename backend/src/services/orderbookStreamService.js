import puppeteer from 'puppeteer';
import { saveStockCapture } from '../models/stockModel.js';
import { getMarketSession } from '../utils/marketScheduleHelper.js';
import { parseAbbreviatedNumber } from '../utils/formatters.js';
import { findChromeExecutable } from './browserService.js';
import { applyCookies, ensurePageAuthenticated } from './authCookieService.js';
import { getWatchlistSymbols, extractOrderbookFromPage } from './orderbookScraperService.js';

/**
 * State global in-memory untuk streaming real-time Orderbook
 */
export const streamingState = {
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
 * Parsing adaptif frame WebSocket yang diterima dari Stockbit
 * @param {string} symbol
 * @param {string} payloadData
 */
export function handleWebSocketFrame(symbol, payloadData) {
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
export async function flushDirtyOrderbooksToDb() {
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
export function checkMarketClosingTime() {
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
  const isOutsideTradingHours = timeInMinutes < 9 * 60 + 55 || timeInMinutes >= 17 * 60 + 16;

  if (isWeekend || isOutsideTradingHours) {
    console.log(
      `⏰ [Stream] Di luar jam perdagangan bursa (${isWeekend ? 'Akhir Pekan' : 'Sebelum 09:55 atau Lewat 17:16 WITA'}). Menghentikan streaming secara otomatis...`
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

// Tangani sinyal sistem untuk graceful shutdown jika stream sedang aktif
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
