'use strict';

// migration_batches 表数据访问层

const { query } = require('../config/database');
const { uuid } = require('../util/helpers');

async function create({ name, operationType, targetRows = 0, targetSizeMb = 0, notes = '' }) {
  const batchUuid = uuid();
  await query(
    `INSERT INTO migration_batches (batch_uuid, batch_name, operation_type, source_env, target_rows, target_size_mb, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', ?)`,
    [
      batchUuid,
      name,
      operationType,
      process.env.APP_ENV_NAME || 'LOCAL',
      Number(targetRows),
      Number(targetSizeMb),
      notes,
    ]
  );
  return batchUuid;
}

async function complete(batchUuid, { affectedRows = 0, targetSizeMb = 0, status = 'COMPLETED', notes = '' }) {
  const rows = await query(
    `UPDATE migration_batches
     SET affected_rows = ?, target_size_mb = ?, status = ?, completed_at = NOW(6), notes = ?
     WHERE batch_uuid = ?`,
    [Number(affectedRows), Number(targetSizeMb), status, notes, batchUuid]
  );
  return rows.affectedRows;
}

async function fail(batchUuid, notes = '') {
  const rows = await query(
    `UPDATE migration_batches
     SET status = 'FAILED', completed_at = NOW(6), notes = ?
     WHERE batch_uuid = ?`,
    [notes, batchUuid]
  );
  return rows.affectedRows;
}

async function latest(limit = 10) {
  return query(
    `SELECT id, batch_uuid, batch_name, operation_type, source_env, target_rows, affected_rows,
            target_size_mb, status,
            DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s') AS started_at,
            DATE_FORMAT(completed_at, '%Y-%m-%d %H:%i:%s') AS completed_at,
            notes
     FROM migration_batches
     ORDER BY id DESC
     LIMIT ?`,
    [Number(limit)]
  );
}

async function currentBatch() {
  const rows = await query(
    `SELECT batch_uuid, batch_name, operation_type, status,
            DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s') AS started_at
     FROM migration_batches
     WHERE status = 'RUNNING'
     ORDER BY id DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function count() {
  const rows = await query(`SELECT COUNT(*) AS cnt FROM migration_batches`);
  return rows[0].cnt;
}

async function listRecentUuids(limit = 50) {
  const rows = await query(
    `SELECT batch_uuid, operation_type FROM migration_batches ORDER BY id DESC LIMIT ?`,
    [Number(limit)]
  );
  return rows;
}

module.exports = { create, complete, fail, latest, currentBatch, count, listRecentUuids };
