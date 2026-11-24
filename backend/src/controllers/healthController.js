import pool from '../config/db.js';

/**
 * Controller: Pengecekan status kesehatan server backend
 * GET /api/health
 */
export function handleHealthCheck(req, res) {
  return res.status(200).json({
    status: 'OK',
    message: 'Backend Stock Capture (Puppeteer + MySQL) siap digunakan',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Controller: Pengecekan koneksi aktif ke database MySQL
 * GET /api/db-check
 */
export async function handleDbCheck(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT NOW() AS waktu_server, DATABASE() AS nama_db');
    return res.status(200).json({
      status: 'connected',
      data: rows[0],
    });
  } catch (error) {
    error.customMessage = 'Gagal terhubung ke database MySQL';
    next(error);
  }
}
