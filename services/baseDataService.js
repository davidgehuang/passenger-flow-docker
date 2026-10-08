'use strict';
const crypto = require('crypto');
const db = require('../config/database');
const settings = require('../config/settings');
const { sha256 } = require('../util/helpers');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function number(value, name, max) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw fail(name + ' 必须是 1–' + max + ' 的整数');
  return Number(value);
}
function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('参数必须为对象');
  if (!['ensure', 'append'].includes(input.mode)) throw fail('mode 必须为 ensure 或 append');
  const requestId = String(input.requestId || crypto.randomUUID()).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) throw fail('requestId 必须为 UUID');
  const perStore = number(input.devicesPerStore, '每店设备数', 100);
  const ids = input.storeIds === undefined ? [] : (Array.isArray(input.storeIds) ? input.storeIds : String(input.storeIds).split(','));
  const storeIds = [...new Set(ids.map(v => number(v, '门店 ID', Number.MAX_SAFE_INTEGER)))].sort((a,b)=>a-b);
  if (storeIds.length > 500) throw fail('最多选择 500 家门店');
  if (storeIds.length && (input.mode !== 'append' || input.stores !== undefined && input.stores !== null)) throw fail('指定门店仅支持追加，不能同时设置门店数量');
  const stores = storeIds.length ? null : number(input.stores, '门店数', 500);
  return {mode:input.mode, stores, devicesPerStore:perStore, storeIds, requestId};
}
async function snapshot(conn, lock = false) {
  const [stores] = await conn.query('SELECT * FROM stores ORDER BY store_id' + (lock ? ' FOR UPDATE' : ''));
  const [devices] = await conn.query('SELECT * FROM devices ORDER BY device_id' + (lock ? ' FOR UPDATE' : ''));
  return {stores, devices};
}
function plan(params, state) {
  const counts = new Map(state.stores.map(s => [Number(s.store_id), 0]));
  for (const d of state.devices) counts.set(Number(d.store_id), (counts.get(Number(d.store_id)) || 0) + 1);
  if (params.storeIds.some(id => !state.stores.some(s => Number(s.store_id) === id))) throw fail('所选门店不存在');
  const addStores = params.mode === 'ensure' ? Math.max(0, params.stores - state.stores.length) : (params.storeIds.length ? 0 : params.stores);
  const existing = params.mode === 'ensure' ? state.stores.map(s=>Number(s.store_id)) : params.storeIds;
  const additions = existing.map(id => ({id, count:params.mode === 'ensure' ? Math.max(0, params.devicesPerStore - counts.get(id)) : params.devicesPerStore}));
  const addDevices = addStores * params.devicesPerStore + additions.reduce((sum,s)=>sum+s.count,0);
  const before = {stores:state.stores.length, devices:state.devices.length};
  const after = {stores:before.stores+addStores, devices:before.devices+addDevices};
  if (after.stores > 500 || after.devices > 5000) throw fail('预计完成后超过批量工具范围（500 家门店 / 5,000 台设备）；不会删除已有资料');
  return {before, added:{stores:addStores,devices:addDevices}, after, additions};
}
async function preview(input) {
  const params = normalize(input);
  return db.transaction(async conn => {
    const [[previous]] = await conn.query('SELECT operation_type,notes,status FROM migration_batches WHERE batch_uuid=?',[params.requestId]);
    if(previous){
      let saved;try{saved=JSON.parse(previous.notes);}catch{throw fail('批次号冲突',409);}
      if(previous.operation_type!=='BASE_DATA'||previous.status!=='COMPLETED'||saved.fingerprint!==sha256(params))throw fail('批次号已使用且参数不同',409);
      return {params,...saved.result,replayed:true,previewToken:'replay'};
    }
    const state = await snapshot(conn);
    const result = plan(params,state);delete result.additions;
    return {params, ...result, previewToken:sha256({params,state})};
  }, {readOnly:true});
}
async function execute(input) {
  settings.assertWritable();
  const params = normalize(input);
  if (!input.requestId) throw fail('执行必须使用预览返回的 requestId');
  const fingerprint = sha256(params);
  return db.withConnection(async conn => {
    const lock = 'pf-base-' + sha256(settings.dbName()).slice(0,40);
    const [[acquired]] = await conn.query('SELECT GET_LOCK(?, 10) AS acquired',[lock]);
    if (Number(acquired.acquired) !== 1) throw fail('其他扩容操作尚未完成，请使用原批次号重试',409);
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conn.beginTransaction();
      try {
        const [[previous]] = await conn.query('SELECT operation_type,notes,status FROM migration_batches WHERE batch_uuid=?',[params.requestId]);
        if (previous) {
          let saved; try { saved=JSON.parse(previous.notes); } catch { throw fail('批次号已被其他操作使用',409); }
          if (previous.operation_type !== 'BASE_DATA' || previous.status !== 'COMPLETED' || saved.fingerprint !== fingerprint) throw fail('批次号已使用且参数不同，请核对原批次',409);
          await conn.commit();return {...saved.result, requestId:params.requestId, replayed:true};
        }
        const state = await snapshot(conn,true);
        if (!input.previewToken || input.previewToken !== sha256({params,state})) throw fail('预览后资料已变化，请重新预览后执行（保留原批次号）',409);
        const result = plan(params,state);
        const suffix = params.requestId.replaceAll('-','');
        const rows = Array.from({length:result.added.stores},(_,i)=>['BS-'+suffix+'-'+(i+1),'模拟门店-'+suffix.slice(0,8)+'-'+(i+1),'ACTIVE']);
        for (let i=0;i<rows.length;i+=250) await conn.query('INSERT INTO stores (store_code,store_name,status) VALUES ?',[rows.slice(i,i+250)]);
        if (rows.length) {
          const [created] = await conn.query('SELECT store_id FROM stores WHERE store_code IN (?) ORDER BY store_id',[rows.map(r=>r[0])]);
          result.additions.push(...created.map(s=>({id:s.store_id,count:params.devicesPerStore})));
        }
        const deviceRows=[];
        for (const s of result.additions) for (let i=0;i<s.count;i++) {
          const index=deviceRows.length+1;
          deviceRows.push(['BD-'+suffix+'-'+index,s.id,'模拟设备-'+suffix.slice(0,8)+'-'+index,'ENTRANCE_CAMERA','ONLINE']);
        }
        for(let i=0;i<deviceRows.length;i+=250) await conn.query('INSERT INTO devices (device_code,store_id,device_name,device_type,status,last_online_time) VALUES ' + deviceRows.slice(i,i+250).map(()=>'(?,?,?,?,?,NOW(6))').join(','),deviceRows.slice(i,i+250).flat());
        const saved = {before:result.before,added:result.added,after:result.after};
        settings.assertWritable();
        await conn.query("INSERT INTO migration_batches (batch_uuid,batch_name,operation_type,source_env,target_rows,affected_rows,status,completed_at,notes) VALUES (?,?,'BASE_DATA',?,?,?,'COMPLETED',NOW(6),?)",[params.requestId,'基础资料 '+params.mode,process.env.APP_ENV_NAME||'LOCAL',deviceRows.length+rows.length,deviceRows.length+rows.length,JSON.stringify({fingerprint,result:saved})]);
        await conn.commit();
        require('./storageService').invalidate();
        return {...saved,requestId:params.requestId,replayed:false};
      } catch(e) {
        await conn.rollback();
        if(e.code === 'ER_DUP_ENTRY')throw fail('模拟编码或批次号冲突，整个批次已回滚；请核对记录后使用新批次号',409);
        throw e;
      }
    } finally { await conn.query('SELECT RELEASE_LOCK(?)',[lock]); }
  });
}
module.exports = {normalize,plan,preview,execute};
