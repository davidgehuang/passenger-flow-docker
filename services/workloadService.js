'use strict';

// Web 侧 Continuous Workload 管理器：单例引擎，防止重复 Start，浏览器关闭不停止

const { WorkloadEngine } = require('./workloadEngine');
const { logInfo } = require('../util/logger');
const { boolean } = require('../config/settings');

let engine = null;
let lastMarkerRefresh = 0;
function enabled() {
  return boolean(process.env.ENABLE_CONTINUOUS_WORKLOAD, 'ENABLE_CONTINUOUS_WORKLOAD',
    String(process.env.CONTAINER_RUNTIME).toLowerCase() !== 'true');
}
function disabledStatus() {
  return { state: 'DISABLED', options: null, inflight: 0, stats: null,
    lastError: '多副本部署中持续负载状态不共享；请使用单独的受控 Job 造数' };
}

async function start(options) {
  if (!enabled()) throw Object.assign(new Error(disabledStatus().lastError), { status: 503, code: 'WORKLOAD_DISABLED' });
  if (engine && (engine.pending.size > 0 || ['RUNNING', 'STARTING', 'STOPPING'].includes(engine.state))) {
    throw new Error(`Continuous Workload 已经处于 ${engine.state} 状态，禁止重复启动`);
  }
  engine = new WorkloadEngine();
  return engine.start(options);
}

async function stop() {
  if (!enabled()) return disabledStatus();
  if (!engine) {
    return { state: 'STOPPED', options: null, inflight: 0, stats: null, lastError: null };
  }
  return engine.stop();
}

async function getStatus() {
  if (!enabled()) return disabledStatus();
  if (!engine) {
    return { state: 'STOPPED', options: null, inflight: 0, stats: null, lastError: null };
  }
  // marker 信息刷新节流（30 秒一次）
  const now = Date.now();
  if (now - lastMarkerRefresh > 30000) {
    lastMarkerRefresh = now;
    await engine.refreshMarkerInfo().catch(() => {});
  }
  return engine.getStatus();
}

// 应用退出时优雅停止（app.js graceful shutdown 调用）
async function shutdown() {
  if (engine) {
    logInfo('WORKLOAD', 'application shutting down, stopping workload');
    await stop();
  }
}

module.exports = { start, stop, getStatus, shutdown };
