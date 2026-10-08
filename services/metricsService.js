'use strict';

// Metrics are per Node process. Prometheus must scrape every Pod and aggregate by sum.
const client = require('@prometheus-io/client');
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'passenger_' });

const requests = new client.Counter({
  name: 'passenger_http_requests_total',
  help: 'HTTP responses served by this process',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});
const duration = new client.Histogram({
  name: 'passenger_http_request_duration_seconds',
  help: 'HTTP response duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});
const flowEvents = new client.Counter({
  name: 'passenger_flow_events_total',
  help: 'Flow event rows committed by this Node process since start',
  registers: [registry],
});
const onlineStores = new client.Gauge({
  name: 'passenger_online_stores',
  help: 'Last successfully sampled count of ACTIVE stores',
  registers: [registry],
});
const onlineDevices = new client.Gauge({
  name: 'passenger_online_devices',
  help: 'Last successfully sampled count of ONLINE devices',
  registers: [registry],
});
const businessMetricsUp = new client.Gauge({
  name: 'passenger_business_metrics_up',
  help: '1 if the last store and device sample succeeded, otherwise 0',
  registers: [registry],
});
businessMetricsUp.set(0);

function httpMiddleware(req, res, next) {
  const stop = duration.startTimer();
  res.once('finish', () => {
    // req.route.path is a declared route template, never a user supplied URL.
    const path = req.route && typeof req.route.path === 'string' ? req.route.path : 'unmatched';
    const route = path === 'unmatched' ? path : (req.baseUrl || '') + path;
    const labels = { method: req.method, route, status: String(res.statusCode) };
    requests.inc(labels);
    stop(labels);
  });
  next();
}

function recordFlowInserted(count) {
  if (Number.isSafeInteger(count) && count > 0) flowEvents.inc(count);
}

let timer = null;
let refreshing = false;
async function refreshBusinessGauges() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [stores, devices] = await Promise.all([
      require('../models/storeModel').countByStatus(),
      require('../models/deviceModel').statusCounts(),
    ]);
    onlineStores.set(Number(stores.ACTIVE || 0));
    onlineDevices.set(Number(devices.ONLINE || 0));
    businessMetricsUp.set(1);
  } catch {
    businessMetricsUp.set(0);
  } finally {
    refreshing = false;
  }
}
function startBusinessRefresh() {
  if (timer) return;
  void refreshBusinessGauges();
  timer = setInterval(() => { void refreshBusinessGauges(); }, 60000);
  timer.unref();
}
function stopBusinessRefresh() {
  if (timer) clearInterval(timer);
  timer = null;
}
async function handler(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (err) {
    next(err);
  }
}
module.exports = { httpMiddleware, handler, recordFlowInserted, refreshBusinessGauges,
  startBusinessRefresh, stopBusinessRefresh, registry };
