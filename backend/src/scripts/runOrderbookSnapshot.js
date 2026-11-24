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
const logFile = path.join(logDir, 'orderbook_stream.log');

function writeLog(message) {
  const line = `[${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })} WITA] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(logFile, line + '\n', 'utf-8');
  } catch {}
}

async function run() {
  writeLog('====================================================');
  writeLog('📸 Memulai Capture Snapshot Orderbook Terakhir');
  writeLog('====================================================');

  const PORT = process.env.PORT || 5000;
  const apiUrl = `http://localhost:${PORT}/api/capture/orderbook`;
  const healthUrl = `http://localhost:${PORT}/api/health`;

  let serverRunning = false;
  try {
    const healthRes = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
    if (healthRes.ok) serverRunning = true;
  } catch {
    serverRunning = false;
  }

  let executedViaApi = false;
  if (serverRunning) {
    writeLog(`🌐 Server Express terdeteksi aktif di port ${PORT}. Memanggil endpoint API: ${apiUrl}...`);
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: true }),
      });
      const data = await res.json();
      if (res.ok) {
        writeLog(
          `✅ Eksekusi API Snapshot Berhasil! Total: ${data.data?.totalProcessed || 0}, Sukses: ${data.data?.successCount || 0}, Gagal: ${data.data?.failedCount || 0}`
        );
        executedViaApi = true;
        process.exit(0);
      } else {
        writeLog(`⚠️ API mengembalikan respon error (${data.message || JSON.stringify(data)}). Beralih ke mandiri...`);
      }
    } catch (err) {
      writeLog(`⚠️ Gagal memanggil endpoint API (${err.message}). Beralih ke mandiri...`);
    }
  }

  if (!executedViaApi) {
    writeLog(`ℹ️ Menjalankan capture snapshot Orderbook secara mandiri (in-process)...`);
    try {
      const { captureOrderbookSnapshotOnly } = await import('../services/puppeteerService.js');
      const pool = (await import('../config/db.js')).default;

      const result = await captureOrderbookSnapshotOnly([], { headless: true });

      writeLog(
        `✅ Eksekusi Mandiri Selesai! Total: ${result.totalProcessed}, Sukses: ${result.successCount}, Gagal: ${result.failedCount} (${result.durationSeconds}s)`
      );
      await pool.end();
      process.exit(0);
    } catch (err) {
      writeLog(`❌ Gagal mengeksekusi snapshot Orderbook mandiri: ${err.message}`);
      process.exit(1);
    }
  }
}

run();
