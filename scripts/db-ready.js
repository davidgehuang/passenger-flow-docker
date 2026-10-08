'use strict';
const {rawQuery,poolEnd}=require('../config/database');
const {TRACKED_TABLES}=require('../models/statsModel');
const {dbName,autoInitSchema}=require('../config/settings');
const {databaseErrorDetail,databaseErrorHint}=require('../util/database-error');
async function missingTables() {
  const rows=await rawQuery('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[dbName()]);
  return TRACKED_TABLES.filter(t=>!rows.some(r=>r.TABLE_NAME===t));
}
async function main(){
  let missing=await missingTables();
  if(missing.length && autoInitSchema()) {
    console.log('检测到缺少业务表：'+missing.join(', ')+'；AUTO_INIT_SCHEMA=true，开始初始化。');
    await require('./db-init').main();
    missing=await missingTables();
  }
  if(missing.length)throw new Error('数据库缺表: '+missing.join(', ')+'；若这是新源端库，请设置 AUTO_INIT_SCHEMA=true 并授予应用账号 CREATE 权限。DTS 目标库应保持 AUTO_INIT_SCHEMA=false，等待 DTS 建表。');
  console.log('数据库可连接，8 张业务表存在');
}
if(require.main===module)main().catch(e=>{console.error(databaseErrorDetail(e));const hint=databaseErrorHint(e);if(hint)console.error(hint);process.exitCode=1;}).finally(poolEnd);
module.exports={main,missingTables};
