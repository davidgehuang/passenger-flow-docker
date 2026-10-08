'use strict';
const fs = require('fs');
const path = require('path');
const settings = require('../config/settings');
const { buildPool, printHeader, runScript } = require('./lib/common');
async function main() {
  settings.assertWritable();
  const name = settings.dbName();
  printHeader('初始化数据库');
  let sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  // 数据库由运维提前创建。应用账号只连接 DB_NAME 并补齐业务表，避免要求 CREATE DATABASE 权限。
  sql = sql.split('INSERT INTO stores')[0]
    .replace(/CREATE DATABASE[\s\S]*?;\s*/i, '')
    .replace(/USE\s+[^;]+;\s*/i, '');
  const pool = buildPool();
  try {
    await pool.query(sql);
    const [tables] = await pool.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [name]);
    const required = ['stores','devices','flow_events','flow_hourly','device_status_logs','migration_markers','migration_batches','migration_operation_audit'];
    if (required.some(t => !tables.some(r => r.TABLE_NAME === t))) throw new Error('初始化后表不完整');
    console.log('已验证 8 张表。种子数据需单独运行 npm run db:seed。');
  } finally { await pool.end(); }
}
if (require.main === module) runScript(main);
module.exports = { main };
