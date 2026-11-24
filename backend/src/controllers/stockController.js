import {
  captureWatchlistWorkflow,
  captureSingleStock,
  promptManualLoginAndRefreshCookies,
  captureBrokerSummaryOnly,
  captureOrderbookSnapshotOnly,
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
 * Controller: Menjalankan capture snapshot Orderbook terakhir (Fallback di luar jam bursa / On-Demand)
 * POST /api/capture/orderbook
 */
export async function handleCaptureOrderbook(req, res, next) {
  try {
    const { symbols, limit, headless = true } = req.body || {};
    console.log('📥 Menerima permintaan POST /api/capture/orderbook (Snapshot)...');

    const result = await captureOrderbookSnapshotOnly(
      Array.isArray(symbols) && symbols.length > 0 ? symbols : [],
      {
        limit: limit ? Number(limit) : null,
        headless: headless !== false,
      }
    );

    return res.status(200).json({
      status: 'success',
      message: 'Proses capture snapshot Orderbook selesai',
      data: result,
    });
  } catch (error) {
    error.customMessage = 'Gagal menjalankan capture snapshot Orderbook';
    next(error);
  }
}

/**
 * Controller: Menjalankan capture khusus Broker Summary (Mode 1 Batch Harian)
 * POST /api/capture/broksum
 */
export async function handleCaptureBroksum(req, res, next) {
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
    error.customMessage = 'Gagal menjalankan capture Broker Summary';
    next(error);
  }
}

/**
 * Controller: Memulai layanan streaming real-time Orderbook via CDP WebSocket (Mode 2)
 * POST /api/stream/orderbook/start
 */
export async function handleStartOrderbookStream(req, res, next) {
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
    error.customMessage = 'Gagal memulai layanan streaming Orderbook';
    next(error);
  }
}

/**
 * Controller: Menghentikan layanan streaming real-time Orderbook secara aman
 * POST /api/stream/orderbook/stop
 */
export async function handleStopOrderbookStream(req, res, next) {
  try {
    console.log('📥 Menerima permintaan POST /api/stream/orderbook/stop...');
    const result = await stopRealtimeOrderbookStream('API_REQUEST');

    return res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    error.customMessage = 'Gagal menghentikan layanan streaming Orderbook';
    next(error);
  }
}

/**
 * Controller: Mengambil status aktivitas streaming real-time Orderbook
 * GET /api/stream/orderbook/status
 */
export function handleGetStreamStatus(req, res, next) {
  try {
    const status = getRealtimeOrderbookStatus();
    return res.status(200).json({
      status: 'success',
      data: status,
    });
  } catch (error) {
    error.customMessage = 'Gagal mengambil status streaming';
    next(error);
  }
}

/**
 * Controller: Menjalankan scraping watchlist dan menyimpan data ke MySQL (Kompatibilitas lama)
 * POST /api/capture/watchlist
 */
export async function handleCaptureWatchlist(req, res, next) {
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
    error.customMessage = 'Gagal menjalankan capture watchlist';
    next(error);
  }
}

/**
 * Controller: Menjalankan capture untuk 1 emiten spesifik
 * POST /api/capture/symbol/:symbol
 */
export async function handleCaptureSymbol(req, res, next) {
  try {
    const { symbol } = req.params;
    const { headless = true } = req.body || {};

    if (!symbol) {
      return res.status(400).json({
        status: 'error',
        message: 'Parameter simbol saham wajib diisi',
      });
    }

    const stockCode = symbol.toUpperCase().trim();
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
    error.customMessage = `Gagal melakukan capture untuk emiten ${req.params?.symbol || ''}`;
    next(error);
  }
}

/**
 * Controller: Mengambil daftar riwayat capture sessions
 * GET /api/sessions
 */
export async function handleGetSessions(req, res, next) {
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
    error.customMessage = 'Gagal mengambil riwayat capture sessions';
    next(error);
  }
}

/**
 * Controller: Mengambil detail snapshot 1 session
 * GET /api/sessions/:id
 */
export async function handleGetSessionDetail(req, res, next) {
  try {
    const { id } = req.params;
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
    error.customMessage = `Gagal mengambil detail sesi capture ID ${req.params?.id || ''}`;
    next(error);
  }
}

/**
 * Controller: Menyimpan sesi login Stockbit secara interaktif
 * POST /api/auth/save-session
 */
export async function handleSaveLoginSession(req, res, next) {
  try {
    console.log('📥 Menerima permintaan POST /api/auth/save-session...');
    const result = await promptManualLoginAndRefreshCookies();

    return res.status(200).json({
      status: 'success',
      message: 'Sesi login berhasil diperbarui dan disimpan ke cookies.json',
      ...result,
    });
  } catch (error) {
    error.customMessage = 'Gagal melakukan login manual atau waktu tunggu habis';
    next(error);
  }
}
