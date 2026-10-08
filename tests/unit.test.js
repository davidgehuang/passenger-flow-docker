'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
const {parseArgs}=require('../scripts/lib/common');
const settings=require('../config/settings');
const {compare}=require('../services/compareService');
const {canonical,TABLE_LIST}=require('../services/snapshotService');
const {poolEnd}=require('../config/database');
const {databaseErrorDetail,databaseErrorHint}=require('../util/database-error');
after(poolEnd);
function snapshot(){
  return {formatVersion:2,meta:{consistentSnapshot:true,readOnly:true,runningBatches:0,endpointFingerprint:'source'},
    tables:Object.fromEntries(TABLE_LIST.map(name=>[name,{rowsExact:1,minId:'1',maxId:'1',contentHash:'a'.repeat(64),
      schema:{table:{ENGINE:'InnoDB'},columns:[{COLUMN_NAME:'id'}],indexes:[{INDEX_NAME:'PRIMARY'}]}}]))};
}
test('参数支持空格和等号，保留零值',()=>{
  assert.deepEqual(parseArgs(['--qps=5','--duration','2','--delete-percent=0']),{qps:'5',duration:'2','delete-percent':'0'});
});
test('库名拒绝 SQL 注入和路径字符',()=>{
  const old=process.env.DB_NAME;process.env.DB_NAME='bad\u0060; DROP';
  assert.throws(settings.dbName);if(old===undefined)delete process.env.DB_NAME;else process.env.DB_NAME=old;
});
test('整数边界拒绝小数、Infinity 和负值',()=>{
  for(const value of ['1.5',Infinity,-1,'no'])assert.throws(()=>settings.integer(value,'rows',1,100,10));
  assert.equal(settings.integer('10','rows',1,100,1),10);
});
test('规范 JSON 不受键顺序影响',()=>assert.equal(canonical({b:1,a:{y:2,x:3}}),canonical({a:{x:3,y:2},b:1})));
test('完整的独立停写快照可以通过',()=>{
  const a=snapshot(),b=snapshot();b.meta.endpointFingerprint='target';
  assert.equal(compare(a,b).summary.verdict,'PASS');
});
test('同一数据库不能作为迁移成功证据',()=>assert.equal(compare(snapshot(),snapshot()).summary.exitCode,2));
test('空快照和老格式不能误报 PASS',()=>{
  assert.equal(compare({},{}).summary.verdict,'MISMATCH');
  const a=snapshot();a.formatVersion=1;assert.equal(compare(a,snapshot()).summary.exitCode,1);
});
test('两端都缺表仍必须失败',()=>{
  const a=snapshot(),b=snapshot();delete a.tables.stores;delete b.tables.stores;
  assert.equal(compare(a,b).summary.exitCode,1);
});
test('相同行数不同内容必须失败',()=>{
  const a=snapshot(),b=snapshot();b.tables.stores.contentHash='b'.repeat(64);
  assert.equal(compare(a,b).summary.exitCode,1);
});
test('缺少精确计数不能使用近似值',()=>{
  const a=snapshot(),b=snapshot();delete a.tables.stores.rowsExact;delete b.tables.stores.rowsExact;
  a.tables.stores.rowsApprox=1;b.tables.stores.rowsApprox=1;
  assert.equal(compare(a,b).summary.exitCode,1);
});
test('未停写和未结束批次阻止割接',()=>{
  for(const field of ['readOnly','runningBatches']){const a=snapshot(),b=snapshot();b.meta.endpointFingerprint='target';a.meta[field]=field==='readOnly'?false:1;assert.equal(compare(a,b).summary.exitCode,2);}
});
test('内容相同但结构变化仍失败',()=>{
  const a=snapshot(),b=snapshot();b.tables.stores.schema.columns.push({COLUMN_NAME:'extra'});
  assert.equal(compare(a,b).summary.exitCode,1);
});
test('维护状态禁止模型写入入口',async()=>{
  const old=process.env.MAINTENANCE_MODE;process.env.MAINTENANCE_MODE='true';
  try{await assert.rejects(require('../models/markerModel').create({type:'PRE_DTS'}),/只读/);}
  finally{if(old===undefined)delete process.env.MAINTENANCE_MODE;else process.env.MAINTENANCE_MODE=old;}
});
test('负载允许零比例，并处理启动中停止',async()=>{
  const device=require('../models/deviceModel'),old=device.listForSelection;
  const {WorkloadEngine}=require('../services/workloadEngine');
  let resolve;device.listForSelection=()=>new Promise(r=>{resolve=r;});
  const engine=new WorkloadEngine();
  try{
    const start=engine.start({qps:20,insertPercent:100,updatePercent:0,deletePercent:0});
    await engine.stop();resolve([{device_id:1,store_id:1}]);await start;
    assert.equal(engine.state,'STOPPED');assert.equal(engine.timer,null);assert.equal(engine.options.deletePercent,0);
  }finally{device.listForSelection=old;await engine.stop();}
});
test('负载启动失败可重试',async()=>{
  const device=require('../models/deviceModel'),old=device.listForSelection;
  const {WorkloadEngine}=require('../services/workloadEngine'),engine=new WorkloadEngine();
  try{
    device.listForSelection=async()=>{throw new Error('simulated');};
    await assert.rejects(engine.start(),/simulated/);assert.equal(engine.state,'ERROR');
    device.listForSelection=async()=>[{device_id:1,store_id:1}];
    await engine.start();assert.equal(engine.state,'RUNNING');
  }finally{device.listForSelection=old;await engine.stop();}
});

