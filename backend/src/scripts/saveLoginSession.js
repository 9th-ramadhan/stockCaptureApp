import { saveLoginSession } from '../services/puppeteerService.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function run() {
  console.log('====================================================');
  console.log('🔐 Script Penyimpanan Sesi Login Stockbit');
  console.log('====================================================');

  const cookiesPath = path.resolve(__dirname, '../../cookies.json');

  try {
    const result = await saveLoginSession(cookiesPath);
    console.log('✅ Berhasil!', result);
    process.exit(0);
  } catch (err) {
    console.error('❌ Gagal menyimpan sesi login:', err.message);
    process.exit(1);
  }
}

run();
