import fsSync from 'fs';
import path from 'path';

/**
 * Deteksi path Google Chrome reguler di sistem pengguna (Windows/Linux/Mac)
 * Menggunakan Chrome asli sistem untuk kestabilan dan bypass proteksi automasi
 * @returns {string|undefined}
 */
export function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fsSync.existsSync(p)) return p;
    } catch {
      // Abaikan jika tidak ada akses
    }
  }
  return undefined;
}
