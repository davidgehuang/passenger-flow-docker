'use strict';

// migration_operation_audit 表数据访问层（样本级 INSERT / UPDATE / DELETE 审计）

const { query, rawQuery } = require('../config/database');

// rows = [[batch_uuid, operation_type, table_name, record_id, record_uuid, beforeJson, afterJson], ...]
async function insertBatch(rows) {
  if (!rows.length) return 0;
  const result = await rawQuery(
    `INSERT INTO migration_operation_audit
       (batch_uuid, operation_type, table_name, record_id, record_uuid, before_value, after_value, source_env)
     VALUES ?`,
    [rows.map((r) => [...r, process.env.APP_ENV_NAME || 'LOCAL'])]
  );
  return result.affectedRows;
}

async function count() {
  const rows = await query(`SELECT COUNT(*) AS cnt FROM migration_operation_audit`);
  return rows[0].cnt;
}

async function countByOperation() {
  const rows = await query(
    `SELECT operation_type, COUNT(*) AS cnt FROM migration_operation_audit GROUP BY operation_type`
  );
  const result = { INSERT: 0, UPDATE: 0, DELETE: 0 };
  rows.forEach((r) => {
    result[r.operation_type] = r.cnt;
  });
  return result;
}

// Snapshot 用：每种操作最近 N 条样本
async function recentSamplesByType(type, limit = 50) {
  return query(
    `SELECT id, batch_uuid, operation_type, table_name, record_id, record_uuid,
            before_value, after_value,
            DATE_FORMAT(operation_time, '%Y-%m-%d %H:%i:%s') AS operation_time
     FROM migration_operation_audit
     WHERE operation_type = ?
     ORDER BY id DESC
     LIMIT ?`,
    [type, Number(limit)]
  );
}

module.exports = { insertBatch, count, countByOperation, recentSamplesByType };
