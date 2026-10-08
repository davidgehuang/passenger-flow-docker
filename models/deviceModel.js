'use strict';

// devices 表数据访问层

const { query, rawQuery } = require('../config/database');

async function list({ page = 1, pageSize = 20, keyword = '', status = '', storeId = '' } = {}) {
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(d.device_code LIKE ? OR d.device_name LIKE ? OR d.ip_address LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  if (status) {
    where.push('d.status = ?');
    params.push(status);
  }
  if (storeId) {
    where.push('d.store_id = ?');
    params.push(Number(storeId));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRows = await query(
    `SELECT COUNT(*) AS total FROM devices d ${whereSql}`,
    params
  );
  const total = countRows[0].total;
  const offset = (page - 1) * pageSize;

  const rows = await query(
    `SELECT d.device_id, d.device_code, d.store_id, d.device_name, d.device_type, d.ip_address,
            d.firmware_version, DATE_FORMAT(d.install_date, '%Y-%m-%d') AS install_date,
            DATE_FORMAT(d.last_online_time, '%Y-%m-%d %H:%i:%s') AS last_online_time,
            d.status, s.store_name,
            DATE_FORMAT(d.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM devices d
     LEFT JOIN stores s ON s.store_id = d.store_id
     ${whereSql}
     ORDER BY d.device_id DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(pageSize), Number(offset)]
  );

  return { rows, total };
}

async function findById(id) {
  const rows = await query(
    `SELECT d.device_id, d.device_code, d.store_id, d.device_name, d.device_type, d.ip_address,
            d.firmware_version, DATE_FORMAT(d.install_date, '%Y-%m-%d') AS install_date,
            DATE_FORMAT(d.last_online_time, '%Y-%m-%d %H:%i:%s') AS last_online_time,
            d.status, s.store_name, s.city,
            DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM devices d LEFT JOIN stores s ON s.store_id = d.store_id
     WHERE d.device_id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function update(id, data) {
  const rows = await query(
    `UPDATE devices SET device_name = ?, device_type = ?, ip_address = ?, firmware_version = ?,
            store_id = ?, status = ?, last_online_time = IF(? = 'ONLINE', NOW(6), last_online_time)
     WHERE device_id = ?`,
    [
      data.device_name,
      data.device_type || 'CAMERA',
      data.ip_address || '',
      data.firmware_version || '',
      Number(data.store_id),
      data.status || 'ONLINE',
      data.status || 'ONLINE',
      id,
    ]
  );
  return rows.affectedRows;
}

async function statusCounts() {
  const rows = await query(`SELECT status, COUNT(*) AS cnt FROM devices GROUP BY status`);
  const result = { ONLINE: 0, OFFLINE: 0, WARNING: 0, MAINTENANCE: 0 };
  rows.forEach((r) => {
    result[r.status] = r.cnt;
  });
  return result;
}

// 供 workload / 生成器随机选取设备
async function listForSelection() {
  return query(
    `SELECT device_id, store_id, device_code, device_name FROM devices ORDER BY device_id`
  );
}

async function stats() {
  const rows = await rawQuery(
    `SELECT COUNT(*) AS rows_count,
            COALESCE(MIN(device_id), 0) AS min_id,
            COALESCE(MAX(device_id), 0) AS max_id
     FROM devices`
  );
  return rows[0];
}

module.exports = { list, findById, update, statusCounts, listForSelection, stats };
