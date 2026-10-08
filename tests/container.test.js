'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.NODE_ENV = 'production';
process.env.CONTAINER_RUNTIME = 'true';
process.env.BIND_HOST = '0.0.0.0';
process.env.APP_AUTH_USER = 'container-test';
process.env.APP_AUTH_PASSWORD = 'local-only-test-password';

const app = require('../app');
const metrics = require('../services/metricsService');
const { poolEnd } = require('../config/database');

test('container preflight validates configuration before database access', async () => {
  const settings = require('../config/settings');
  const oldUser = process.env.APP_AUTH_USER, oldPassword = process.env.DB_PASSWORD;
  try {
    process.env.APP_AUTH_USER = 'invalid:user';
    await assert.rejects(require('../scripts/container-preflight').main(), /不能包含冒号/);
    process.env.APP_AUTH_USER = oldUser;
    process.env.DB_HOST = 'db'; process.env.DB_USER = 'unit_user'; process.env.DB_PASSWORD = '';
    await assert.rejects(require('../scripts/container-preflight').main(), /DB_USER 和 DB_PASSWORD/);
    process.env.DB_PASSWORD = 'test-only'; process.env.SEED_DEMO_DATA = 'true'; process.env.DB_READ_ONLY = 'true';
    await assert.rejects(require('../scripts/container-preflight').main(), /只读/);
    process.env.DB_READ_ONLY = 'invalid';
    assert.throws(settings.isReadOnly, /true 或 false/);
    process.env.DB_SSL = 'invalid'; assert.throws(settings.options, /true 或 false/);
  } finally {
    process.env.APP_AUTH_USER = oldUser;
    if (oldPassword === undefined) delete process.env.DB_PASSWORD; else process.env.DB_PASSWORD = oldPassword;
    for (const key of ['DB_READ_ONLY','DB_SSL','SEED_DEMO_DATA','DB_HOST','DB_USER']) delete process.env[key];
  }
});

test('container HTTP probes and authenticated bounded-cardinality metrics', async () => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const auth = 'Basic ' + Buffer.from('container-test:local-only-test-password').toString('base64');
  try {
    assert.equal((await fetch(base + '/live')).status, 200);
    assert.equal((await fetch(base + '/metrics')).status, 401);
    assert.equal((await fetch(base + '/not-a-secret-123', { headers: { Authorization: auth } })).status, 404);
    metrics.recordFlowInserted(3);
    const response = await fetch(base + '/metrics', { headers: { Authorization: auth } });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /passenger_http_requests_total/);
    assert.match(body, /route="unmatched"/);
    assert.doesNotMatch(body, /not-a-secret-123/);
    assert.match(body, /passenger_flow_events_total 3/);
    assert.match(body, /passenger_online_stores/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await poolEnd();
  }
});
