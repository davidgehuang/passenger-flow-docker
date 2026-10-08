'use strict';
const { isReadOnly } = require('../config/settings');
const MAINTENANCE_MESSAGE = '系统处于只读模式，请等待维护完成。';
module.exports = function maintenance(req, res, next) {
  if (!isReadOnly() || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/migration-lab/workload/stop') return next();
  if (req.path.startsWith('/migration-lab/') || (req.headers.accept || '').includes('application/json')) {
    return res.status(503).json({ status: 'MAINTENANCE', message: MAINTENANCE_MESSAGE });
  }
  return res.status(503).render('maintenance', { title: '只读维护模式', message: MAINTENANCE_MESSAGE });
};
module.exports.isMaintenanceMode = isReadOnly;
module.exports.MAINTENANCE_MESSAGE = MAINTENANCE_MESSAGE;
