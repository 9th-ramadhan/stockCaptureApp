import pool from '../config/db.js';

/**
 * Menyimpan data snapshot capture emiten (Orderbook dan/atau Broker Summary)
 * secara transaksional ke MySQL menggunakan bulk insert.
 *
 * Tabel yang dipengaruhi:
 * 1. capture_sessions
 * 2. orderbook_entries (bulk insert)
 * 3. broker_summaries (bulk insert)
 *
 * @param {Object} captureData
 * @param {string} captureData.stockCode - Kode saham (misal: 'BBCA')
 * @param {number|null} captureData.lastPrice - Harga terakhir
 * @param {number|null} captureData.priceChangePct - Persentase perubahan harga
 * @param {string} [captureData.tradeDate] - Tanggal transaksi (YYYY-MM-DD)
 * @param {Date|string} [captureData.capturedAt] - Timestamp pengambilan data
 * @param {Array<Object>} [captureData.orderbookList] - Array baris antrean orderbook
 * @param {Array<Object>} [captureData.broksumList] - Array baris data broker summary
 * @returns {Promise<Object>} Informasi hasil penyimpanan transaksi
 */
export async function saveStockCapture({
  stockCode,
  lastPrice = null,
  priceChangePct = null,
  tradeDate = null,
  capturedAt = null,
  orderbookList = [],
  broksumList = [],
}) {
  const code = stockCode.toUpperCase().trim();
  const connection = await pool.getConnection();

  // Tentukan format waktu capture MySQL (YYYY-MM-DD HH:mm:ss)
  const now = capturedAt ? new Date(capturedAt) : new Date();
  const formattedCapturedAt = now.toISOString().slice(0, 19).replace('T', ' ');

  // Tentukan trade date default jika tidak ada (YYYY-MM-DD)
  const effectiveTradeDate = tradeDate || formattedCapturedAt.slice(0, 10);

  // Tentukan capture_type
  let captureType = 'BOTH';
  const hasOb = Array.isArray(orderbookList) && orderbookList.length > 0;
  const hasBs = Array.isArray(broksumList) && broksumList.length > 0;

  if (hasOb && !hasBs) {
    captureType = 'ORDERBOOK';
  } else if (!hasOb && hasBs) {
    captureType = 'BROKSUM';
  }

  try {
    // Mulai transaksi database
    await connection.beginTransaction();

    // 1. Simpan ke tabel induk: capture_sessions
    const insertSessionSql = `
      INSERT INTO capture_sessions (
        stock_code,
        capture_type,
        last_price,
        price_change_pct,
        captured_at
      ) VALUES (?, ?, ?, ?, ?)
    `;

    const [sessionResult] = await connection.query(insertSessionSql, [
      code,
      captureType,
      lastPrice !== null && !isNaN(lastPrice) ? Math.round(Number(lastPrice)) : null,
      priceChangePct !== null && !isNaN(priceChangePct) ? Number(priceChangePct) : null,
      formattedCapturedAt,
    ]);

    const sessionId = sessionResult.insertId;

    // 2. Bulk insert ke tabel orderbook_entries jika data tersedia
    let insertedOrderbookCount = 0;
    if (hasOb) {
      const obSql = `
        INSERT INTO orderbook_entries (
          session_id,
          stock_code,
          level_order,
          bid_freq,
          bid_lot,
          bid_price,
          offer_price,
          offer_lot,
          offer_freq,
          captured_at
        ) VALUES ?
      `;

      const obValues = orderbookList.map((entry, index) => [
        sessionId,
        code,
        entry.level_order || (index + 1),
        Number(entry.bidFreq ?? entry.bid_freq ?? 0) || 0,
        Number(entry.bidLot ?? entry.bid_lot ?? 0) || 0,
        entry.bidPrice !== null && entry.bidPrice !== undefined && !isNaN(entry.bidPrice) && Number(entry.bidPrice) > 0
          ? Math.round(Number(entry.bidPrice))
          : null,
        entry.offerPrice !== null && entry.offerPrice !== undefined && !isNaN(entry.offerPrice) && Number(entry.offerPrice) > 0
          ? Math.round(Number(entry.offerPrice))
          : null,
        Number(entry.offerLot ?? entry.offer_lot ?? 0) || 0,
        Number(entry.offerFreq ?? entry.offer_freq ?? 0) || 0,
        formattedCapturedAt,
      ]);

      await connection.query(obSql, [obValues]);
      insertedOrderbookCount = obValues.length;
    }

    // 3. Bulk insert ke tabel broker_summaries jika data tersedia
    // Perhatikan: net_lot dan net_value adalah kolom VIRTUAL/STORED sehingga tidak dimasukkan ke dalam INSERT
    let insertedBroksumCount = 0;
    if (hasBs) {
      const bsSql = `
        INSERT INTO broker_summaries (
          session_id,
          stock_code,
          trade_date,
          broker_code,
          broker_category,
          buy_lot,
          buy_value,
          avg_buy_price,
          sell_lot,
          sell_value,
          avg_sell_price,
          captured_at
        ) VALUES ?
      `;

      const validCategories = ['LOCAL', 'FOREIGN', 'GOVERNMENT', 'UNKNOWN'];

      const bsValues = broksumList.map((item) => {
        const rawCategory = (item.brokerCategory || item.category || 'UNKNOWN').toUpperCase();
        const category = validCategories.includes(rawCategory) ? rawCategory : 'UNKNOWN';
        const itemTradeDate = item.tradeDate || item.trade_date || effectiveTradeDate;

        return [
          sessionId,
          code,
          itemTradeDate,
          (item.brokerCode || item.broker_code || '??').substring(0, 5).toUpperCase(),
          category,
          Number(item.buyLot ?? item.buy_lot ?? 0) || 0,
          Number(item.buyValue ?? item.buy_value ?? 0) || 0,
          Number(item.avgBuyPrice ?? item.avg_buy_price ?? 0) || 0,
          Number(item.sellLot ?? item.sell_lot ?? 0) || 0,
          Number(item.sellValue ?? item.sell_value ?? 0) || 0,
          Number(item.avgSellPrice ?? item.avg_sell_price ?? 0) || 0,
          formattedCapturedAt,
        ];
      });

      await connection.query(bsSql, [bsValues]);
      insertedBroksumCount = bsValues.length;
    }

    // Commit seluruh transaksi jika tidak ada error
    await connection.commit();

    return {
      success: true,
      sessionId,
      stockCode: code,
      captureType,
      lastPrice,
      priceChangePct,
      tradeDate: effectiveTradeDate,
      capturedAt: formattedCapturedAt,
      orderbookCount: insertedOrderbookCount,
      broksumCount: insertedBroksumCount,
    };
  } catch (error) {
    // Batalkan seluruh perubahan jika terjadi error
    await connection.rollback();
    console.error(`❌ Gagal menyimpan transaksi capture untuk ${code}:`, error.message);
    throw error;
  } finally {
    // Selalu lepaskan koneksi kembali ke pool
    connection.release();
  }
}

