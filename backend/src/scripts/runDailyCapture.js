import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const logDir = path.resolve(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, 'daily_capture.log');

function writeLog(message) {
  const line = `[${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })} WITA] ${message}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n', 'utf-8');
}

async function run() {
  writeLog('====================================================');
  writeLog('⏰ Memulai Jadwal Harian: Capture Watchlist Stockbit');
  writeLog('====================================================');

  const PORT = process.env.PORT || 5000;
  const apiUrl = `http://localhost:${PORT}/api/capture/watchlist`;
  const healthUrl = `http://localhost:${PORT}/api/health`;

  let serverRunning = false;
  try {
    const healthRes = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
    if (healthRes.ok) {
      serverRunning = true;
    }
  } catch {
    serverRunning = false;
  }

  if (serverRunning) {
    writeLog(`🌐 Server Express terdeteksi aktif di port ${PORT}. Memanggil API: ${apiUrl}...`);
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: true }),
      });
      const data = await res.json();
      if (res.ok) {
        writeLog(`✅ Eksekusi API Berhasil! Total diproses: ${data.data?.totalProcessed || 0}, Sukses: ${data.data?.successCount || 0}`);
        process.exit(0);
      } else {
        writeLog(`⚠️ API mengembalikan error: ${data.message || JSON.stringify(data)}`);
        process.exit(1);
      }
    } catch (err) {
      writeLog(`❌ Gagal memanggil endpoint API: ${err.message}`);
      process.exit(1);
    }
  } else {
    writeLog(`ℹ️ Server Express sedang offline. Menjalankan workflow Puppeteer secara mandiri...`);
    try {
      const { captureWatchlistWorkflow } = await import('../services/puppeteerService.js');
      const { saveStockCapture } = await import('../models/stockModel.js');
      const pool = (await import('../config/db.js')).default;

      const result = await captureWatchlistWorkflow({
        headless: true,
        onStockCaptured: async (stockData) => {
          return await saveStockCapture(stockData);
        },
      });

      writeLog(`✅ Eksekusi Mandiri Selesai! Total: ${result.totalProcessed}, Sukses: ${result.successCount}, Gagal: ${result.failedCount}`);
      await pool.end();
      process.exit(0);
    } catch (err) {
      writeLog(`❌ Gagal mengeksekusi workflow mandiri: ${err.message}`);
      process.exit(1);
    }
  }
}

run();
