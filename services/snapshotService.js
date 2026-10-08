'use strict';
const crypto = require('crypto');
const { transaction, rawQuery } = require('../config/database');
const { dbName, isReadOnly } = require('../config/settings');
const { TRACKED_TABLES } = require('../models/statsModel');
const { maskHost } = require('../util/helpers');
const ID_COLUMN_MAP={stores:'store_id',devices:'device_id',flow_events:'id',flow_hourly:'id',device_status_logs:'id',migration_markers:'id',migration_batches:'id',migration_operation_audit:'id'};
function canonical(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
async function collect(){
  return transaction(async()=>{
    const [version]=await rawQuery('SELECT VERSION() AS version');
    const tables={};
    for(const name of TRACKED_TABLES){
      const columns=await rawQuery('SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[dbName(),name]);
      if(!columns.length)throw new Error('缺少表 '+name);
      const indexes=await rawQuery('SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX',[dbName(),name]);
      const [table]=await rawQuery('SELECT ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',[dbName(),name]);
      if(table.ENGINE!=='InnoDB')throw new Error('一致性快照要求 InnoDB: '+name);
      const hash=crypto.createHash('sha256');
      let cursor=null,rowsExact=0,minId=null,maxId=null;
      const key=ID_COLUMN_MAP[name];
      for(;;){
        const rows=await rawQuery('SELECT * FROM '+name+(cursor===null?'':' WHERE '+key+' > ?')+' ORDER BY '+key+' LIMIT 1000',cursor===null?[]:[cursor]);
        if(!rows.length)break;
        for(const row of rows){
          // mysql2 将 MySQL JSON 转为对象；MariaDB 返回文本。只规范已知 JSON 列。
          for(const c of ['metadata','before_value','after_value'])if(typeof row[c]==='string'){try{row[c]=JSON.parse(row[c]);}catch{/* 非JSON保持原值 */}}
          hash.update(canonical(row)+'\n');rowsExact++;
          if(minId===null)minId=String(row[key]);maxId=String(row[key]);
        }
        cursor=maxId;
      }
      tables[name]={rowsExact,minId,maxId,contentHash:hash.digest('hex'),schema:{table,columns,indexes}};
    }
    const [running]=await rawQuery("SELECT COUNT(*) AS n FROM migration_batches WHERE status='RUNNING'");
    const [failed]=await rawQuery("SELECT COUNT(*) AS n FROM migration_batches WHERE status='FAILED'");
    return {formatVersion:2,meta:{generatedAt:new Date().toISOString(),environment:process.env.APP_ENV_NAME||'LOCAL',
      database:dbName(),maskedHost:maskHost(process.env.DB_HOST),mysqlVersion:version.version,readOnly:isReadOnly(),
      runningBatches:Number(running.n),failedBatches:Number(failed.n),consistentSnapshot:true,
      endpointFingerprint:crypto.createHash('sha256').update([process.env.DB_HOST||'127.0.0.1',process.env.DB_PORT||3306,dbName()].join(':')).digest('hex')},
      tableList:TRACKED_TABLES,tables,scope:'8 张表全部列、全部行、列和索引结构；物理页大小不参与一致性判定'};
  },{readOnly:true});
}
module.exports={collect,canonical,TABLE_LIST:TRACKED_TABLES,ID_COLUMN_MAP};
