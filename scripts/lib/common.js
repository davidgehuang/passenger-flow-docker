'use strict';

// CLI 公共工具：参数解析 / 连接池构建 / 检查项输出 / 退出码

const settings = require('../../config/settings');

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const { maskHost } = require('../../util/helpers');

// 解析 --key value 与 --key=value 两种形式（npm 透传: npm run x -- --key value）
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const equals = item.indexOf('=');
    if (equals > 2) { args[item.slice(2, equals)] = item.slice(equals + 1); continue; }
    const key = item.slice(2);
    if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[key] = argv[i + 1];
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

// 独立连接池（不指定 database，用于 db-init 建库场景）
function buildPool({ withDatabase = true } = {}) {
  return settings.configurePool(mysql.createPool({ ...settings.options(withDatabase), multipleStatements: true }));
}

function printHeader(title) {
  console.log('');
  console.log('='.repeat(64));
  console.log(`  ${title}`);
  console.log('='.repeat(64));
  console.log(`  DB Host (masked): ${maskHost(process.env.DB_HOST)}`);
  console.log(`  Database:         ${process.env.DB_NAME || 'passenger_flow_codex'}`);
  console.log(`  Environment:      ${process.env.APP_ENV_NAME || 'LOCAL'}`);
  console.log('-'.repeat(64));
}

function printCheck(name, status, detail = '') {
  const tag =
    status === 'PASS' || status === 'OK' ? '[PASS]  ' : status === 'WARNING' || status === 'WARN' ? '[WARN]  ' : '[FAIL]  ';
  console.log(`${tag}${name}${detail ? ` - ${detail}` : ''}`);
}

function printSection(title) {
  console.log('');
  console.log(`--- ${title} ---`);
}

function formatMb(bytes) {
  return (Number(bytes || 0) / (1024 * 1024)).toFixed(2);
}

function reportsDir() {
  const dir = path.resolve(process.env.REPORTS_DIR || path.join(__dirname, '..', '..', 'reports'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function timestampFile() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function runScript(main) {
  try {
    const code = await main();
    process.exitCode = code === undefined ? (process.exitCode || 0) : code;
  } catch (err) {
    console.error('');
    console.error(`[ERROR] ${err.code ? err.code + ': ' : ''}${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  buildPool,
  printHeader,
  printCheck,
  printSection,
  formatMb,
  reportsDir,
  timestampFile,
  runScript,
};
