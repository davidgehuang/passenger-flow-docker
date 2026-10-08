'use strict';

// migration_markers 表数据访问层
// sequence_number 取 MAX+1 单调递增（唯一约束兜底），用于验证 DTS CDC 同步顺序

const { query, rawQuery, withConnection } = require('../config/database');
const { uuid, sha256 } = require('../util/helpers');
const { assertWritable, dbName } = require('../config/settings');

const MARKER_TYPES = [
  'PRE_DTS',
  'FULL_MIGRATION_START',
  'FULL_MIGRATION_COMPLETE',
  'DURING_DTS',
  'DELETE_TEST_START',
  'DELETE_TEST_COMPLETE',
  'UPDATE_TEST_START',
  'UPDATE_TEST_COMPLETE',
  'INSERT_TEST_START',
  'INSERT_TEST_COMPLETE',
  'PRE_CUTOVER',
  'POST_CUTOVER',
];

async function create({ type, message = '', batchUuid = '', operationType = '', rowReference = null, checksum = null }) {
  assertWritable();
  if (!MARKER_TYPES.includes(type) || message.length > 255 || batchUuid.length > 64) throw Object.assign(new Error('Marker 参数无效'), { status: 400 });
  return withConnection(async (conn) => {
    const lockName = 'pf-marker-' + sha256(dbName()).slice(0, 40);
    const [lock] = await conn.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
    if (Number(lock[0].acquired) !== 1) throw new Error('Marker 序列锁超时');
    try {
    assertWritable();
    const [seqRows] = await conn.query('SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq FROM migration_markers');
    const sequence = seqRows[0].next_seq;
    const markerUuid = uuid();
    await conn.execute(
      `INSERT INTO migration_markers
         (sequence_number, marker_uuid, batch_uuid, source_env, marker_type, operation_type, row_reference, message, checksum)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sequence,
        markerUuid,
        batchUuid,
        process.env.APP_ENV_NAME || 'LOCAL',
        type,
        operationType,
        rowReference,
        message,
        checksum,
      ]
    );
    return { sequence, markerUuid, markerType: type, sourceEnv: process.env.APP_ENV_NAME || 'LOCAL' };
    } finally { await conn.query('SELECT RELEASE_LOCK(?)', [lockName]); }
  });
}

async function list({ limit = 50 } = {}) {
  return query(
    `SELECT id, sequence_number, marker_uuid, batch_uuid, source_env, marker_type, operation_type,
            row_reference, message,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS created_at
     FROM migration_markers
     ORDER BY sequence_number DESC
     LIMIT ?`,
    [Number(limit)]
  );
}

async function stats() {
  const rows = await query(
    `SELECT COUNT(*) AS marker_count,
            COALESCE(MIN(sequence_number), 0) AS min_sequence,
            COALESCE(MAX(sequence_number), 0) AS max_sequence
     FROM migration_markers`
  );
  const lastRows = await query(
    `SELECT marker_type, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM migration_markers ORDER BY sequence_number DESC LIMIT 1`
  );
  return {
    count: Number(rows[0].marker_count),
    minSequence: Number(rows[0].min_sequence),
    maxSequence: Number(rows[0].max_sequence),
    lastType: lastRows[0] ? lastRows[0].marker_type : null,
    lastTime: lastRows[0] ? lastRows[0].created_at : null,
  };
}

async function count() {
  const rows = await rawQuery(
    `SELECT COUNT(*) AS rows_count,
            COALESCE(MIN(id), 0) AS min_id,
            COALESCE(MAX(id), 0) AS max_id
     FROM migration_markers`
  );
  return rows[0];
}

module.exports = { MARKER_TYPES, create, list, stats, count };
