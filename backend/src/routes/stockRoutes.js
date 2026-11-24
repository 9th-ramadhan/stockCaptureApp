import { Router } from 'express';
import {
  handleCaptureBroksum,
  handleCaptureOrderbook,
  handleStartOrderbookStream,
  handleStopOrderbookStream,
  handleGetStreamStatus,
  handleCaptureWatchlist,
  handleCaptureSymbol,
  handleGetSessions,
  handleGetSessionDetail,
  handleSaveLoginSession,
} from '../controllers/stockController.js';

const router = Router();

// ============================================================================
// 1. ENDPOINTS STREAMING ORDERBOOK REAL-TIME (MODE 2 - CDP WEBSOCKET)
// ============================================================================
// Memulai streaming real-time Orderbook dengan sampling 30 detik
router.post('/stream/orderbook/start', handleStartOrderbookStream);

// Menghentikan streaming real-time Orderbook secara aman
router.post('/stream/orderbook/stop', handleStopOrderbookStream);

// Mengambil status aktivitas streaming real-time Orderbook
router.get('/stream/orderbook/status', handleGetStreamStatus);

// Eksekusi snapshot Orderbook terakhir (Fallback di luar jam bursa / On-Demand)
router.post('/stream/orderbook/snapshot', handleCaptureOrderbook);

// ============================================================================
// 2. ENDPOINTS CAPTURE KHUSUS ORDERBOOK & BROKER SUMMARY (BATCH / SNAPSHOT)
// ============================================================================
// Eksekusi scraping snapshot Orderbook terakhir
router.post('/capture/orderbook', handleCaptureOrderbook);

// Eksekusi scraping khusus Broker Summary (melewati parsing Orderbook)
router.post('/capture/broksum', handleCaptureBroksum);

// ============================================================================
// 3. ENDPOINTS SCRAPING EMITEN TUNGGAL & WATCHLIST GABUNGAN (LEGACY)
// ============================================================================
// Eksekusi scraping seluruh/sebagian emiten watchlist (Orderbook + Broksum)
router.post('/capture/watchlist', handleCaptureWatchlist);

// Eksekusi scraping 1 emiten tertentu
router.post('/capture/symbol/:symbol', handleCaptureSymbol);

// ============================================================================
// 4. ENDPOINTS RIWAYAT DATABASE & DETAIL SESI
// ============================================================================
// Mengambil daftar snapshot capture sessions
router.get('/sessions', handleGetSessions);

// Mengambil detail snapshot orderbook & broker summary suatu sesi
router.get('/sessions/:id', handleGetSessionDetail);

// ============================================================================
// 5. ENDPOINT MANAJEMEN AUTENTIKASI / SESI
// ============================================================================
// Buka browser untuk login manual dan simpan/perbarui cookies.json secara instan
router.post('/auth/save-session', handleSaveLoginSession);
router.get('/auth/save-session', handleSaveLoginSession);
router.post('/auth/login', handleSaveLoginSession);

export default router;
