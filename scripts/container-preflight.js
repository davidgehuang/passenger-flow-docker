'use strict';
const settings = require('../config/settings');
const { databaseErrorDetail, databaseErrorHint } = require('../util/database-error');
async function main() {
  // Validate credentials before any schema/demo write. Never print their values.
  if (!process.env.APP_AUTH_USER || !process.env.APP_AUTH_PASSWORD) throw new Error('必须配置 APP_AUTH_USER 和 APP_AUTH_PASSWORD');
  if (process.env.APP_AUTH_USER.includes(':')) throw new Error('APP_AUTH_USER 不能包含冒号');
  if (!process.env.DB_HOST) throw new Error('必须配置 DB_HOST；本地Compose使用db，AWS使用RDS端点，腾讯云使用TencentDB私网端点');
  if (!process.env.DB_USER || !process.env.DB_PASSWORD) throw new Error('必须配置 DB_USER 和 DB_PASSWORD');
  const seed = settings.boolean(process.env.SEED_DEMO_DATA, 'SEED_DEMO_DATA', false);
  if (seed && settings.isReadOnly()) throw new Error('只读/迁移目标端不能启用 SEED_DEMO_DATA');
  await require('./db-ready').main();
  if (seed) {
    await require('./seed').seed();
    console.log('示例门店和设备已补齐；客流数据需单独生成。');
  }
}
if (require.main === module) {
  main().catch(err => {
    console.error(databaseErrorDetail(err));
    const hint = databaseErrorHint(err); if (hint) console.error(hint);
    process.exitCode = 1;
  }).finally(() => require('../config/database').poolEnd());
}
module.exports = { main };
