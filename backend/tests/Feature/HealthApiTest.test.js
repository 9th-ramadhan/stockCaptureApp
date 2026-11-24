import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/server.js';

describe('HealthApiTest (Feature)', () => {
  let server;
  let baseUrl;

  before((t, done) => {
    // Jalankan server di port ephemeral acak (0) untuk testing HTTP
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after((t, done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  it('GET /api/health harus mengembalikan status 200 OK dengan payload JSON yang valid', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.status, 'OK');
    assert.strictEqual(typeof json.message, 'string');
    assert.strictEqual(typeof json.timestamp, 'string');
  });

  it('GET /api/rute-palsu harus ditangkap oleh notFoundHandler dengan status 404', async () => {
    const res = await fetch(`${baseUrl}/api/rute-palsu`);
    assert.strictEqual(res.status, 404);

    const json = await res.json();
    assert.strictEqual(json.status, 'error');
    assert.ok(json.message.includes('404') || json.message.includes('tidak ditemukan'));
  });
});
