import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getMarketSession } from '../../src/utils/marketScheduleHelper.js';

describe('MarketScheduleTest (Unit)', () => {
  it('harus mengembalikan AFTER_HOURS pada akhir pekan (Sabtu & Minggu)', () => {
    // 2026-11-28 adalah hari Sabtu
    const saturday = new Date('2026-11-28T04:00:00Z'); // 12:00 WITA
    assert.strictEqual(getMarketSession(saturday), 'AFTER_HOURS');

    // 2026-11-29 adalah hari Minggu
    const sunday = new Date('2026-11-29T04:00:00Z');
    assert.strictEqual(getMarketSession(sunday), 'AFTER_HOURS');
  });

  it('harus mendeteksi SESSION_1 pada Senin - Kamis pukul 10:00 - 13:00 WITA', () => {
    // 2026-11-25 adalah hari Rabu. 10:30 WITA = 02:30 UTC
    const wednesdayS1 = new Date('2026-11-25T02:30:00Z');
    assert.strictEqual(getMarketSession(wednesdayS1), 'SESSION_1');
  });

  it('harus mendeteksi SESSION_2 pada Senin - Kamis pukul 14:30 - 17:00 WITA', () => {
    // 2026-11-25 adalah hari Rabu. 15:00 WITA = 07:00 UTC
    const wednesdayS2 = new Date('2026-11-25T07:00:00Z');
    assert.strictEqual(getMarketSession(wednesdayS2), 'SESSION_2');
  });

  it('harus mendeteksi POST_CLOSING pada hari kerja pukul 17:00 - 17:15 WITA', () => {
    // 17:05 WITA = 09:05 UTC
    const postClosing = new Date('2026-11-25T09:05:00Z');
    assert.strictEqual(getMarketSession(postClosing), 'POST_CLOSING');
  });

  it('harus mendeteksi AFTER_HOURS di luar jam bursa pada hari kerja (misal malam hari)', () => {
    // 21:00 WITA = 13:00 UTC
    const nightTime = new Date('2026-11-25T13:00:00Z');
    assert.strictEqual(getMarketSession(nightTime), 'AFTER_HOURS');
  });

  it('harus mengakomodasi jadwal khusus hari Jumat (Sesi 1: 10:00-12:30, Sesi 2: 15:00-17:00 WITA)', () => {
    // 2026-11-27 adalah hari Jumat
    // 11:00 WITA = 03:00 UTC -> SESSION_1
    const fridayS1 = new Date('2026-11-27T03:00:00Z');
    assert.strictEqual(getMarketSession(fridayS1), 'SESSION_1');

    // 13:00 WITA = 05:00 UTC -> AFTER_HOURS (Jeda sholat Jumat)
    const fridayBreak = new Date('2026-11-27T05:00:00Z');
    assert.strictEqual(getMarketSession(fridayBreak), 'AFTER_HOURS');

    // 15:30 WITA = 07:30 UTC -> SESSION_2
    const fridayS2 = new Date('2026-11-27T07:30:00Z');
    assert.strictEqual(getMarketSession(fridayS2), 'SESSION_2');
  });
});
