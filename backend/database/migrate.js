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
    // 1. Buat koneksi tanpa menentukan database terlebih dahulu
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true, // Wajib aktif agar bisa mengeksekusi banyak query sekaligus
    });

    console.log('🔄 Memulai proses migrasi database...');

    // 2. Eksekusi file schema.sql (Tabel Dasar)
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sqlSchema = await fs.readFile(schemaPath, 'utf-8');
    console.log('⏳ Menjalankan database/schema.sql...');
    await connection.query(sqlSchema);
    console.log('✅ schema.sql berhasil dieksekusi.');

    // 3. Cari dan eksekusi file migrasi alter bertahap (misal: 02_alter_realtime_support.sql)
    const files = await fs.readdir(__dirname);
    const alterFiles = files.filter((f) => f.endsWith('.sql') && f !== 'schema.sql').sort();

    for (const file of alterFiles) {
      const filePath = path.join(__dirname, file);
      console.log(`⏳ Menjalankan migrasi incremental: ${file}...`);
      const sqlAlter = await fs.readFile(filePath, 'utf-8');
      await connection.query(sqlAlter);
      console.log(`✅ ${file} berhasil dieksekusi.`);
    }

    console.log('🎉 Seluruh migrasi database selesai dan siap digunakan!');
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
