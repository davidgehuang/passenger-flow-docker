'use strict';
const settings = require('./config/settings');
const express = require('express');
const path = require('path');
const routes = require('./routes');
const { poolEnd } = require('./config/database');
const { logInfo, logError } = require('./util/logger');
const { APP_VERSION, GIT_COMMIT } = require('./util/version');
const { maskHost } = require('./util/helpers');
const workload = require('./services/workloadService');
const metrics = require('./services/metricsService');
const app = express();
const PORT = settings.integer(process.env.PORT, 'PORT', 0, 65535, 3030);
const HOST = process.env.BIND_HOST || '127.0.0.1';
const loopbackHost = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
const cloud = ['AWS', 'TENCENT'].includes(process.env.APP_ENV_NAME);
const publicMode = cloud || !loopbackHost;
const containerRuntime = settings.boolean(process.env.CONTAINER_RUNTIME, 'CONTAINER_RUNTIME', false);
if (Boolean(process.env.APP_AUTH_USER) !== Boolean(process.env.APP_AUTH_PASSWORD)) throw new Error('APP_AUTH_USER 和 APP_AUTH_PASSWORD 必须同时填写或同时留空');
if (publicMode && (!process.env.APP_AUTH_USER || !process.env.APP_AUTH_PASSWORD)) throw new Error('云端或非回环监听必须配置 APP_AUTH_USER 和 APP_AUTH_PASSWORD');
if (!loopbackHost && !(containerRuntime && HOST === '0.0.0.0' && process.env.NODE_ENV === 'production')) {
  throw new Error('非回环监听仅允许生产容器使用 BIND_HOST=0.0.0.0、CONTAINER_RUNTIME=true，并通过受控入口访问');
}
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
app.use((req, res, next) => {
  Object.assign(res.locals, { envName: process.env.APP_ENV_NAME || 'LOCAL', appVersion: APP_VERSION,
    gitCommit: GIT_COMMIT, maskedHost: maskHost(process.env.DB_HOST), maintenanceMode: settings.isReadOnly(), active: '' });
  next();
});
app.use(metrics.httpMiddleware);
app.use(require('./middleware/security'));
app.get('/metrics', metrics.handler);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(require('./middleware/maintenance'));
app.use(require('./middleware/validation'));
app.use(routes);
app.use((req, res) => {
  if (req.path.startsWith('/migration-lab/') || (req.headers.accept || '').includes('application/json')) return res.status(404).json({ status: 'ERROR', message: 'Not Found' });
  return res.status(404).render('error', { title: '404', isDbError: false, error: 'NOT_FOUND', message: '页面不存在' });
});
app.use(require('./middleware/errorHandler'));
if (require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    logInfo('APP', '服务启动 http://' + HOST + ':' + server.address().port);
    metrics.startBusinessRefresh();
  });
  server.on('error', async err => { logError('APP', err.code || 'LISTEN_ERROR'); await poolEnd(); process.exitCode = 1; });
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => process.exit(1), 35000).unref();
    const closed = new Promise(resolve => server.close(resolve));
    try { metrics.stopBusinessRefresh(); await workload.shutdown(); await closed; await poolEnd(); clearTimeout(timeout); process.exitCode = 0; }
    catch (err) { logError('APP', err.message); process.exit(1); }
  }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
module.exports = app;
