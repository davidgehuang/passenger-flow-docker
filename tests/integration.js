'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {spawnSync}=require('child_process');
const mysql=require('mysql2/promise'),settings=require('../config/settings');
const root=path.resolve(__dirname,'..'),report={startedAt:new Date().toISOString(),checks:[]};
const check=(name,detail)=>{report.checks.push({name,status:'PASS',detail});console.log('PASS '+name);};
async function main(){
  if(!['127.0.0.1','localhost','::1'].includes(process.env.DB_HOST||'127.0.0.1') && process.env.ALLOW_REMOTE_TESTS!=='isolated-databases')throw new Error('远程集成测试需明确授权 ALLOW_REMOTE_TESTS=isolated-databases；只创建本次 pf_test_* 测试库');
  if(settings.isReadOnly())throw new Error('集成测试需要独立可写测试环境；当前只读');
  const admin=await mysql.createConnection(settings.options(false));
  const suffix=Date.now(),source='pf_test_'+suffix,target='pf_test_target_'+suffix;
  report.databases={source,target};
  let server,db;
  try{
    const [[info]]=await admin.query('SELECT VERSION() AS version');report.databaseVersion=info.version;
    assert.match(info.version,/^(8\.[04]\.|10\.3\.39[-.])/);
    const schema=fs.readFileSync(path.join(root,'db/schema.sql'),'utf8').split('INSERT INTO stores')[0];
    // 逐条执行固定的项目 DDL；测试数据库均为本轮唯一名称。
    for(const name of [source,target]){
      const sql=schema.replaceAll('passenger_flow_codex',name);
      for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await admin.query(statement);
    }
    process.env.DB_NAME=source;
    process.env.APP_ENV_NAME='LOCAL';
    db=require('../config/database');
    const lab=require('../services/migrationLabService');
    await require('../scripts/seed').seed();await require('../scripts/seed').seed();
    assert.equal(Number((await db.rawQuery('SELECT COUNT(*) AS n FROM stores'))[0].n),5);
    assert.equal(Number((await db.rawQuery('SELECT COUNT(*) AS n FROM devices'))[0].n),10);check('初始化与种子数据可重复执行');
    const inserted=await lab.insertRows(1250);assert.equal(inserted.insertedRows,1250);check('真实 INSERT 1250 条');
    const before=await db.rawQuery('SELECT id,people_count FROM flow_events');
    const updated=await lab.updateRows(1200);assert.equal(updated.updatedRows,1200);
    const after=await db.rawQuery('SELECT id,people_count FROM flow_events');
    const old=new Map(before.map(r=>[r.id,r.people_count]));
    assert.equal(after.filter(r=>r.people_count!==old.get(r.id)).length,1200);check('UPDATE 1200 条不同记录');
    const removed=await lab.deleteRows(200);assert.equal(removed.deletedRows,200);
    assert.equal(Number((await db.rawQuery('SELECT COUNT(*) AS n FROM flow_events'))[0].n),1050);check('DELETE 实际行数');
    const audit=require('../models/auditModel'),insertAudit=audit.insertBatch;
    audit.insertBatch=async()=>{throw new Error('simulated audit failure');};
    try{await assert.rejects(lab.insertRows(5),/simulated audit failure/);}
    finally{audit.insertBatch=insertAudit;}
    assert.equal(Number((await db.rawQuery('SELECT COUNT(*) AS n FROM flow_events'))[0].n),1050);check('审计失败时事件与汇总事务回滚');
    const marker=require('../models/markerModel');
    const marks=await Promise.all(Array.from({length:20},(_,i)=>marker.create({type:'DURING_DTS',message:'parallel-'+i})));
    assert.equal(new Set(marks.map(m=>String(m.sequence))).size,20);check('20 个并发 Marker 序号唯一');
    const {WorkloadEngine}=require('../services/workloadEngine'),engine=new WorkloadEngine();
    await engine.start({qps:30,insertPercent:100,updatePercent:0,deletePercent:0});
    await new Promise(r=>setTimeout(r,2200));const stopped=await engine.stop();
    assert.equal(stopped.inflight,0);assert.equal(stopped.stats.failedSql,0);assert.ok(stopped.stats.totalInsert>20);
    check('持续负载超过原调度上限且零比例生效',stopped.stats);
    const [[flow]]=await admin.query('SELECT SUM(people_count) AS n FROM '+source+'.flow_events');
    const [[hourly]]=await admin.query('SELECT SUM(in_count+out_count) AS n FROM '+source+'.flow_hourly');
    assert.equal(String(flow.n),String(hourly.n));check('小时汇总与事件总人数一致');
    const app=require('../app');server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const base='http://127.0.0.1:'+server.address().port;
    const urls=['/','/stores','/stores/new','/stores/1','/stores/1/edit','/devices','/devices/1','/devices/1/edit','/flow-events','/migration-check','/migration-lab','/migration-lab/status','/system-health','/health'];
    for(const url of urls){const r=await fetch(base+url);assert.equal(r.status,200,url+' '+(r.status!==200?await r.text():''));}
    check('14 个页面与接口返回 200');
    const post=(url,data={})=>fetch(base+url,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    assert.equal((await post('/devices/999999999',{})).status,404);
    assert.equal((await post('/devices',{device_code:'NO_STORE',device_name:'invalid',store_id:999999999})).status,400);
    assert.equal((await post('/stores',{store_code:'CRUD_STORE',store_name:'CRUD test'})).status,302);
    const [crudStore]=await db.rawQuery("SELECT store_id FROM stores WHERE store_code='CRUD_STORE'");
    assert.equal((await post('/devices',{device_code:'CRUD_DEVICE',device_name:'CRUD device',store_id:crudStore.store_id})).status,302);
    const [crudDevice]=await db.rawQuery("SELECT device_id FROM devices WHERE device_code='CRUD_DEVICE'");
    assert.equal((await post('/stores/'+crudStore.store_id+'/delete')).status,409);
    assert.equal((await post('/devices/'+crudDevice.device_id,{device_name:'updated',store_id:crudStore.store_id})).status,302);
    assert.equal((await post('/devices/'+crudDevice.device_id+'/delete')).status,302);
    assert.equal((await post('/stores/'+crudStore.store_id+'/delete')).status,302);
    check('门店设备增改删、关联保护、无效门店与不存在设备边界');

    for(const url of ['/stores?page=1.5','/stores?page=Infinity','/flow-events?dateFrom=2026-02-31','/devices?keyword[]=x']){
      assert.equal((await fetch(base+url)).status,400,url);
    }
    check('非法分页和日期返回 400');
    const cross=await fetch(base+'/stores',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://different.invalid'},body:'{}'});assert.equal(cross.status,403);check('跨站写入被拒绝');
    process.env.APP_AUTH_USER='test';process.env.APP_AUTH_PASSWORD='temporary-test-only';
    assert.equal((await fetch(base+'/stores')).status,401);
    assert.equal((await fetch(base+'/stores',{headers:{Authorization:'Basic '+Buffer.from('test:temporary-test-only').toString('base64')}})).status,200);
    delete process.env.APP_AUTH_USER;delete process.env.APP_AUTH_PASSWORD;check('认证保护生效');
    process.env.MAINTENANCE_MODE='true';
    const denied=await fetch(base+'/migration-lab/insert',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"rows":1}'});assert.equal(denied.status,503);
    await assert.rejects(lab.insertRows(1),/只读/);
    assert.equal((await fetch(base+'/migration-lab/workload/stop',{method:'POST'})).status,200);check('维护模式拦截写入但允许停止负载');
    const snapshot=require('../services/snapshotService');
    const sourceSnapshot=await snapshot.collect();assert.equal(Object.keys(sourceSnapshot.tables).length,8);
    // 手工克隆仅用于本地校验器验收，不模拟或冒充 DTS。
    for(const name of snapshot.TABLE_LIST){
      const [rows]=await admin.query('SELECT * FROM '+source+'.'+name);
      if(rows.length){
        const columns=Object.keys(rows[0]),values=rows.map(r=>columns.map(k=>r[k]&&typeof r[k]==='object'?JSON.stringify(r[k]):r[k]));
        await admin.query('INSERT INTO '+target+'.'+name+' ('+columns.map(k=>'\u0060'+k+'\u0060').join(',')+') VALUES ?',[values]);
      }
    }
    function targetSnapshot(){
      const r=spawnSync(process.execPath,['-e',"require('./services/snapshotService').collect().then(s=>console.log(JSON.stringify(s))).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>require('./config/database').poolEnd())"],
        {cwd:root,env:{...process.env,DB_NAME:target,MAINTENANCE_MODE:'true'},windowsHide:true,encoding:'utf8',timeout:60000});
      if(r.status!==0)throw new Error('目标快照失败 '+r.stderr);return JSON.parse(r.stdout);
    }
    const {compare}=require('../services/compareService');
    const cloned=targetSnapshot();let comparison=compare(sourceSnapshot,cloned);
    if(comparison.summary.exitCode!==0)console.log(comparison.results.filter(x=>x.status!=='PASS'));
    assert.equal(comparison.summary.exitCode,0);check('两个独立测试库全表快照一致');
    await admin.query("UPDATE "+target+".stores SET address='deliberate mismatch' WHERE store_id=1");
    comparison=compare(sourceSnapshot,targetSnapshot());assert.equal(comparison.summary.exitCode,1);check('行数不变的内容篡改被检测');
    await admin.query('ALTER TABLE '+target+'.devices ADD COLUMN extra_test INT NULL');
    comparison=compare(sourceSnapshot,targetSnapshot());assert.equal(comparison.summary.exitCode,1);check('结构差异被检测');
    delete process.env.MAINTENANCE_MODE;process.env.DB_READ_ONLY='false';
    const statModel=require('../models/statsModel'),originalStorage=statModel.databaseStorage;
    statModel.databaseStorage=async()=>{throw Object.assign(new Error('stats only failure'),{code:'STATS_TEST'});};
    try{const generated=await lab.generateSize(1);assert.equal(generated.insertedRows,2048);assert.equal(generated.storageStatus,'unavailable');}
    finally{statModel.databaseStorage=originalStorage;}
    check('容量查询失败不把已成功提交的造数标记为失败');
    report.status='PASS';
  }finally{
    delete process.env.MAINTENANCE_MODE;
    if(server)await new Promise(resolve=>server.close(resolve));
    if(db)await db.poolEnd();
    await admin.end();
    report.note='测试数据库已保留供审阅；未修改既有业务库。两个库的数据复制是测试夹具，不是 DTS 迁移验证。';
  }
}
main().catch(e=>{report.status='FAIL';report.error=e.message;console.error(e.stack);process.exitCode=1;}).finally(()=>{
  report.finishedAt=new Date().toISOString();fs.mkdirSync(path.join(root,'reports'),{recursive:true});
  fs.writeFileSync(path.join(root,'reports','integration-'+Date.now()+'.json'),JSON.stringify(report,null,2));
});