test('普通运行模式仍拒绝非回环监听',()=>{
 const probe=spawnSync(process.execPath,['-e',"process.env.BIND_HOST='0.0.0.0';process.env.APP_ENV_NAME='LOCAL';process.env.APP_AUTH_USER='admin';process.env.APP_AUTH_PASSWORD='safe';require('./app');"],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
 assert.notEqual(probe.status,0);assert.match(probe.stderr,/非回环监听仅允许生产容器/);
});
test('生产容器允许 Pod 监听，但必须配置认证',()=>{
 const root=path.resolve(__dirname,'..');
 const allowed=spawnSync(process.execPath,['-e',"process.env.NODE_ENV='production';process.env.CONTAINER_RUNTIME='true';process.env.BIND_HOST='0.0.0.0';process.env.APP_AUTH_USER='admin';process.env.APP_AUTH_PASSWORD='safe';require('./app');"],{cwd:root,encoding:'utf8'});
 assert.equal(allowed.status,0,allowed.stderr);
 const denied=spawnSync(process.execPath,['-e',"process.env.NODE_ENV='production';process.env.CONTAINER_RUNTIME='true';process.env.BIND_HOST='0.0.0.0';process.env.APP_AUTH_USER='';process.env.APP_AUTH_PASSWORD='';require('./app');"],{cwd:root,encoding:'utf8'});
 assert.notEqual(denied.status,0);assert.match(denied.stderr,/APP_AUTH_USER/);
});

test('认证错误提示保留 MySQL 诊断且不输出密码',()=>{
 const err={code:'ER_ACCESS_DENIED_ERROR',sqlMessage:"Access denied for user 'pflow'@'10.10.10.11' (using password: YES)"};
 assert.match(databaseErrorDetail(err),/ER_ACCESS_DENIED_ERROR/);assert.match(databaseErrorHint(err),/DB_USER/);
});

test('AUTO_INIT_SCHEMA 默认启用，并拒绝无效配置',()=>{
 const old=process.env.AUTO_INIT_SCHEMA;
 try{delete process.env.AUTO_INIT_SCHEMA;assert.equal(settings.autoInitSchema(),true);process.env.AUTO_INIT_SCHEMA='false';assert.equal(settings.autoInitSchema(),false);process.env.AUTO_INIT_SCHEMA='bad';assert.throws(settings.autoInitSchema,/true 或 false/);}
 finally{if(old===undefined)delete process.env.AUTO_INIT_SCHEMA;else process.env.AUTO_INIT_SCHEMA=old;}
});

test('生成容量计划在 20 万行上限内写入足额逻辑负载',()=>{
 const {generatePlan,generatedMetadata}=require('../services/migrationLabService')._internal;
 const plan=generatePlan(100);
 assert.equal(plan.rows,200000);assert.equal(plan.logicalBytesPerRow,525);assert.ok(plan.logicalPayloadBytes>=100*1024*1024);
 const payload=generatedMetadata(plan.logicalBytesPerRow,'test-seed');
 assert.equal(Buffer.byteLength(payload,'utf8'),plan.logicalBytesPerRow);
});

test('Basic Auth 配置缺一项时拒绝启动，避免无声关闭认证',()=>{
 const probe=spawnSync(process.execPath,['-e',"process.env.BIND_HOST='127.0.0.1';process.env.APP_ENV_NAME='LOCAL';process.env.APP_AUTH_USER='admin';process.env.APP_AUTH_PASSWORD='';require('./app');"],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
 assert.notEqual(probe.status,0);assert.match(probe.stderr,/必须同时填写/);
});
test('负载停止后运行时长固定',async()=>{
 const {WorkloadEngine}=require('../services/workloadEngine'),engine=new WorkloadEngine();
 engine.stats={startedAt:new Date(Date.now()-5000).toISOString(),successSql:1};
 await engine.stop();const first=engine.getStatus().stats.runtimeMs;
 await new Promise(r=>setTimeout(r,30));assert.equal(engine.getStatus().stats.runtimeMs,first);
});
