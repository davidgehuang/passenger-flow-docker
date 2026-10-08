'use strict';

// information_schema 与全局统计查询（db:check / migration-check / Migration Lab 使用）

const { rawQuery } = require('../config/database');

const TRACKED_TABLES = [
  'stores',
  'devices',
  'flow_events',
  'flow_hourly',
  'device_status_logs',
  'migration_markers',
  'migration_batches',
  'migration_operation_audit',
];

async function mysqlVersion() {
  const rows = await rawQuery('SELECT VERSION() AS version');
  return rows[0].version;
}

// All settings and reads must use the same checked-out connection.
async function freshTables(conn) {
  let cacheMode = 'bypassed';
  try { await conn.query('SET SESSION information_schema_stats_expiry = 0'); }
  catch (e) {
    if (e.code !== 'ER_UNKNOWN_SYSTEM_VARIABLE') throw e;
    cacheMode = 'unsupported-native';
  }
  const [tables] = await conn.query(
    `SELECT TABLE_NAME AS table_name, TABLE_ROWS AS approx_rows,
      COALESCE(DATA_LENGTH,0) AS data_length, COALESCE(INDEX_LENGTH,0) AS index_length,
      COALESCE(DATA_FREE,0) AS data_free,
      COALESCE(DATA_LENGTH,0)+COALESCE(INDEX_LENGTH,0) AS total_size
     FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'
     ORDER BY TABLE_NAME`, [require('../config/settings').dbName()]);
  const dataBytes = tables.reduce((n,t)=>n+Number(t.data_length),0);
  const indexBytes = tables.reduce((n,t)=>n+Number(t.index_length),0);
  return {bytes:dataBytes+indexBytes,dataBytes,indexBytes,metadataBytes:dataBytes+indexBytes,
    source:'information_schema.TABLES (storage engine estimate)',cacheMode,
    isMetadataFallback:false,tables};
}
async function databaseStorage() {
  return require('../config/database').withConnection(freshTables);
}
async function databaseSize() { return (await databaseStorage()).bytes; }
async function tableStats() { return (await databaseStorage()).tables; }
async function collectStorage() {
  return require('../config/database').withConnection(async conn => {
    const storage = await freshTables(conn);
    const [rows] = await conn.query('SELECT '+TRACKED_TABLES.map(t=>
      '(SELECT COUNT(*) FROM `'+t+'`) AS `'+t+'`').join(','));
    return {...storage,exactCounts:rows[0],database:require('../config/settings').dbName(),
      sampledAt:new Date().toISOString()};
  });
}

// 精确行数（关键表 COUNT(*)）
async function exactRowCounts() {
  const rows = await rawQuery(
    `SELECT
       (SELECT COUNT(*) FROM stores) AS stores,
       (SELECT COUNT(*) FROM devices) AS devices,
       (SELECT COUNT(*) FROM flow_events) AS flow_events,
       (SELECT COUNT(*) FROM flow_hourly) AS flow_hourly,
       (SELECT COUNT(*) FROM device_status_logs) AS device_status_logs,
       (SELECT COUNT(*) FROM migration_markers) AS migration_markers,
       (SELECT COUNT(*) FROM migration_batches) AS migration_batches,
       (SELECT COUNT(*) FROM migration_operation_audit) AS migration_operation_audit`
  );
  return rows[0];
}

async function totalRows() {
  const counts = await exactRowCounts();
  return Object.values(counts).reduce((sum, v) => sum + Number(v), 0);
}

module.exports = { freshTables, collectStorage, TRACKED_TABLES, mysqlVersion, databaseSize, databaseStorage, tableStats, exactRowCounts, totalRows };
