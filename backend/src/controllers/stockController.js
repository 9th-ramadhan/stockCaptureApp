import {
  captureWatchlistWorkflow,
  captureSingleStock,
  saveLoginSession,
  captureBrokerSummaryOnly,
  startRealtimeOrderbookStream,
  stopRealtimeOrderbookStream,
  getRealtimeOrderbookStatus,
} from '../services/puppeteerService.js';
import {
  saveStockCapture,
  getSessions,
  getSessionDetail,
} from '../models/stockModel.js';

/**
 * Controller: Menjalankan capture khusus Broker Summary (Mode 1 Batch Harian)
 * POST /api/capture/broksum
 * Body (opsional):
 * {
 *   "symbols": ["BBCA", "BBRI"],
 *   "limit": 10,
 *   "headless": true
 * }
 */
export async function handleCaptureBroksum(req, res) {
  try {
    const { symbols, limit, headless = true } = req.body || {};
    console.log('📥 Menerima permintaan POST /api/capture/broksum...');

    const result = await captureBrokerSummaryOnly(
      Array.isArray(symbols) && symbols.length > 0 ? symbols : [],
      {
        limit: limit ? Number(limit) : null,
        headless: headless !== false,
      }
    );

    return res.status(200).json({
      status: 'success',
      message: 'Proses capture Broker Summary selesai',
      data: result,
    });
  } catch (error) {
    console.error('❌ Error pada handleCaptureBroksum:', error.message);
    const isAuthError =
      error.message.includes('cookies.json') ||
      error.message.includes('login') ||
      error.message.includes('Sesi');

    return res.status(isAuthError ? 401 : 500).json({
      status: 'error',
      requiresLogin: isAuthError,
      message: isAuthError
        ? 'Sesi akun Stockbit (cookies.json) diperlukan untuk mengakses Broker Summary.'
        : 'Gagal menjalankan capture Broker Summary',
      error: error.message,
    });
  }
}

/**
 * Controller: Memulai layanan streaming real-time Orderbook via CDP WebSocket (Mode 2)
 * POST /api/stream/orderbook/start
 * Body (opsional):
 * {
 *   "symbols": ["BBCA", "BBRI"],
 *   "intervalSeconds": 30,
 *   "headless": true
 * }
 */
export async function handleStartOrderbookStream(req, res) {
  try {
    const { symbols, intervalSeconds = 30, headless = true } = req.body || {};
    console.log('📥 Menerima permintaan POST /api/stream/orderbook/start...');

    const intervalMs = Math.max(5000, Number(intervalSeconds || 30) * 1000);

    const result = await startRealtimeOrderbookStream(
      Array.isArray(symbols) && symbols.length > 0 ? symbols : [],
      {
        intervalMs,
        headless: headless !== false,
      }
    );

    return res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    console.error('❌ Error pada handleStartOrderbookStream:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal memulai layanan streaming Orderbook',
      error: error.message,
    });
  }
}

/**
 * Controller: Menghentikan layanan streaming real-time Orderbook secara aman
 * POST /api/stream/orderbook/stop
 */
export async function handleStopOrderbookStream(req, res) {
  try {
    console.log('📥 Menerima permintaan POST /api/stream/orderbook/stop...');
    const result = await stopRealtimeOrderbookStream('API_REQUEST');

    return res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    console.error('❌ Error pada handleStopOrderbookStream:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal menghentikan layanan streaming Orderbook',
      error: error.message,
    });
  }
}

/**
 * Controller: Mengambil status aktivitas streaming real-time Orderbook
 * GET /api/stream/orderbook/status
 */
export function handleGetStreamStatus(req, res) {
  try {
    const status = getRealtimeOrderbookStatus();
    return res.status(200).json({
      status: 'success',
      data: status,
    });
  } catch (error) {
    console.error('❌ Error pada handleGetStreamStatus:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil status streaming',
      error: error.message,
    });
  }
}

/**
 * Controller: Menjalankan scraping watchlist dan menyimpan data ke MySQL (Kompatibilitas lama)
 * POST /api/capture/watchlist
 */
