import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCookies } from '../../src/services/authCookieService.js';

describe('AuthCookieTest (Unit)', () => {
  it('harus menormalisasi format array cookies Puppeteer standar', () => {
    const raw = [
      { name: 'token', value: 'xyz123', domain: '.stockbit.com' },
      { name: 'session_id', value: 'sess456' },
    ];
    const normalized = normalizeCookies(raw);

    assert.strictEqual(normalized.length, 2);
    assert.strictEqual(normalized[0].name, 'token');
    assert.strictEqual(normalized[0].value, 'xyz123');
    assert.strictEqual(normalized[0].domain, '.stockbit.com');
  });

  it('harus menormalisasi format objek key-value sederhana', () => {
    const raw = {
      token: 'abc789',
      userId: 1001,
    };
    const normalized = normalizeCookies(raw);

    assert.strictEqual(normalized.length, 2);
    assert.strictEqual(normalized[0].name, 'token');
    assert.strictEqual(normalized[0].value, 'abc789');
    assert.strictEqual(normalized[1].name, 'userId');
    assert.strictEqual(normalized[1].value, '1001');
  });

  it('harus menormalisasi format teks header cookies (name=value; other=123)', () => {
    const raw = 'sb_token=secret123; device=chrome; tracking=on';
    const normalized = normalizeCookies(raw);

    assert.strictEqual(normalized.length, 3);
    assert.strictEqual(normalized[0].name, 'sb_token');
    assert.strictEqual(normalized[0].value, 'secret123');
    assert.strictEqual(normalized[1].name, 'device');
    assert.strictEqual(normalized[1].value, 'chrome');
  });

  it('harus mengembalikan array kosong jika input null atau undefined', () => {
    assert.deepStrictEqual(normalizeCookies(null), []);
    assert.deepStrictEqual(normalizeCookies(undefined), []);
  });
});
