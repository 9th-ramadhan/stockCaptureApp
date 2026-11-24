import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPastClosingTime } from '../../src/scripts/runnerHelper.js';

describe('RunnerHelperTest (Unit)', () => {
  it('harus mendeteksi di luar jam trading pada akhir pekan (Sabtu & Minggu)', () => {
    const saturday = new Date('2026-11-28T03:00:00Z'); // Sabtu 11:00 WITA
    assert.strictEqual(isPastClosingTime(saturday), true);

    const sunday = new Date('2026-11-29T03:00:00Z'); // Minggu 11:00 WITA
    assert.strictEqual(isPastClosingTime(sunday), true);
  });

  it('harus mendeteksi dalam jam trading pada hari kerja bursa aktif (misal Rabu 11:00 WITA)', () => {
    const tradingTime = new Date('2026-11-25T03:00:00Z'); // 11:00 WITA
    assert.strictEqual(isPastClosingTime(tradingTime), false);
  });

  it('harus mendeteksi di luar jam trading setelah penutupan bursa (misal Rabu 17:30 WITA)', () => {
    const afterClosing = new Date('2026-11-25T09:30:00Z'); // 17:30 WITA
    assert.strictEqual(isPastClosingTime(afterClosing), true);
  });

  it('harus mendeteksi di luar jam trading sebelum pembukaan bursa (misal Rabu 08:00 WITA)', () => {
    const beforeOpen = new Date('2026-11-25T00:00:00Z'); // 08:00 WITA
    assert.strictEqual(isPastClosingTime(beforeOpen), true);
  });
});
