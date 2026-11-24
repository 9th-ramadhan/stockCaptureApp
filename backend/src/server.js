import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testDatabaseConnection } from './config/db.js';
import stockRoutes from './routes/stockRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware Global
app.use(cors());
app.use(express.json());

// Routes Utama API
app.use('/api', healthRoutes);
app.use('/api', stockRoutes);

// Error Handling & 404 Handler Terpusat (Mirip Exception Handler Laravel)
app.use(notFoundHandler);
app.use(errorHandler);

import { fileURLToPath } from 'url';

// Jalankan server HTTP hanya jika file ini dijalankan langsung (bukan saat di-import oleh test suite)
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();

if (isMainModule) {
  app.listen(PORT, async () => {
    console.log(`🚀 Server backend berjalan di http://localhost:${PORT}`);
    // Otomatis tes koneksi database saat server menyala
    await testDatabaseConnection();
  });
}

export default app;