/**
 * Mengambil daftar riwayat capture sessions terbaru
 * @param {Object} options
 * @param {number} [options.limit=20] - Jumlah baris maksimal
 * @param {number} [options.offset=0] - Offset pagination
 * @param {string} [options.stockCode] - Filter kode emiten tertentu
 */
export async function getSessions({ limit = 20, offset = 0, stockCode = null } = {}) {
  const params = [];
  let whereClause = '';

  if (stockCode) {
    whereClause = 'WHERE s.stock_code = ?';
    params.push(stockCode.toUpperCase().trim());
  }

  params.push(Number(limit), Number(offset));

  const sql = `
    SELECT 
      s.id,
      s.stock_code,
      s.capture_type,
      s.last_price,
      s.price_change_pct,
      s.captured_at,
      (SELECT COUNT(*) FROM orderbook_entries ob WHERE ob.session_id = s.id) AS orderbook_count,
      (SELECT COUNT(*) FROM broker_summaries bs WHERE bs.session_id = s.id) AS broksum_count
    FROM capture_sessions s
    ${whereClause}
    ORDER BY s.captured_at DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * Mengambil detail lengkap suatu session (termasuk orderbook dan broker summary)
 * @param {number|string} sessionId
 */
export async function getSessionDetail(sessionId) {
  const parsedId = Number(sessionId);

  // Ambil record session induk
  const [sessions] = await pool.query('SELECT * FROM capture_sessions WHERE id = ?', [parsedId]);
  if (!sessions || sessions.length === 0) {
    return null;
  }

  const session = sessions[0];

  // Ambil orderbook entries terurut level_order ASC
  const [orderbookEntries] = await pool.query(
    'SELECT * FROM orderbook_entries WHERE session_id = ? ORDER BY level_order ASC',
    [parsedId]
  );

  // Ambil broker summaries terurut net_value DESC (akumulasi terbesar ke distribusi)
  const [brokerSummaries] = await pool.query(
    'SELECT * FROM broker_summaries WHERE session_id = ? ORDER BY net_value DESC, buy_value DESC',
    [parsedId]
  );

  return {
    session,
    orderbookEntries,
    brokerSummaries,
  };
}
