'use strict';

// 通用工具：UUID / SHA-256 / 主机掩码 / 数字格式化 / 随机数

const crypto = require('crypto');

function uuid() {
  return crypto.randomUUID();
}

function sha256(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(text).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 主机掩码：仅保留首段前缀与顶级域名，用于页面展示，禁止泄露完整 endpoint
function maskHost(host) {
  if (!host) return '(not configured)';
  const target = String(host).trim();
  const parts = target.split('.');
  if (parts.length >= 3) {
    const first = parts[0].length > 6 ? `${parts[0].slice(0, 6)}***` : `${parts[0]}***`;
    return `${first}.${parts.slice(-2).join('.')}`;
  }
  if (target.length <= 8) return target;
  return `${target.slice(0, 4)}***`;
}

function formatMB(bytes) {
  return (Number(bytes || 0) / (1024 * 1024)).toFixed(2);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(Number(ms || 0) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max, digits = 2) {
  return Number((Math.random() * (max - min) + min).toFixed(digits));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sampleWithoutReplacement(items, count, random = Math.random) {
  const copy = items.slice();
  const n = Math.min(count, copy.length);
  for (let i=0; i<n; i++) {
    const j=i+Math.floor(random()*(copy.length-i));
    [copy[i],copy[j]]=[copy[j],copy[i]];
  }
  return copy.slice(0,n);
}

module.exports = {
  sampleWithoutReplacement,
  uuid,
  sha256,
  sleep,
  maskHost,
  formatMB,
  formatNumber,
  formatDuration,
  randInt,
  randFloat,
  pick,
};
