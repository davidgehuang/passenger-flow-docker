'use strict';

// device_status_logs 表数据访问层

const { query, rawQuery } = require('../config/database');

// rows = [[device_id, log_time, cpu, memory, latency, temperature, status, message, metadataJson], ...]
async function insertBatch(rows) {
  if (!rows.length) return { affected: 0, firstId: null, lastId: null };
  const result = await rawQuery(
    `INSERT INTO device_status_logs
       (device_id, log_time, cpu_usage, memory_usage, network_latency, temperature, status, message, metadata)
     VALUES ?`,
    [rows]
  );
  return {
    affected: result.affectedRows,
    firstId: result.insertId,
    lastId: result.insertId + result.affectedRows - 1,
  };
}

async function selectRecentIds(limit) {
  const rows = await query(
    `SELECT id FROM device_status_logs ORDER BY id DESC LIMIT ?`,
    [Number(limit)]
  );
  return rows.map((r) => r.id);
}

async function selectByIds(ids) {
  if (!ids.length) return [];
  const rows = await rawQuery(
    `SELECT id, device_id, DATE_FORMAT(log_time, '%Y-%m-%d %H:%i:%s') AS log_time,
            cpu_usage, memory_usage, network_latency, temperature, status, message, metadata
     FROM device_status_logs WHERE id IN (?)`,
    [ids]
  );
  return rows;
}

// 真实修改业务字段（network_latency / temperature / status / message）
async function updateSample(id, changes) {
  const rows = await query(
    `UPDATE device_status_logs SET network_latency = ?, temperature = ?, status = ?, message = ?
     WHERE id = ?`,
    [changes.network_latency, changes.temperature, changes.status, changes.message, id]
  );
  return rows.affectedRows;
}

async function selectOldestIds(limit) {
  const rows = await query(
    `SELECT id FROM device_status_logs ORDER BY id ASC LIMIT ?`,
    [Number(limit)]
  );
  return rows.map((r) => r.id);
}

async function deleteByIds(ids) {
  if (!ids.length) return 0;
  const result = await rawQuery(`DELETE FROM device_status_logs WHERE id IN (?)`, [ids]);
  return result.affectedRows;
}

async function count() {
  const rows = await query(`SELECT COUNT(*) AS cnt FROM device_status_logs`);
  return rows[0].cnt;
}

async function statusSummary() {
  const rows = await query(`SELECT status, COUNT(*) AS cnt FROM device_status_logs GROUP BY status`);
  const result = {};
  rows.forEach((r) => {
    result[r.status] = r.cnt;
  });
  return result;
}

async function stats() {
  const rows = await rawQuery(
    `SELECT COUNT(*) AS rows_count,
            COALESCE(MIN(id), 0) AS min_id,
            COALESCE(MAX(id), 0) AS max_id,
            DATE_FORMAT(MIN(created_at), '%Y-%m-%d %H:%i:%s') AS min_created_at,
            DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i:%s') AS max_created_at
     FROM device_status_logs`
  );
  return rows[0];
}

module.exports = {
  insertBatch,
  selectRecentIds,
  selectByIds,
  selectOldestIds,
  updateSample,
  deleteByIds,
  count,
  statusSummary,
  stats,
};
