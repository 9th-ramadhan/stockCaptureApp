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
  } catch {
    // Abaikan jika file stream sedang di-lock oleh redirect shell (cmd.exe >>)
  }
}

/**
 * Pengecekan apakah saat ini bursa sudah lewat jam penutupan (17:16 WITA)
 */
function isPastClosingTime() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Makassar',
    hour12: false,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
  });
  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find((p) => p.type === type)?.value;

  const weekday = getPart('weekday');
  const hour = parseInt(getPart('hour') || '0', 10);
  const minute = parseInt(getPart('minute') || '0', 10);
  const timeInMinutes = hour * 60 + minute;

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const isPastClosing = timeInMinutes >= 17 * 60 + 16; // 17:16 WITA

  return isWeekend || isPastClosing;
}

async function run() {
  writeLog('====================================================');
  writeLog('📡 Memulai Runner: Real-Time Orderbook Stream (CDP WS)');
  writeLog('====================================================');

  if (isPastClosingTime()) {
    writeLog('⚠️ PERINGATAN: Di luar jam operasional perdagangan bursa (akhir pekan atau lewat 17:16 WITA).');
    writeLog('🔄 Mengaktifkan MODE FALLBACK: Menjalankan capture snapshot Orderbook terakhir...');

    const PORT = process.env.PORT || 5000;
    const snapshotUrl = `http://localhost:${PORT}/api/capture/orderbook`;
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
      writeLog(`🌐 Server Express terdeteksi aktif di port ${PORT}. Memanggil endpoint fallback: ${snapshotUrl}...`);
      try {
        const res = await fetch(snapshotUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ headless: true }),
        });
        const data = await res.json();
        if (res.ok) {
          writeLog(
            `✅ Fallback Snapshot via API Berhasil! Total: ${data.data?.totalProcessed || 0}, Sukses: ${data.data?.successCount || 0}, Gagal: ${data.data?.failedCount || 0}`
          );
          executedViaApi = true;
          process.exit(0);
        } else {
          writeLog(`⚠️ API snapshot mengembalikan respon error (${data.message || JSON.stringify(data)}). Beralih ke mandiri...`);
        }
      } catch (err) {
        writeLog(`⚠️ Gagal memanggil endpoint API snapshot (${err.message}). Beralih ke mandiri...`);
      }
    }

    if (!executedViaApi) {
      writeLog(`ℹ️ Menjalankan capture snapshot Orderbook terakhir secara mandiri (in-process)...`);
      try {
        const { captureOrderbookSnapshotOnly } = await import('../services/puppeteerService.js');
        const pool = (await import('../config/db.js')).default;

        const result = await captureOrderbookSnapshotOnly([], { headless: true });

        writeLog(
          `✅ Fallback Snapshot Mandiri Selesai! Total: ${result.totalProcessed}, Sukses: ${result.successCount}, Gagal: ${result.failedCount} (${result.durationSeconds}s)`
        );
        await pool.end();
        process.exit(0);
      } catch (err) {
        writeLog(`❌ Gagal mengeksekusi fallback snapshot mandiri: ${err.message}`);
        process.exit(1);
      }
    }
    return;
  }

  const PORT = process.env.PORT || 5000;
  const startUrl = `http://localhost:${PORT}/api/stream/orderbook/start`;
  const stopUrl = `http://localhost:${PORT}/api/stream/orderbook/stop`;
  const statusUrl = `http://localhost:${PORT}/api/stream/orderbook/status`;
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
    writeLog(`🌐 Server Express terdeteksi aktif di port ${PORT}. Memanggil endpoint: ${startUrl}...`);
    try {
      const res = await fetch(startUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalSeconds: 30, headless: true }),
      });
      const data = await res.json();
      if (res.ok) {
        writeLog(`✅ Streaming aktif via API: ${JSON.stringify(data)}`);
        executedViaApi = true;

        // Monitor loop hingga jam tutup bursa tercapai
        const checkInterval = setInterval(async () => {
          if (isPastClosingTime()) {
            writeLog('⏰ Waktu penutupan bursa tercapai (17:16 WITA). Memanggil stop streaming...');
            clearInterval(checkInterval);
            try {
              await fetch(stopUrl, { method: 'POST' });
              writeLog('✅ Layanan streaming berhasil dihentikan via API.');
            } catch (stopErr) {
              writeLog(`⚠️ Gagal memanggil stop API: ${stopErr.message}`);
            }
            process.exit(0);
          }

          // Cek status streaming secara berkala
          try {
            const stRes = await fetch(statusUrl);
            const stData = await stRes.json();
            if (stData.data) {
              writeLog(
                `📊 [Status Stream] Aktif: ${stData.data.isRunning}, Sesi Tersimpan: ${stData.data.totalSessionsSaved}, Flush Terakhir: ${stData.data.lastFlushTime || '-'}`
              );
            }
          } catch {}
        }, 60000); // Cek setiap 1 menit

        // Graceful shutdown listener
        process.on('SIGINT', async () => {
          writeLog('🛑 Menerima sinyal interupsi. Menghentikan stream...');
          clearInterval(checkInterval);
          try {
            await fetch(stopUrl, { method: 'POST' });
          } catch {}
          process.exit(0);
        });
      } else {
        writeLog(`⚠️ API mengembalikan respon error (${data.message || JSON.stringify(data)}). Beralih ke mandiri...`);
      }
    } catch (err) {
      writeLog(`⚠️ Gagal memanggil start streaming via API (${err.message}). Beralih ke mandiri...`);
    }
  }

  if (!executedViaApi) {
    writeLog(`ℹ️ Menjalankan streaming Puppeteer CDP secara mandiri (in-process)...`);
    try {
      const { startRealtimeOrderbookStream, stopRealtimeOrderbookStream } = await import(
        '../services/puppeteerService.js'
      );
      const pool = (await import('../config/db.js')).default;

      await startRealtimeOrderbookStream([], { intervalMs: 30000, headless: true });
      writeLog('✅ Real-Time Orderbook Stream mandiri berhasil diluncurkan.');

      const checkInterval = setInterval(async () => {
        if (isPastClosingTime()) {
          writeLog('⏰ Waktu penutupan bursa tercapai (17:16 WITA). Menghentikan streaming mandiri...');
          clearInterval(checkInterval);
          await stopRealtimeOrderbookStream('MARKET_CLOSING_TIME');
          await pool.end();
          writeLog('🔒 Pool database ditutup. Selesai.');
          process.exit(0);
        }
      }, 60000);

      process.on('SIGINT', async () => {
        writeLog('🛑 Menerima sinyal interupsi...');
        clearInterval(checkInterval);
        await stopRealtimeOrderbookStream('SIGINT');
        await pool.end();
        process.exit(0);
      });
    } catch (err) {
      writeLog(`❌ Gagal menjalankan streaming mandiri: ${err.message}`);
      process.exit(1);
    }
  }
}

run();
