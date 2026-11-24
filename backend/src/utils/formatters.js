/**
 * Utilitas pemformatan data angka, tanggal, dan timer helper
 */

/**
 * Jeda acak (jitter) dalam milidetik untuk mencegah rate-limit
 * @param {number} min - Batas bawah milidetik (default: 1500ms)
 * @param {number} max - Batas atas milidetik (default: 3000ms)
 */
export function randomDelay(min = 1500, max = 3000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalisasi angka singkatan Stockbit (B = Miliar, M = Juta, K = Ribu, '-' = 0)
 * Contoh:
 *   '12.5B'  -> 12500000000
 *   '350M'   -> 350000000
 *   '45.2K'  -> 45200
 *   '-'      -> 0
 *   '1,450'  -> 1450
 *
 * @param {string|number} rawValue
 * @returns {number}
 */
export function parseAbbreviatedNumber(rawValue) {
  if (rawValue === null || rawValue === undefined) return 0;
  if (typeof rawValue === 'number') return isNaN(rawValue) ? 0 : rawValue;

  const str = String(rawValue).trim();
  if (!str || str === '-' || str.toLowerCase() === 'n/a') return 0;

  const isNegative = str.startsWith('-') || (str.startsWith('(') && str.endsWith(')'));
  let cleaned = str.replace(/[()\-+]/g, '').trim();

  let multiplier = 1;
  const upper = cleaned.toUpperCase();

  if (upper.endsWith('B')) {
    multiplier = 1_000_000_000;
    cleaned = cleaned.slice(0, -1).trim();
  } else if (upper.endsWith('M')) {
    multiplier = 1_000_000;
    cleaned = cleaned.slice(0, -1).trim();
  } else if (upper.endsWith('K')) {
    multiplier = 1_000;
    cleaned = cleaned.slice(0, -1).trim();
  }

  if (multiplier !== 1) {
    // Angka singkatan (misal: "12,5B" atau "12.5B") -> desimal titik
    cleaned = cleaned.replace(',', '.');
  } else {
    // Format angka biasa: tangani pemisah ribuan titik/koma
    if (cleaned.includes('.') && cleaned.includes(',')) {
      if (cleaned.lastIndexOf('.') < cleaned.lastIndexOf(',')) {
        // Format Indonesia/Eropa: 1.250,50
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        // Format US: 1,250.50
        cleaned = cleaned.replace(/,/g, '');
      }
    } else if (cleaned.includes('.')) {
      const parts = cleaned.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
        cleaned = cleaned.replace(/\./g, '');
      }
    } else if (cleaned.includes(',')) {
      const parts = cleaned.split(',');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
        cleaned = cleaned.replace(/,/g, '');
      } else {
        cleaned = cleaned.replace(',', '.');
      }
    }
  }

  cleaned = cleaned.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return 0;

  const result = parsed * multiplier;
  return isNegative ? -result : result;
}

/**
 * Mengonversi tanggal teks Broker Summary Stockbit (misal: "16 Nov 26" atau "16 Nov 2026")
 * ke format SQL YYYY-MM-DD.
 *
 * @param {string} rawDateStr
 * @returns {string} Tanggal format YYYY-MM-DD
 */
export function parseTradeDate(rawDateStr) {
  if (!rawDateStr || typeof rawDateStr !== 'string') {
    return new Date().toISOString().slice(0, 10);
  }

  const str = rawDateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', mei: '05', may: '05',
    jun: '06', jul: '07', agu: '08', ags: '08', aug: '08', sep: '09',
    okt: '10', oct: '10', nov: '11', des: '12', dec: '12',
  };

  const match = str.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const monthKey = match[2].toLowerCase().slice(0, 3);
    const month = monthMap[monthKey] || '01';
    let year = match[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  const slashMatch = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0');
    const month = slashMatch[2].padStart(2, '0');
    let year = slashMatch[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  return new Date().toISOString().slice(0, 10);
}
