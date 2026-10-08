'use strict';

// /health API + /system-health 页面
// 禁止返回 DB_USER / DB_PASSWORD / Secret / Credential

const { ping, getDbConfigInfo } = require('../config/database');
const { APP_VERSION, GIT_COMMIT } = require('../util/version');

async function health(req, res) {
  let database = 'DOWN';
  let databaseVersion = null;
  try {
    databaseVersion = await ping();
    database = 'UP';
  } catch {
    database = 'DOWN';
  }

  res.status(database === 'UP' ? 200 : 503).json({
    status: database === 'UP' ? 'UP' : 'DOWN',
    app: 'passenger-flow-system',
    environment: process.env.APP_ENV_NAME || 'LOCAL',
    version: APP_VERSION,
    gitCommit: GIT_COMMIT,
    maintenanceMode: require('../config/settings').isReadOnly(),
    database,
    databaseVersion,
    timestamp: new Date().toISOString(),
  });
}

async function systemHealthPage(req, res) {
  const info = getDbConfigInfo();
  res.render('system-health', {
    title: 'System Health - 企业客流管理系统',
    active: 'system-health',
    dbInfo: info,
  });
}

module.exports = { health, systemHealthPage };
