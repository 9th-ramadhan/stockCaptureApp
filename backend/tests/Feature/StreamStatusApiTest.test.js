import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/server.js';

describe('StreamStatusApiTest (Feature)', () => {
  let server;
  let baseUrl;

  before((t, done) => {
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

  it('GET /api/stream/orderbook/status harus mengembalikan status 200 dengan struktur status streaming yang lengkap', async () => {
    const res = await fetch(`${baseUrl}/api/stream/orderbook/status`);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.status, 'success');
    assert.ok(json.data !== undefined, 'Payload data harus ada');
    assert.strictEqual(typeof json.data.isRunning, 'boolean');
    assert.ok(Array.isArray(json.data.monitoredSymbols));
    assert.strictEqual(typeof json.data.intervalSeconds, 'number');
    assert.ok(typeof json.data.marketSession === 'string');
  });
});
