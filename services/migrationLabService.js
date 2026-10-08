'use strict';
const mysql = require('mysql2/promise');
const { rawQuery, transaction } = require('../config/database');
const { integer, assertWritable } = require('../config/settings');
const devices = require('../models/deviceModel');
const batch = require('../models/batchModel');
const audit = require('../models/auditModel');
const markers = require('../models/markerModel');
const stats = require('../models/statsModel');
const metrics = require('./metricsService');
const { uuid, randInt, pick, sha256, sampleWithoutReplacement } = require('../util/helpers');
const MAX_CUSTOM_ROWS = 200000;
const DEFAULT_LOGICAL_BYTES_PER_ROW = 512;
function rowCount(n) { return integer(n,'rows',1,MAX_CUSTOM_ROWS,1000); }
function generatedMetadata(targetBytes, seed) {
  const base = { source: 'migration-lab', generator: 'logical-size-v1', logical_payload_bytes: targetBytes, payload: '' };
  const overhead = Buffer.byteLength(JSON.stringify(base), 'utf8');
  const payloadLength = Math.max(0, targetBytes - overhead);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let state = Number.parseInt(sha256(seed).slice(0, 8), 16) || 1;
  const chars = new Array(payloadLength);
  for (let index = 0; index < payloadLength; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    chars[index] = alphabet[state & 63];
  }
  return JSON.stringify({ ...base, payload: chars.join('') });
}
function generatePlan(targetMB) {
  const mb = integer(targetMB, 'targetMB', 1, 2000, 10);
  const targetBytes = mb * 1024 * 1024;
  const rows = Math.min(MAX_CUSTOM_ROWS, Math.ceil(targetBytes / DEFAULT_LOGICAL_BYTES_PER_ROW));
  const logicalBytesPerRow = Math.max(DEFAULT_LOGICAL_BYTES_PER_ROW, Math.ceil(targetBytes / rows));
  return { mb, targetBytes, rows, logicalBytesPerRow, logicalPayloadBytes: rows * logicalBytesPerRow };
}
function auditRow(batchUuid, op, before, after) {
  const row=after || before;
  return [batchUuid,op,'flow_events',row.id,row.trace_id,before?JSON.stringify(before):null,after?JSON.stringify(after):null];
}
async function applyHourly(rows, sign) {
  const groups=new Map();
  for(const row of rows) {
    const date=String(row.event_time).slice(0,10),hour=Number(String(row.event_time).slice(11,13));
    const key=row.store_id+'|'+date+'|'+hour;
    if(!groups.has(key))groups.set(key,[row.store_id,date,hour,0,0,0]);
    const g=groups.get(key),count=Number(row.people_count)*sign;
    g[row.direction==='IN'?3:4]+=count;g[5]+=count;
  }
  for(const key of [...groups.keys()].sort()) {
    const g=groups.get(key);
    await rawQuery('INSERT INTO flow_hourly (store_id,stat_date,stat_hour,in_count,out_count,peak_count) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE in_count=in_count+VALUES(in_count),out_count=out_count+VALUES(out_count),peak_count=peak_count+VALUES(peak_count)',g);
  }
}
async function chunkTransaction(fn) {
  for(let attempt=0;;attempt++){
    try{return await transaction(fn);}
    catch(e){if(attempt>=3 || !['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,30*(attempt+1)));}
  }
}
async function operate(op,n,{label=op,historyDays=0,logicalBytesPerRow=0}={}) {
  assertWritable();
  const total=rowCount(n),started=Date.now();
  const metadataBytes=integer(logicalBytesPerRow,'logicalBytesPerRow',0,65536,0);
  const available=op==='INSERT'?await devices.listForSelection():[];
  if(op==='INSERT' && !available.length)throw new Error('没有设备，请先执行 npm run db:seed');
  const batchUuid=await batch.create({name:label+' '+total+' rows',operationType:op,targetRows:total});
  let affected=0,minId=null,maxId=null,cursor=null;const sampleIds=[];
  try {
    while(affected<total) {
      assertWritable();
      const count=Math.min(250,total-affected);
      const result=await chunkTransaction(async()=>{
        let before=[],after=[];
        if(op==='INSERT') {
          const selected=await rawQuery('SELECT d.device_id,d.store_id FROM devices d JOIN stores s ON s.store_id=d.store_id ORDER BY d.device_id FOR SHARE').catch(async e=>{if(e.code==='ER_PARSE_ERROR')return rawQuery('SELECT d.device_id,d.store_id FROM devices d JOIN stores s ON s.store_id=d.store_id ORDER BY d.device_id LOCK IN SHARE MODE');throw e;});
          if(!selected.length)throw new Error('没有有效的门店设备关联');
          const payload=[];
          for(let i=0;i<count;i++){
            const d=pick(selected), traceId=uuid();
            const metadata=metadataBytes ? generatedMetadata(metadataBytes, traceId) : JSON.stringify({source:'migration-lab'});
            payload.push([d.store_id,d.device_id,mysql.raw('DATE_SUB(NOW(6), INTERVAL '+randInt(0,integer(historyDays,'historyDays',0,365,0)*86400)+' SECOND)'),Math.random()<0.55?'IN':'OUT',randInt(1,5),99,'CAMERA',traceId,metadata]);
          }
          await rawQuery('INSERT INTO flow_events (store_id,device_id,event_time,direction,people_count,confidence,sensor_type,trace_id,metadata) VALUES ?',[payload]);
          after=await rawQuery('SELECT * FROM flow_events WHERE trace_id IN (?) ORDER BY id',[payload.map(r=>r[7])]);
          if(after.length!==count)throw new Error('插入后行数不一致');
          await applyHourly(after,1);
          const logRows=sampleWithoutReplacement(selected,Math.min(10,Math.floor(count/8))).map(d=>[d.device_id,mysql.raw('NOW(6)'),25,40,10,35,'NORMAL','simulated heartbeat',JSON.stringify({source:'migration-lab'})]);
          if(logRows.length)await rawQuery('INSERT INTO device_status_logs (device_id,log_time,cpu_usage,memory_usage,network_latency,temperature,status,message,metadata) VALUES ?',[logRows]);
        }else{
          const clause=cursor===null?'':'WHERE id < ? ';
          before=await rawQuery('SELECT * FROM flow_events '+clause+'ORDER BY id DESC LIMIT ? FOR UPDATE',cursor===null?[count]:[cursor,count]);
          if(!before.length)return {rows:[],count:0};
          if(op==='UPDATE'){
            for(const row of before)await rawQuery('UPDATE flow_events SET people_count=people_count+1,metadata=? WHERE id=?',[JSON.stringify({source:'migration-lab',revised:uuid()}),row.id]);
            after=await rawQuery('SELECT * FROM flow_events WHERE id IN (?) ORDER BY id DESC',[before.map(r=>r.id)]);
            await applyHourly(before,-1);await applyHourly(after,1);
          }else{
            const result=await rawQuery('DELETE FROM flow_events WHERE id IN (?)',[before.map(r=>r.id)]);
            if(result.affectedRows!==before.length)throw new Error('删除行数发生变化');
            await applyHourly(before,-1);
          }
        }
        const current=op==='INSERT'?after:before;
        const afterById=new Map(after.map(r=>[String(r.id),r]));
        const auditRows=current.slice(0,10).map(r=>auditRow(batchUuid,op,op==='INSERT'?null:r,op==='DELETE'?null:afterById.get(String(r.id))));
        await audit.insertBatch(auditRows);
        await rawQuery('UPDATE migration_batches SET affected_rows=affected_rows+? WHERE batch_uuid=?',[current.length,batchUuid]);
        return {rows:current,count:current.length};
      });
      if(!result.count)break;
      affected+=result.count;
      if(op==='INSERT')metrics.recordFlowInserted(result.count);
      for(const r of result.rows){if(minId===null||BigInt(r.id)<BigInt(minId))minId=String(r.id);if(maxId===null||BigInt(r.id)>BigInt(maxId))maxId=String(r.id);}
      if(op!=='INSERT')cursor=String(result.rows[result.rows.length-1].id);
      sampleIds.push(...result.rows.slice(0,10).map(r=>String(r.id)));
    }
    const logicalPayloadBytes=metadataBytes*affected;
    await batch.complete(batchUuid,{affectedRows:affected,status:'COMPLETED',notes:('请求 '+total+'，实际不同事件 '+affected+(metadataBytes?'；逻辑 metadata '+logicalPayloadBytes+' 字节':''))});
    return {operation:op,batchUuid,requestedRows:total,insertedRows:op==='INSERT'?affected:0,updatedRows:op==='UPDATE'?affected:0,deletedRows:op==='DELETE'?affected:0,
      logicalBytesPerRow:metadataBytes||undefined,logicalPayloadBytes:metadataBytes?logicalPayloadBytes:undefined,
      deviceLogUpdated:0,minId,maxId,idRange:affected?{minId,maxId}:null,sampleIds,elapsedMs:Date.now()-started,startedAt:new Date(started).toISOString(),endedAt:new Date().toISOString()};
  }catch(e){
    await batch.fail(batchUuid,('已提交事件 '+affected+'；'+e.message).slice(0,500)).catch(()=>{});
    throw e;
  }
}
const insertRows=(n,o)=>operate('INSERT',n,o);
const updateRows=(n,o)=>operate('UPDATE',n,o);
const deleteRows=(n,o)=>operate('DELETE',n,o);
async function generateSize(targetMB,{historyDays=0}={}) {
  assertWritable();
  const plan=generatePlan(targetMB);
  const before=await stats.databaseStorage().catch(()=>null);
  const result=await insertRows(plan.rows,{label:'GENERATE_LOGICAL_'+plan.mb+'MB',logicalBytesPerRow:plan.logicalBytesPerRow,historyDays});
  const after=await stats.databaseStorage().catch(()=>null);
  return {...result,operation:'GENERATE',targetMB:plan.mb,targetBytes:plan.targetBytes,maxRows:plan.rows,
    logicalBytesPerRow:plan.logicalBytesPerRow,logicalPayloadBytes:plan.logicalPayloadBytes,
    measuredTableStorageGrowthMB:before&&after?Number(((after.bytes-before.bytes)/1048576).toFixed(2)):null,tableStorageSource:after?.source||null,
    storageStatus:before&&after?'ok':'unavailable',
    note:'已写入指定逻辑 metadata 负载；RDS 实例实际可用空间请以 CloudWatch FreeStorageSpace 为准'};
}
async function purgeSize(targetMB) {
  const mb=integer(targetMB,'targetMB',1,2000,10);
  const result=await deleteRows(Math.min(MAX_CUSTOM_ROWS,Math.ceil(mb*1048576/512)),{label:'PURGE_ESTIMATE'});
  return {...result,operation:'PURGE',targetMB:mb,note:'按 512 字节/行估算；DELETE 不保证归还物理磁盘空间'};
}
async function createMarker(type,message='',rowReference=null) { assertWritable();return markers.create({type,message,operationType:'MARKER',rowReference}); }
async function getOverview(){
  const [dbVersion,storageResult,currentBatch,lastBatches]=await Promise.all([
    stats.mysqlVersion(),require('./storageService').get(),batch.currentBatch(),batch.latest(1)]);
  const last=lastBatches[0];
  return {environment:process.env.APP_ENV_NAME||'LOCAL',appVersion:process.env.APP_VERSION||'',
    dbVersion,storageResult,exactCounts:storageResult.sample?.exactCounts||null,currentBatch,
    lastDbOp:last?last.operation_type+' ('+last.status+') @ '+(last.completed_at||last.started_at):'-'};
}
async function getMigrationCheckData(){
  const [dbVersion,storageResult]=await Promise.all([stats.mysqlVersion(),require('./storageService').get()]);
  return {dbVersion,storageResult,tableStats:storageResult.sample?.tables||[]};
}
module.exports={insertRows,updateRows,deleteRows,generateSize,purgeSize,createMarker,getOverview,getMigrationCheckData,MAX_CUSTOM_ROWS,_internal:{sha256,applyHourly,generatedMetadata,generatePlan}};
