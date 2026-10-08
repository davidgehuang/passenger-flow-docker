'use strict';

// 统一错误处理：JSON / HTML 双形态，禁止输出数据库凭据

const { logError } = require('../util/logger');

function isDbError(err) {
  return err && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ER_ACCESS_DENIED_ERROR' || err.code === 'ENOTFOUND' || err.code === 'EHOSTUNREACH' || err.code === 'ER_BAD_DB_ERROR' || err.code === 'PROTOCOL_CONNECTION_LOST');
}

module.exports = function errorHandler(err, req, res, next) {
  logError('HTTP', `${req.method} ${req.originalUrl} -> ${err.code || err.name || 'ERROR'}: ${err.message}`);

  const status = err.status || (isDbError(err) ? 503 : 500);
  const safeMessage = status >= 500 && !isDbError(err) ? '服务处理失败，请查看服务器日志' : err.message;

  if (req.path === '/health' || (req.headers.accept || '').includes('application/json') || req.path.startsWith('/migration-lab/')) {
    return res.status(status).json({
      status: 'ERROR',
      error: err.code || 'INTERNAL_ERROR',
      message: isDbError(err) ? '数据库连接失败，请检查部署配置中的数据库账号和地址；本地容器配置在 .env.docker' : safeMessage,
    });
  }

  return res.status(status).render('error', {
    title: '系统错误',
    isDbError: isDbError(err),
    error: err.code || err.name || 'ERROR',
    message: isDbError(err) ? '数据库连接失败，请检查部署配置中的 DB_HOST / DB_USER / DB_PASSWORD；本地 Compose 地址自动为 db' : safeMessage,
  });
};
