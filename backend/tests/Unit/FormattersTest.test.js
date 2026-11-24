import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAbbreviatedNumber, parseTradeDate, randomDelay } from '../../src/utils/formatters.js';

describe('FormattersTest (Unit)', () => {
  describe('parseAbbreviatedNumber()', () => {
    it('harus mem-parsing notasi B (Miliar)', () => {
      assert.strictEqual(parseAbbreviatedNumber('12.5B'), 12500000000);
      assert.strictEqual(parseAbbreviatedNumber('1B'), 1000000000);
    });

    it('harus mem-parsing notasi M (Juta)', () => {
      assert.strictEqual(parseAbbreviatedNumber('350M'), 350000000);
      assert.strictEqual(parseAbbreviatedNumber('2.5M'), 2500000);
    });

    it('harus mem-parsing notasi K (Ribu)', () => {
      assert.strictEqual(parseAbbreviatedNumber('45.2K'), 45200);
      assert.strictEqual(parseAbbreviatedNumber('100K'), 100000);
    });

    it('harus menangani angka reguler dengan pemisah ribuan', () => {
      assert.strictEqual(parseAbbreviatedNumber('1,450'), 1450);
      assert.strictEqual(parseAbbreviatedNumber('12,500'), 12500);
    });

    it('harus mengembalikan 0 jika nilai kosong atau strip (-)', () => {
      assert.strictEqual(parseAbbreviatedNumber('-'), 0);
      assert.strictEqual(parseAbbreviatedNumber(''), 0);
      assert.strictEqual(parseAbbreviatedNumber(null), 0);
      assert.strictEqual(parseAbbreviatedNumber(undefined), 0);
      assert.strictEqual(parseAbbreviatedNumber('N/A'), 0);
    });

    it('harus menangani angka negatif', () => {
      assert.strictEqual(parseAbbreviatedNumber('-50M'), -50000000);
      assert.strictEqual(parseAbbreviatedNumber('(10B)'), -10000000000);
    });
  });

  describe('parseTradeDate()', () => {
    it('harus mengonversi format teks Stockbit (misal: "16 Nov 26") ke YYYY-MM-DD', () => {
      assert.strictEqual(parseTradeDate('16 Nov 26'), '2026-11-16');
      assert.strictEqual(parseTradeDate('1 Jan 26'), '2026-01-01');
    });

    it('harus menangani format teks dengan tahun 4 digit (misal: "24 Mei 2026")', () => {
      assert.strictEqual(parseTradeDate('24 Mei 2026'), '2026-05-24');
    });

    it('harus membiarkan tanggal yang sudah berformat ISO YYYY-MM-DD', () => {
      assert.strictEqual(parseTradeDate('2026-11-24'), '2026-11-24');
    });

    it('harus menangani format slash DD/MM/YYYY', () => {
      assert.strictEqual(parseTradeDate('15/08/2026'), '2026-08-15');
    });
  });

  describe('randomDelay()', () => {
    it('harus menghasilkan jeda Promise dalam batas waktu yang ditentukan', async () => {
      const start = Date.now();
      await randomDelay(10, 30);
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 9, `Elapsed time ${elapsed}ms harus >= 9ms`);
    });
  });
});
