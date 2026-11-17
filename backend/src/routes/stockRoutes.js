import { Router } from 'express';
import {
  handleCaptureWatchlist,
  handleCaptureSymbol,
  handleGetSessions,
  handleGetSessionDetail,
  handleSaveLoginSession,
} from '../controllers/stockController.js';

const router = Router();

// Endpoint Scraping
// 1. POST /api/capture/watchlist - Eksekusi scraping seluruh/sebagian emiten watchlist
router.post('/capture/watchlist', handleCaptureWatchlist);

// 2. POST /api/capture/symbol/:symbol - Eksekusi scraping 1 emiten tertentu
router.post('/capture/symbol/:symbol', handleCaptureSymbol);

// Endpoint Riwayat Database
// 3. GET /api/sessions - Mengambil daftar snapshot capture sessions
router.get('/sessions', handleGetSessions);

// 4. GET /api/sessions/:id - Mengambil detail snapshot orderbook & broker summary suatu sesi
router.get('/sessions/:id', handleGetSessionDetail);

// Endpoint Manajemen Autentikasi / Sesi
// 5. POST /api/auth/save-session - Buka browser untuk login manual dan simpan cookies.json
router.post('/auth/save-session', handleSaveLoginSession);

export default router;
