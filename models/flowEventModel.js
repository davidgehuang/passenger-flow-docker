'use strict';

// flow_events 表数据访问层（核心业务表）

const { query, rawQuery } = require('../config/database');

const SELECT_COLS = `e.id, e.store_id, e.device_id,
  DATE_FORMAT(e.event_time, '%Y-%m-%d %H:%i:%s') AS event_time,
  e.direction, e.people_count, e.confidence, e.sensor_type, e.trace_id, e.metadata,
  DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
  s.store_name, d.device_code`;

async function list({ page = 1, pageSize = 20, storeId = '', direction = '', dateFrom = '', dateTo = '' } = {}) {
  const where = [];
  const params = [];
  if (storeId) {
    where.push('e.store_id = ?');
    params.push(Number(storeId));
  }
  if (direction) {
    where.push('e.direction = ?');
    params.push(direction);
  }
  if (dateFrom) {
    where.push('e.event_time >= ?');
    params.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    where.push('e.event_time < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(`${dateTo} 00:00:00`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRows = await query(
    `SELECT COUNT(*) AS total FROM flow_events e ${whereSql}`,
    params
  );
  const total = countRows[0].total;
  const offset = (page - 1) * pageSize;

  const rows = await query(
    `SELECT ${SELECT_COLS}
     FROM flow_events e
     LEFT JOIN stores s ON s.store_id = e.store_id
     LEFT JOIN devices d ON d.device_id = e.device_id
     ${whereSql}
     ORDER BY e.id DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(pageSize), Number(offset)]
  );

  return { rows, total };
}

// 批量插入：rows = [[store_id, device_id, event_time, direction, people_count, confidence, sensor_type, trace_id, metadataJson], ...]
async function insertBatch(rows) {
  if (!rows.length) return { affected: 0, firstId: null, lastId: null };
  const result = await rawQuery(
    `INSERT INTO flow_events
       (store_id, device_id, event_time, direction, people_count, confidence, sensor_type, trace_id, metadata)
     VALUES ?`,
    [rows]
  );
  return {
    affected: result.affectedRows,
    firstId: result.insertId,
    lastId: result.insertId + result.affectedRows - 1,
  };
}

// 选取近期数据 id（UPDATE 实验目标）
async function selectRecentIds(limit) {
  const rows = await query(
    `SELECT id FROM flow_events ORDER BY id DESC LIMIT ?`,
    [Number(limit)]
  );
  return rows.map((r) => r.id);
}

async function selectByIds(ids) {
  if (!ids.length) return [];
  const rows = await rawQuery(
    `SELECT id, store_id, device_id,
            DATE_FORMAT(event_time, '%Y-%m-%d %H:%i:%s') AS event_time,
            direction, people_count, confidence, sensor_type, trace_id, metadata
     FROM flow_events WHERE id IN (?)`,
    [ids]
  );
  return rows;
}

// 真实修改业务字段（禁止只改 updated_at）
async function updateSample(id, changes) {
  const rows = await query(
    `UPDATE flow_events SET people_count = ?, confidence = ?, sensor_type = ?, metadata = ?
     WHERE id = ?`,
    [changes.people_count, changes.confidence, changes.sensor_type, changes.metadata, id]
  );
  return rows.affectedRows;
}

// 选取较早数据 id（DELETE 实验目标，从旧到新删除）
async function selectOldestIds(limit) {
  const rows = await query(
    `SELECT id FROM flow_events ORDER BY id ASC LIMIT ?`,
    [Number(limit)]
  );
  return rows.map((r) => r.id);
}

async function deleteByIds(ids) {
  if (!ids.length) return 0;
  const result = await rawQuery(`DELETE FROM flow_events WHERE id IN (?)`, [ids]);
  return result.affectedRows;
}

async function count() {
  const rows = await query(`SELECT COUNT(*) AS cnt FROM flow_events`);
  return rows[0].cnt;
}

// 今日统计（Dashboard）
async function todayStats() {
  const rows = await query(
    `SELECT
       COALESCE(SUM(people_count), 0) AS total_people,
       COALESCE(SUM(CASE WHEN direction = 'IN'  THEN people_count ELSE 0 END), 0) AS in_people,
       COALESCE(SUM(CASE WHEN direction = 'OUT' THEN people_count ELSE 0 END), 0) AS out_people
     FROM flow_events
     WHERE event_time >= CURDATE() AND event_time < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`
  );
  const r = rows[0];
  return {
    totalPeople: Number(r.total_people),
    inPeople: Number(r.in_people),
    outPeople: Number(r.out_people),
    inStore: Number(r.in_people) - Number(r.out_people),
  };
}

// 今日高峰小时
async function peakHourToday() {
  const rows = await query(
    `SELECT HOUR(event_time) AS h, SUM(people_count) AS people
     FROM flow_events
     WHERE event_time >= CURDATE() AND event_time < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
     GROUP BY HOUR(event_time)
     ORDER BY people DESC
     LIMIT 1`
  );
  return rows[0] ? `${String(rows[0].h).padStart(2, '0')}:00` : '-';
}

// 今日最繁忙门店
async function busiestStoreToday() {
  const rows = await query(
    `SELECT s.store_name, SUM(e.people_count) AS people
     FROM flow_events e JOIN stores s ON s.store_id = e.store_id
     WHERE e.event_time >= CURDATE() AND e.event_time < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
     GROUP BY e.store_id, s.store_name
     ORDER BY people DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

// 最近 24 小时趋势（按小时）
async function hourlyTrend24h() {
  return query(
    `SELECT DATE_FORMAT(event_time, '%m-%d %H:00') AS label,
            SUM(people_count) AS people
     FROM flow_events
     WHERE event_time >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
     GROUP BY DATE_FORMAT(event_time, '%Y-%m-%d %H'), label
     ORDER BY DATE_FORMAT(event_time, '%Y-%m-%d %H')`
  );
}

// 最近 7 天趋势（按天）
async function dailyTrend7d() {
  return query(
    `SELECT DATE_FORMAT(event_time, '%m-%d') AS label,
            SUM(people_count) AS people
     FROM flow_events
     WHERE event_time >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY DATE(event_time), label
     ORDER BY DATE(event_time)`
  );
}

// TOP 10 门店（最近 7 天）
async function topStores(limit = 10) {
  return query(
    `SELECT s.store_name AS label, SUM(e.people_count) AS people
     FROM flow_events e JOIN stores s ON s.store_id = e.store_id
     WHERE e.event_time >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY e.store_id, s.store_name
     ORDER BY people DESC
     LIMIT ?`,
    [Number(limit)]
  );
}

// IN / OUT 趋势（最近 7 天）
async function inOutTrend7d() {
  return query(
    `SELECT DATE_FORMAT(event_time, '%m-%d') AS label,
            SUM(CASE WHEN direction = 'IN'  THEN people_count ELSE 0 END) AS in_people,
            SUM(CASE WHEN direction = 'OUT' THEN people_count ELSE 0 END) AS out_people
     FROM flow_events
     WHERE event_time >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY DATE(event_time), label
     ORDER BY DATE(event_time)`
  );
}

// 城市客流对比（最近 7 天）
async function cityCompare7d() {
  return query(
    `SELECT s.city AS label, SUM(e.people_count) AS people
     FROM flow_events e JOIN stores s ON s.store_id = e.store_id
     WHERE e.event_time >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY s.city
     ORDER BY people DESC`
  );
}

// 汇总业务指标（Snapshot / Compare 用）
async function businessSummary() {
  const rows = await query(
    `SELECT COALESCE(SUM(people_count), 0) AS sum_people,
            SUM(CASE WHEN direction = 'IN'  THEN people_count ELSE 0 END) AS in_events,
            SUM(CASE WHEN direction = 'OUT' THEN people_count ELSE 0 END) AS out_events
     FROM flow_events`
  );
  const r = rows[0];
  return {
    sumPeopleCount: Number(r.sum_people),
    inCount: Number(r.in_events || 0),
    outCount: Number(r.out_events || 0),
  };
}

async function stats() {
  const rows = await rawQuery(
    `SELECT COUNT(*) AS rows_count,
            COALESCE(MIN(id), 0) AS min_id,
            COALESCE(MAX(id), 0) AS max_id,
            DATE_FORMAT(MIN(created_at), '%Y-%m-%d %H:%i:%s') AS min_created_at,
            DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i:%s') AS max_created_at
     FROM flow_events`
  );
  return rows[0];
}

module.exports = {
  list,
  insertBatch,
  selectRecentIds,
  selectByIds,
  selectOldestIds,
  updateSample,
  deleteByIds,
  count,
  todayStats,
  peakHourToday,
  busiestStoreToday,
  hourlyTrend24h,
  dailyTrend7d,
  topStores,
  inOutTrend7d,
  cityCompare7d,
  businessSummary,
  stats,
};
