'use strict';

// stores 表数据访问层

const { query, rawQuery } = require('../config/database');

async function list({ page = 1, pageSize = 20, keyword = '', status = '' } = {}) {
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(store_code LIKE ? OR store_name LIKE ? OR city LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRows = await query(`SELECT COUNT(*) AS total FROM stores ${whereSql}`, params);
  const total = countRows[0].total;
  const offset = (page - 1) * pageSize;

  const rows = await query(
    `SELECT store_id, store_code, store_name, region, city, address, business_type,
            DATE_FORMAT(opening_date, '%Y-%m-%d') AS opening_date, status,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM stores ${whereSql}
     ORDER BY store_id DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(pageSize), Number(offset)]
  );

  return { rows, total };
}

async function findById(id) {
  const rows = await query(
    `SELECT store_id, store_code, store_name, region, city, address, business_type,
            DATE_FORMAT(opening_date, '%Y-%m-%d') AS opening_date, status,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM stores WHERE store_id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function create(data) {
  const rows = await query(
    `INSERT INTO stores (store_code, store_name, region, city, address, business_type, opening_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.store_code,
      data.store_name,
      data.region || '',
      data.city || '',
      data.address || '',
      data.business_type || '',
      data.opening_date || null,
      data.status || 'ACTIVE',
    ]
  );
  return rows.insertId;
}

async function update(id, data) {
  const rows = await query(
    `UPDATE stores SET store_code = ?, store_name = ?, region = ?, city = ?, address = ?,
            business_type = ?, opening_date = ?, status = ?
     WHERE store_id = ?`,
    [
      data.store_code,
      data.store_name,
      data.region || '',
      data.city || '',
      data.address || '',
      data.business_type || '',
      data.opening_date || null,
      data.status || 'ACTIVE',
      id,
    ]
  );
  return rows.affectedRows;
}

async function countByStatus() {
  const rows = await query(
    `SELECT status, COUNT(*) AS cnt FROM stores GROUP BY status`
  );
  const result = {};
  rows.forEach((r) => {
    result[r.status] = r.cnt;
  });
  return result;
}

async function listAll() {
  return query(
    `SELECT store_id, store_code, store_name, city, status FROM stores ORDER BY store_id`
  );
}

async function stats() {
  const rows = await rawQuery(
    `SELECT COUNT(*) AS rows_count,
            COALESCE(MIN(store_id), 0) AS min_id,
            COALESCE(MAX(store_id), 0) AS max_id
     FROM stores`
  );
  return rows[0];
}

module.exports = { list, findById, create, update, countByStatus, listAll, stats };
