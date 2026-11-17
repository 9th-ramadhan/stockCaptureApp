import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool, { testDatabaseConnection } from './config/db.js';
import stockRoutes from './routes/stockRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes Utama API
app.use('/api', stockRoutes);

// Endpoint Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Backend Stock Capture (Puppeteer + MySQL) siap digunakan',
    timestamp: new Date().toISOString(),
  });
});

// Endpoint untuk mengetes koneksi database secara manual via browser/Postman
app.get('/api/db-check', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT NOW() AS waktu_server, DATABASE() AS nama_db');
    res.json({
      status: 'connected',
      data: rows[0],
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
});

// Jalankan server HTTP
app.listen(PORT, async () => {
  console.log(`🚀 Server backend berjalan di http://localhost:${PORT}`);
  // Otomatis tes koneksi database saat server menyala
  await testDatabaseConnection();
});
