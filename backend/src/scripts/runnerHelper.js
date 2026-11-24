import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Membuat logger khusus task runner dengan format waktu WITA (Asia/Makassar)
 * @param {string} logFileName - Nama file log (misal: 'daily_broksum.log')
 * @returns {{ writeLog: (message: string) => void, logFilePath: string }}
 */
export function createTaskLogger(logFileName) {
  const logDir = path.resolve(__dirname, '../../logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const logFilePath = path.join(logDir, logFileName);

  function writeLog(message) {
    const line = `[${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })} WITA] ${message}`;
    console.log(line);
    try {
      fs.appendFileSync(logFilePath, line + '\n', 'utf-8');
    } catch {
      // Abaikan jika stream di-lock oleh redirect shell (cmd.exe >>)
    }
  }

  return { writeLog, logFilePath };
}

/**
 * Memeriksa apakah server backend Express sedang berjalan
 * @param {number|string} [port]
 * @returns {Promise<boolean>}
 */
export async function checkServerRunning(port = process.env.PORT || 5000) {
  const healthUrl = `http://localhost:${port}/api/health`;
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Pengecekan apakah saat ini di luar jam operasional bursa BEI (< 09:55 atau >= 17:16 WITA, atau akhir pekan)
 * @param {Date} [date=new Date()]
 * @returns {boolean}
 */
export function isPastClosingTime(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Makassar',
    hour12: false,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type) => parts.find((p) => p.type === type)?.value;

  const weekday = getPart('weekday');
  const hour = parseInt(getPart('hour') || '0', 10);
  const minute = parseInt(getPart('minute') || '0', 10);
  const timeInMinutes = hour * 60 + minute;

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const isOutsideTradingHours = timeInMinutes < 9 * 60 + 55 || timeInMinutes >= 17 * 60 + 16;

  return isWeekend || isOutsideTradingHours;
}

/**
 * Template eksekutor task runner hybrid:
 * Mencoba memanggil endpoint REST API terlebih dahulu jika Express menyala,
 * atau beralih otomatis ke eksekusi mandiri (in-process) jika Express offline.
 *
 * @param {Object} options
 * @param {string} options.taskTitle - Judul log header
 * @param {string} options.logFileName - Nama file log output
 * @param {string} options.apiEndpoint - URL endpoint (misal: '/api/capture/broksum')
 * @param {Object} [options.requestBody={ headless: true }] - Payload POST
 * @param {Function} options.inProcessFn - Fungsi eksekusi mandiri jika offline
 */
export async function executeHybridTask({
  taskTitle,
  logFileName,
  apiEndpoint,
  requestBody = { headless: true },
  inProcessFn,
}) {
  const { writeLog } = createTaskLogger(logFileName);

  writeLog('====================================================');
  writeLog(taskTitle);
  writeLog('====================================================');

  const PORT = process.env.PORT || 5000;
  const apiUrl = `http://localhost:${PORT}${apiEndpoint}`;
  const isRunning = await checkServerRunning(PORT);

  let executedViaApi = false;
  if (isRunning) {
    writeLog(`🌐 Server Express terdeteksi aktif di port ${PORT}. Memanggil endpoint API: ${apiUrl}...`);
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (res.ok) {
        writeLog(
          `✅ Eksekusi API Berhasil! Total: ${data.data?.totalProcessed || 0}, Sukses: ${data.data?.successCount || 0}, Gagal: ${data.data?.failedCount || 0}`
        );
        executedViaApi = true;
        process.exit(0);
      } else {
        writeLog(
          `⚠️ API mengembalikan respon error (${data.message || JSON.stringify(data)}). Beralih ke eksekusi mandiri...`
        );
      }
    } catch (err) {
      writeLog(`⚠️ Gagal memanggil endpoint API (${err.message}). Beralih ke eksekusi mandiri...`);
    }
  }

  if (!executedViaApi) {
    writeLog(`ℹ️ Menjalankan workflow secara mandiri (in-process)...`);
    try {
      const pool = (await import('../config/db.js')).default;
      const result = await inProcessFn();
      if (result) {
        writeLog(
          `✅ Eksekusi Mandiri Selesai! Total: ${result.totalProcessed ?? '-'}, Sukses: ${result.successCount ?? '-'}, Gagal: ${result.failedCount ?? '-'} (${result.durationSeconds ?? '-'}s)`
        );
      } else {
        writeLog(`✅ Eksekusi Mandiri Selesai!`);
      }
      await pool.end();
      process.exit(0);
    } catch (err) {
      writeLog(`❌ Gagal mengeksekusi secara mandiri: ${err.message}`);
      process.exit(1);
    }
  }
}
