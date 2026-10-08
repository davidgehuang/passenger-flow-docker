'use strict';

// 轻量日志模块：INFO / WARN / ERROR 三级，禁止在任何日志中输出密码与凭据

function timestamp() {
  return new Date().toISOString();
}

function logInfo(tag, message) {
  console.log(`[${timestamp()}] [INFO] [${tag}] ${message}`);
}

function logWarn(tag, message) {
  console.warn(`[${timestamp()}] [WARN] [${tag}] ${message}`);
}

function logError(tag, message) {
  console.error(`[${timestamp()}] [ERROR] [${tag}] ${message}`);
}

module.exports = { logInfo, logWarn, logError };