export async function handleCaptureWatchlist(req, res) {
  try {
    const { symbols, limit, headless = true } = req.body || {};
    console.log('📥 Menerima permintaan POST /api/capture/watchlist...');

    const result = await captureWatchlistWorkflow({
      symbols: Array.isArray(symbols) && symbols.length > 0 ? symbols : null,
      limit: limit ? Number(limit) : null,
      headless: headless !== false,
      onStockCaptured: async (stockData) => {
        return await saveStockCapture(stockData);
      },
    });

    return res.status(200).json({
      status: 'success',
      message: 'Proses capture watchlist selesai',
      data: result,
    });
  } catch (error) {
    console.error('❌ Error pada handleCaptureWatchlist:', error.message);
    const isAuthError =
      error.message.includes('cookies.json') ||
      error.message.includes('login') ||
      error.message.includes('Sesi');

    return res.status(isAuthError ? 401 : 500).json({
      status: 'error',
      requiresLogin: isAuthError,
      message: isAuthError
        ? 'Sesi akun Stockbit (cookies.json) diperlukan untuk mengakses halaman Watchlist.'
        : 'Gagal menjalankan capture watchlist',
      error: error.message,
    });
  }
}

/**
 * Controller: Menjalankan capture untuk 1 emiten spesifik
 * POST /api/capture/symbol/:symbol
 */
export async function handleCaptureSymbol(req, res) {
  const { symbol } = req.params;
  const { headless = true } = req.body || {};

  if (!symbol) {
    return res.status(400).json({
      status: 'error',
      message: 'Parameter simbol saham wajib diisi',
    });
  }

  const stockCode = symbol.toUpperCase().trim();

  try {
    console.log(`📥 Menerima permintaan capture emiten tunggal: ${stockCode}`);
    const stockData = await captureSingleStock(stockCode, headless !== false);
    const saved = await saveStockCapture(stockData);

    return res.status(200).json({
      status: 'success',
      message: `Berhasil menangkap dan menyimpan data emiten ${stockCode}`,
      data: {
        ...saved,
        orderbook: stockData.orderbookList,
        broksum: stockData.broksumList,
      },
    });
  } catch (error) {
    console.error(`❌ Error pada handleCaptureSymbol (${stockCode}):`, error);
    return res.status(500).json({
      status: 'error',
      message: `Gagal melakukan capture untuk emiten ${stockCode}`,
      error: error.message,
    });
  }
}

/**
 * Controller: Mengambil daftar riwayat capture sessions
 * GET /api/sessions
 */
export async function handleGetSessions(req, res) {
  try {
    const { limit = 20, offset = 0, stockCode = null } = req.query;

    const sessions = await getSessions({
      limit: Number(limit) || 20,
      offset: Number(offset) || 0,
      stockCode: stockCode ? String(stockCode).trim().toUpperCase() : null,
    });

    return res.status(200).json({
      status: 'success',
      data: sessions,
      count: sessions.length,
    });
  } catch (error) {
    console.error('❌ Error pada handleGetSessions:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil riwayat capture sessions',
      error: error.message,
    });
  }
}

/**
 * Controller: Mengambil detail snapshot 1 session
 * GET /api/sessions/:id
 */
export async function handleGetSessionDetail(req, res) {
  const { id } = req.params;

  try {
    const detail = await getSessionDetail(id);

    if (!detail) {
      return res.status(404).json({
        status: 'error',
        message: `Sesi capture dengan ID ${id} tidak ditemukan`,
      });
    }

    return res.status(200).json({
      status: 'success',
      data: detail,
    });
  } catch (error) {
    console.error(`❌ Error pada handleGetSessionDetail (${id}):`, error);
    return res.status(500).json({
      status: 'error',
      message: `Gagal mengambil detail sesi capture ID ${id}`,
      error: error.message,
    });
  }
}

/**
 * Controller: Menyimpan sesi login Stockbit secara interaktif
 * POST /api/auth/save-session
 */
export async function handleSaveLoginSession(req, res) {
  try {
    console.log('📥 Menerima permintaan POST /api/auth/save-session...');
    const result = await saveLoginSession();

    return res.status(200).json({
      status: 'success',
      ...result,
    });
  } catch (error) {
    console.error('❌ Error pada handleSaveLoginSession:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal menyimpan sesi login Stockbit',
      error: error.message,
    });
  }
}
