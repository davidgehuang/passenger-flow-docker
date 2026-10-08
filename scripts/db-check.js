'use strict';

// npm run db:check
// 数据库健康检查：连接 / 版本 / 库大小 + 每张表 Rows / DATA_LENGTH / INDEX_LENGTH / DATA_FREE / TOTAL / MIN ID / MAX ID

const { buildPool, printHeader, printCheck, printSection, formatMb, runScript } = require('./lib/common');

const TABLES = [
  'stores',
  'devices',
  'flow_events',
  'flow_hourly',
  'device_status_logs',
  'migration_markers',
  'migration_batches',
  'migration_operation_audit',
];

const ID_COL = {
  stores: 'store_id',
  devices: 'device_id',
  flow_events: 'id',
  flow_hourly: 'id',
  device_status_logs: 'id',
  migration_markers: 'id',
  migration_batches: 'id',
  migration_operation_audit: 'id',
};

async function main() {
  printHeader('Database Check');
  const pool = buildPool();
  let failures = 0;

  try {
    const conn = await pool.getConnection();
    printCheck('DB Connection', 'PASS', `user=${process.env.DB_USER || '(empty)'}`);

    const [versionRows] = await conn.query('SELECT VERSION() AS v');
    printCheck('MySQL Version', 'PASS', versionRows[0].v);

    const dbName = process.env.DB_NAME || 'passenger_flow_codex';
    const storage = await require('../models/statsModel').freshTables(conn);
    printCheck('数据库容量（存储引擎估算）', 'PASS', `${formatMb(storage.bytes)} MiB; ${storage.bytes} bytes; cache=${storage.cacheMode}`);

    printSection(`每张表统计（共 ${TABLES.length} 张）`);
    console.log(
      'table'.padEnd(26) +
        'rows'.padStart(12) +
        'data(MiB)'.padStart(12) +
        'index(MiB)'.padStart(12) +
        'free(MiB)'.padStart(12) +
        'total(MiB)'.padStart(12) +
        'min_id'.padStart(12) +
        'max_id'.padStart(12)
    );
    console.log('-'.repeat(108));

    for (const table of TABLES) {
      const [stats] = await conn.query(
        `SELECT COALESCE(DATA_LENGTH,0) AS d, COALESCE(INDEX_LENGTH,0) AS i, COALESCE(DATA_FREE,0) AS f
         FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [dbName, table]
      );
      if (!stats.length) {
        printCheck(`表 ${table}`, 'FAIL', '不存在');
        failures += 1;
        continue;
      }
      const [exact] = await conn.query(
        `SELECT COUNT(*) AS cnt, COALESCE(MIN(${ID_COL[table]}),0) AS mn, COALESCE(MAX(${ID_COL[table]}),0) AS mx
         FROM \`${dbName}\`.${table}`
      );
      const d = Number(stats[0].d);
      const i = Number(stats[0].i);
      const f = Number(stats[0].f);
      console.log(
        table.padEnd(26) +
          String(exact[0].cnt).padStart(12) +
          formatMb(d).padStart(12) +
          formatMb(i).padStart(12) +
          formatMb(f).padStart(12) +
          formatMb(d + i).padStart(12) +
          String(exact[0].mn).padStart(12) +
          String(exact[0].mx).padStart(12)
      );
    }

    conn.release();
  } catch (err) {
    printCheck('DB Connection', 'FAIL', `${err.code || ''} ${err.message}`.trim());
    failures += 1;
  } finally {
    await pool.end();
  }

  console.log('');
  console.log(failures === 0 ? 'RESULT: PASS' : `RESULT: FAIL（${failures} 项失败）`);
  return failures === 0 ? 0 : 1;
}

runScript(main);
