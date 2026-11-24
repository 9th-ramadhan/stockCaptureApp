import {
  createTaskLogger,
  checkServerRunning,
  isPastClosingTime,
  executeHybridTask,
} from './runnerHelper.js';

const { writeLog } = createTaskLogger('orderbook_stream.log');

async function run() {
  writeLog('====================================================');
  writeLog('📡 Memulai Runner: Real-Time Orderbook Stream (CDP WS)');
  writeLog('====================================================');

  // Mode Fallback: Jika di luar jam operasional perdagangan bursa
  if (isPastClosingTime()) {
    writeLog('⚠️ PERINGATAN: Di luar jam operasional perdagangan bursa (akhir pekan atau lewat 17:16 WITA).');
    writeLog('🔄 Mengaktifkan MODE FALLBACK: Menjalankan capture snapshot Orderbook terakhir...');

    await executeHybridTask({
      taskTitle: '📸 Menjalankan Fallback Snapshot Orderbook Terakhir',
      logFileName: 'orderbook_stream.log',
      apiEndpoint: '/api/capture/orderbook',
      requestBody: { headless: true },
      inProcessFn: async () => {
        const { captureOrderbookSnapshotOnly } = await import('../services/puppeteerService.js');
        return await captureOrderbookSnapshotOnly([], { headless: true });
      },
    });
    return;
  }

  const PORT = process.env.PORT || 5000;
  const startUrl = `http://localhost:${PORT}/api/stream/orderbook/start`;
  const stopUrl = `http://localhost:${PORT}/api/stream/orderbook/stop`;
  const statusUrl = `http://localhost:${PORT}/api/stream/orderbook/status`;

  const serverRunning = await checkServerRunning(PORT);
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
        }, 60000);

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
