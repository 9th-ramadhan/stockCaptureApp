import {
  captureWatchlistWorkflow,
  captureSingleStock,
  saveLoginSession,
} from '../services/puppeteerService.js';
import {
  saveStockCapture,
  getSessions,
  getSessionDetail,
} from '../models/stockModel.js';

/**
 * Controller: Menjalankan scraping watchlist dan menyimpan data ke MySQL
 * POST /api/capture/watchlist
 * Body (opsional):
 * {
 *   "symbols": ["BBCA", "BBRI"], // Jika diisi, hanya scrape emiten ini
 *   "limit": 5,                   // Batasi jumlah emiten
 *   "headless": true              // Mode headless (default: true)
 * }
 */
export async function handleCaptureWatchlist(req, res) {
  try {
    const { symbols, limit, headless = true } = req.body || {};

    console.log('📥 Menerima permintaan POST /api/capture/watchlist...');

    // Eksekusi workflow capture dengan callback penyimpanan ke MySQL
    const result = await captureWatchlistWorkflow({
      symbols: Array.isArray(symbols) && symbols.length > 0 ? symbols : null,
      limit: limit ? Number(limit) : null,
      headless: headless !== false,
      onStockCaptured: async (stockData) => {
        // Simpan setiap emiten ke MySQL secara transaksional
        return await saveStockCapture(stockData);
      },
    });

    return res.status(200).json({
      status: 'success',
      message: 'Proses capture watchlist selesai',
      data: result,
    });
  } catch (error) {
    console.error('❌ Error pada handleCaptureWatchlist:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal menjalankan capture watchlist',
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

    // Scrape data emiten
    const stockData = await captureSingleStock(stockCode, headless !== false);

    // Simpan ke MySQL secara transaksional
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
 * Query params: ?limit=20&offset=0&stockCode=BBCA
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
 * Controller: Mengambil detail snapshot 1 session (termasuk orderbook dan broksum)
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
