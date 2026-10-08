'use strict';
const fs = require('fs');
const settings = require('../config/settings');
const op = process.argv[2];
if (op === 'on') {
  fs.writeFileSync(settings.maintenanceFile(), new Date().toISOString());
  console.log('维护标志已启用，请停止负载并等待在途操作完成。');
} else if (op === 'off') {
  fs.rmSync(settings.maintenanceFile(), { force: true });
  console.log('本目录维护标志已移除；环境变量只读设置仍然有效：' + settings.isReadOnly());
} else if (op === 'status') console.log('只读状态：' + settings.isReadOnly());
else { console.error('用法: npm run maintenance -- on|off|status'); process.exitCode = 2; }
