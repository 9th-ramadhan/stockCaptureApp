import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// Muat konfigurasi dari backend/.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function runMigration() {
  let connection;
  try {
    // 1. Buat koneksi tanpa menentukan database terlebih dahulu (karena schema.sql akan membuatnya)
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true, // Wajib aktif agar bisa mengeksekusi banyak query sekaligus
    });

    // 2. Baca isi file schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sqlQuery = await fs.readFile(schemaPath, 'utf-8');

    console.log('⏳ Menjalankan migrasi schema.sql ke MySQL...');

    // 3. Eksekusi seluruh query SQL
    await connection.query(sqlQuery);

    console.log('✅ Migrasi berhasil! Database dan seluruh tabel siap digunakan.');
  } catch (error) {
    console.error('❌ Gagal menjalankan migrasi:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigration();