import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Membuat connection pool agar koneksi lebih stabil dan efisien
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'stock_capture_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Fungsi pembantu untuk mengetes koneksi saat startup
export async function testDatabaseConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Koneksi ke database MySQL berhasil!');
    connection.release(); // Kembalikan koneksi ke pool
    return true;
  } catch (error) {
    console.error('❌ Gagal terkoneksi ke database:', error.message);
    return false;
  }
}

export default pool;