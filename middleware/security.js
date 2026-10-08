'use strict';
const crypto = require('crypto');
const { URL } = require('url');
function equal(a, b) { return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest()); }
module.exports = function security(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  const user = process.env.APP_AUTH_USER || '';
  const password = process.env.APP_AUTH_PASSWORD || '';
  if (user && password && req.path !== '/health' && req.path !== '/live') {
    const auth = req.headers.authorization || '';
    const decoded = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString('utf8') : '';
    if (!equal(decoded, user + ':' + password)) {
      res.set('WWW-Authenticate', 'Basic realm="Passenger Flow", charset="UTF-8"');
      return res.status(401).send('需要管理员身份验证');
    }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    let invalid = req.headers['sec-fetch-site'] === 'cross-site';
    if (origin) { try { invalid = invalid || new URL(origin).host !== req.get('host'); } catch { invalid = true; } }
    if (invalid) return res.status(403).json({ status: 'ERROR', message: '禁止跨站写入请求' });
  }
  next();
};
