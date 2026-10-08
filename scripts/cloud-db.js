'use strict';
// 云部署专用管理入口；不在常规APP启动时执行，不打印SQL或密码。
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const settings = require('../config/settings');
const { TRACKED_TABLES } = require('../models/statsModel');
const { seed } = require('./seed');
const { poolEnd } = require('../config/database');
function identifier(s) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s || '')) throw new Error('INVALID_IDENTIFIER');
  return String.fromCharCode(96) + s + String.fromCharCode(96);
}
function sqlString(s) {
  if (!s || /[\r\n\0]/.test(s)) throw new Error('INVALID_SECRET');
  return "'" + s.replace(/'/g, "''") + "'";
}
async function connect(admin = false) {
  const o = settings.options(false);
  delete o.connectionLimit; delete o.waitForConnections; delete o.queueLimit;
  if (admin) {
    o.user = process.env.DB_ADMIN_USER;
    o.password = process.env.DB_ADMIN_PASSWORD;
    if (!o.user || !o.password) throw new Error('ADMIN_CREDENTIALS_REQUIRED');
  }
  o.multipleStatements = admin;
  return mysql.createConnection(o);
}
async function verify(conn) {
  const [[row]] = await conn.query('SELECT CURRENT_USER() AS account, @@global.read_only AS readOnly, VERSION() AS version');
  const [tls] = await conn.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  if (!tls[0]?.Value) throw new Error('TLS_REQUIRED');
  const [tables] = await conn.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [settings.dbName()]);
  if (TRACKED_TABLES.some(t => !tables.some(r => r.TABLE_NAME === t))) throw new Error('MISSING_TABLES');
  await conn.query('SELECT 1 FROM ' + identifier(settings.dbName()) + '.stores LIMIT 1');
  return { account: row.account, readOnly: Number(row.readOnly), version: row.version, tls: true, tables: 8 };
}
async function main() {
  const action = process.argv[2];
  const admin = ['init-source', 'retention'].includes(action);
  let conn;
  try {
    if (action === 'init-source' && process.env.APP_ENV_NAME !== 'AWS') throw new Error('TARGET_INIT_FORBIDDEN');
    if (!['init-source', 'verify', 'replica-check', 'retention'].includes(action)) throw new Error('UNKNOWN_ACTION');
    conn = await connect(admin);
    if (admin) {
      await conn.query("SET SESSION sql_mode=CONCAT(@@SESSION.sql_mode,',NO_BACKSLASH_ESCAPES')");
      if (action === 'retention') {
        await conn.query("CALL mysql.rds_set_configuration('binlog retention hours',72)");
        console.log('已设置本连接端点的Binlog保留72小时；请再次预检实际值。');
        return;
      }
      settings.assertWritable();
      const [[role]] = await conn.query('SELECT @@global.read_only AS ro');
      if (Number(role.ro)) throw new Error('SOURCE_MUST_BE_WRITABLE');
      const name = settings.dbName();
      await conn.query('CREATE DATABASE IF NOT EXISTS ' + identifier(name) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
      const [[count]] = await conn.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [name]);
      if (Number(count.n)) throw new Error('SOURCE_NOT_EMPTY_MANUAL_REVIEW_REQUIRED');
      await conn.query('USE ' + identifier(name));
      const sql = fs.readFileSync(path.join(settings.root, 'db/schema.sql'), 'utf8')
        .split('INSERT INTO stores')[0].replace(/CREATE DATABASE[\s\S]*?;\s*/i, '').replace(/USE\s+[^;]+;\s*/i, '');
      await conn.query(sql);
      identifier(process.env.DB_USER);
      const app = sqlString(process.env.DB_USER) + "@'%'";
      const dts = "'passenger_dts'@'%'";
      await conn.query('CREATE USER IF NOT EXISTS ' + app + ' IDENTIFIED BY ' + sqlString(process.env.DB_PASSWORD) + ' REQUIRE SSL');
      await conn.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ' + identifier(name) + '.* TO ' + app);
      await conn.query('CREATE USER IF NOT EXISTS ' + dts + ' IDENTIFIED BY ' + sqlString(process.env.DTS_PASSWORD) + ' REQUIRE SSL');
      await conn.query('GRANT RELOAD,LOCK TABLES,REPLICATION CLIENT,REPLICATION SLAVE,SHOW DATABASES,SHOW VIEW,PROCESS ON *.* TO ' + dts);
      await conn.query('GRANT SELECT ON ' + identifier(name) + '.* TO ' + dts);
      await conn.query('GRANT SELECT ON mysql.* TO ' + dts);
      await conn.query('GRANT ALL PRIVILEGES ON __tencentdb__.* TO ' + dts);
      await conn.query("CALL mysql.rds_set_configuration('binlog retention hours',72)");
      await conn.end(); conn = await connect();
      await verify(conn);
      await seed();
      console.log('源库初始化完成：8张表、示例门店和设备；客流需单独生成。');
    } else {
      const result = await verify(conn);
      if (action === 'replica-check') {
        if (!result.readOnly) throw new Error('EXPECTED_READ_REPLICA');
        const vars = {};
        for (const name of ['log_bin','binlog_format','binlog_row_image','gtid_mode','log_replica_updates','log_slave_updates']) {
          const [rows] = await conn.query('SHOW GLOBAL VARIABLES LIKE ?', [name]);
          vars[name] = rows[0]?.Value;
        }
        if (!['ON','1'].includes(vars.log_bin) || vars.binlog_format !== 'ROW' || vars.binlog_row_image !== 'FULL' ||
          vars.gtid_mode !== 'ON' || !['ON','1'].includes(vars.log_replica_updates || vars.log_slave_updates)) throw new Error('REPLICA_BINLOG_NOT_READY');
        const [logs] = await conn.query('SHOW BINARY LOGS');
        if (!logs.length) throw new Error('NO_REPLICA_BINLOG');
        let state;
        try { [state] = await conn.query('SHOW REPLICA STATUS'); }
        catch { [state] = await conn.query('SHOW SLAVE STATUS'); }
        const r = state[0];
        const io = r?.Replica_IO_Running || r?.Slave_IO_Running;
        const sql = r?.Replica_SQL_Running || r?.Slave_SQL_Running;
        if (!r || io !== 'Yes' || sql !== 'Yes' || (r.Last_IO_Error || r.Last_SQL_Error)) throw new Error('REPLICATION_UNHEALTHY');
        const [sets] = await conn.query('CALL mysql.rds_show_configuration');
        const retention = sets[0]?.find(x => x.name === 'binlog retention hours')?.value;
        if (Number(retention) < 72 || retention === null || retention === undefined) throw new Error('RETENTION_BELOW_72H_OR_UNKNOWN');
        result.replication = { io, sql, secondsBehind: r.Seconds_Behind_Source ?? r.Seconds_Behind_Master, binlogFiles: logs.length, retentionHours: Number(retention) };
        result.binlog = vars;
      }
      console.log(JSON.stringify({ status: 'PASS', ...result, note: '不能替代DTS控制台预校验或两段追平验证' }));
    }
  } catch (e) {
    console.error('云数据库操作失败：' + (e.code || (/^[A-Z_]+$/.test(e.message) ? e.message : 'QUERY_FAILED')));
    process.exitCode = 1;
  } finally { if (conn) await conn.end(); await poolEnd(); }
}
if (require.main === module) main();
module.exports = { identifier, sqlString };
