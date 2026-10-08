'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const mysql = require('mysql2/promise');
const settings = require('./settings');
const { maskHost } = require('../util/helpers');
const context = new AsyncLocalStorage();
const pool = settings.configurePool(mysql.createPool(settings.options()));
async function query(sql, params = []) {
  if (/^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE)/i.test(sql)) settings.assertWritable();
  const conn = context.getStore() || pool;
  const [rows] = /\bLIMIT\s+\?/i.test(sql) ? await conn.query(sql, params) : await conn.execute(sql, params);
  return rows;
}
async function rawQuery(sql, params = []) {
  if (/^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE)/i.test(sql)) settings.assertWritable();
  const [rows] = await (context.getStore() || pool).query(sql, params);
  return rows;
}
async function withConnection(fn) {
  const existing = context.getStore();
  if (existing) return fn(existing);
  const conn = await pool.getConnection();
  try { return await fn(conn); } finally { conn.release(); }
}
async function transaction(fn, { readOnly = false } = {}) {
  if (context.getStore()) return fn(context.getStore());
  if (!readOnly) settings.assertWritable();
  return withConnection(async conn => {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.query(readOnly ? 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY' : 'START TRANSACTION');
    try {
      const value = await context.run(conn, () => fn(conn));
      await conn.commit(); return value;
    } catch (err) { await conn.rollback(); throw err; }
  });
}
async function ping() {
  const rows = await rawQuery('SELECT VERSION() AS version');
  const { TRACKED_TABLES } = require('../models/statsModel');
  for (const table of TRACKED_TABLES) await rawQuery('SELECT 1 FROM ' + table + ' LIMIT 0');
  return rows[0].version;
}
async function poolEnd() { await pool.end(); }
function getDbConfigInfo() {
  return { maskedHost: maskHost(process.env.DB_HOST), database: settings.dbName(),
    envName: process.env.APP_ENV_NAME || 'LOCAL', maintenanceMode: settings.isReadOnly() };
}
module.exports = { pool, query, rawQuery, withConnection, transaction, ping, poolEnd, getDbConfigInfo };
