'use strict';
function databaseErrorDetail(err) {
  const code = err && err.code ? String(err.code) : 'DATABASE_ERROR';
  const source = String((err && (err.sqlMessage || err.message)) || '未知数据库错误');
  const message = source.replace(/(password\s*[:=]\s*)\S+/ig, '$1[redacted]');
  return '[ERROR] ' + code + ': ' + message;
}
function databaseErrorHint(err) {
  if (!err || err.code !== 'ER_ACCESS_DENIED_ERROR') return '';
  return '数据库认证被拒绝（地址已可达）：核对 DB_USER、DB_PASSWORD 与数据库账号的 Host 授权。本地 Compose 自动使用 DB_HOST=db；已有 MySQL 数据卷不会因修改 .env.docker 而重设密码。云端请核对 RDS/TencentDB 的实际账号。不要在日志中输出密码。';
}
module.exports = { databaseErrorDetail, databaseErrorHint };
