/**
 * Helper penentuan sesi perdagangan BEI/IDX berdasarkan zona waktu WITA (Asia/Makassar, UTC+8).
 * Jam perdagangan BEI dalam WITA:
 * - Senin - Kamis:
 *     Sesi 1: 10:00 - 13:00 WITA (09:00 - 12:00 WIB)
 *     Sesi 2: 14:30 - 17:00 WITA (13:30 - 16:00 WIB)
 * - Jumat:
 *     Sesi 1: 10:00 - 12:30 WITA (09:00 - 11:30 WIB)
 *     Sesi 2: 15:00 - 17:00 WITA (14:00 - 16:00 WIB)
 * - Pra-penutupan / Pasca-penutupan (Post Closing):
 *     17:00 - 17:15 WITA (16:00 - 16:15 WIB)
 * - Di luar jam tersebut / Akhir Pekan:
 *     AFTER_HOURS
 *
 * @param {Date} [date=new Date()]
 * @returns {'SESSION_1'|'SESSION_2'|'POST_CLOSING'|'AFTER_HOURS'}
 */
export function getMarketSession(date = new Date()) {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();

  // Konversi ke representasi waktu lokal WITA (Asia/Makassar)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Makassar',
    hour12: false,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
  });

  const parts = formatter.formatToParts(d);
  const getPart = (type) => parts.find((p) => p.type === type)?.value;

  const weekday = getPart('weekday'); // 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
  const hour = parseInt(getPart('hour') || '0', 10);
  const minute = parseInt(getPart('minute') || '0', 10);
  const timeInMinutes = hour * 60 + minute;

  // Akhir pekan (Sabtu & Minggu)
  if (weekday === 'Sat' || weekday === 'Sun') {
    return 'AFTER_HOURS';
  }

  // Waktu Post-Closing (17:00 - 17:15 WITA) untuk semua hari kerja
  if (timeInMinutes >= 17 * 60 && timeInMinutes <= 17 * 60 + 15) {
    return 'POST_CLOSING';
  }

  if (weekday === 'Fri') {
    // Jumat: Sesi 1 (10:00 - 12:30 WITA)
    if (timeInMinutes >= 10 * 60 && timeInMinutes < 12 * 60 + 30) {
      return 'SESSION_1';
    }
    // Jumat: Sesi 2 (15:00 - 17:00 WITA)
    if (timeInMinutes >= 15 * 60 && timeInMinutes < 17 * 60) {
      return 'SESSION_2';
    }
  } else {
    // Senin - Kamis: Sesi 1 (10:00 - 13:00 WITA)
    if (timeInMinutes >= 10 * 60 && timeInMinutes < 13 * 60) {
      return 'SESSION_1';
    }
    // Senin - Kamis: Sesi 2 (14:30 - 17:00 WITA)
    if (timeInMinutes >= 14 * 60 + 30 && timeInMinutes < 17 * 60) {
      return 'SESSION_2';
    }
  }

  return 'AFTER_HOURS';
}
