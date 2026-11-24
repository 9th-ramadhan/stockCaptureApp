import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler, notFoundHandler } from '../../src/middlewares/errorHandler.js';

describe('ErrorHandlerMiddlewareTest (Feature)', () => {
  it('harus secara otomatis mendeteksi auth error dan menghasilkan respons HTTP 401 dengan requiresLogin: true', () => {
    let statusCode = null;
    let jsonResponse = null;

    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        jsonResponse = payload;
        return this;
      },
    };

    const authError = new Error('File cookies.json tidak ditemukan atau sesi kedaluwarsa');
    errorHandler(authError, { method: 'POST', originalUrl: '/api/capture/orderbook' }, mockRes, () => {});

    assert.strictEqual(statusCode, 401);
    assert.strictEqual(jsonResponse.status, 'error');
    assert.strictEqual(jsonResponse.requiresLogin, true);
    assert.ok(jsonResponse.message.includes('cookies.json') || jsonResponse.message.includes('Sesi'));
  });

  it('harus menangani error umum dengan respons HTTP 500 dan mempertahankan customMessage', () => {
    let statusCode = null;
    let jsonResponse = null;

    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        jsonResponse = payload;
        return this;
      },
    };

    const generalError = new Error('Koneksi MySQL terputus tiba-tiba');
    generalError.customMessage = 'Gagal menyimpan snapshot ke database';
    errorHandler(generalError, { method: 'POST', originalUrl: '/api/capture/broksum' }, mockRes, () => {});

    assert.strictEqual(statusCode, 500);
    assert.strictEqual(jsonResponse.status, 'error');
    assert.strictEqual(jsonResponse.requiresLogin, false);
    assert.strictEqual(jsonResponse.message, 'Gagal menyimpan snapshot ke database');
  });

  it('notFoundHandler harus merespons 404 dengan pesan rute yang tidak ditemukan', () => {
    let statusCode = null;
    let jsonResponse = null;

    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        jsonResponse = payload;
        return this;
      },
    };

    notFoundHandler({ method: 'DELETE', originalUrl: '/api/non-existent-route' }, mockRes);

    assert.strictEqual(statusCode, 404);
    assert.strictEqual(jsonResponse.status, 'error');
    assert.ok(jsonResponse.message.includes('DELETE /api/non-existent-route'));
  });
});
