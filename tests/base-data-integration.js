/* global document */
'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawnSync}=require('child_process');
const mysql=require('mysql2/promise'),settings=require('../config/settings');
const report={startedAt:new Date().toISOString(),checks:[]};
const check=(name,detail)=>{report.checks.push({name,detail});console.log('PASS '+name);};
async function main(){
  if(!['127.0.0.1','localhost','::1'].includes(process.env.DB_HOST))throw new Error('只允许本地独立测试库');
  const admin=await mysql.createConnection(settings.options(false));let db,server;
  const name='pf_base_'+Date.now();report.database=name;
  try{
    const [[version]]=await admin.query('SELECT VERSION() AS version');report.version=version.version;
    const schema=fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8').split('INSERT INTO stores')[0].replaceAll('passenger_flow_codex',name);
    for(const sql of schema.split(';').map(s=>s.trim()).filter(Boolean))await admin.query(sql);
    Object.assign(process.env,{DB_NAME:name,DB_READ_ONLY:'false',MAINTENANCE_MODE:'false',APP_ENV_NAME:'LOCAL',BIND_HOST:'127.0.0.1',APP_AUTH_USER:'base-test',APP_AUTH_PASSWORD:crypto.randomBytes(18).toString('hex')});
    db=require('../config/database');const base=require('../services/baseDataService');
    const run=async input=>{const p=await base.preview(input);return base.execute({...p.params,previewToken:p.previewToken});};
    const counts=async()=>{const [s]=await db.rawQuery('SELECT (SELECT COUNT(*) FROM stores) AS stores,(SELECT COUNT(*) FROM devices) AS devices');return {stores:Number(s.stores),devices:Number(s.devices)};};
    for(const input of [{mode:'ensure',stores:0,devicesPerStore:2},{mode:'append',stores:1,devicesPerStore:101},{mode:'append',stores:1,devicesPerStore:2,storeIds:[1]},{mode:'bad',stores:1,devicesPerStore:1}])await assert.rejects(()=>base.preview(input));
    assert.deepEqual(await counts(),{stores:0,devices:0});
    check('invalid parameters rejected before writes');
    const empty=await run({mode:'ensure',stores:3,devicesPerStore:3});assert.deepEqual(empty.after,{stores:3,devices:9});
    // Reset only this explicitly created isolated test schema for the legacy seed scenario.
    await db.rawQuery('DELETE FROM devices');await db.rawQuery('DELETE FROM stores');await db.rawQuery('DELETE FROM migration_batches');
    await require('../scripts/seed').seed();assert.deepEqual(await counts(),{stores:5,devices:10});
    await db.rawQuery("UPDATE stores SET status='CLOSED' WHERE store_code='ST-0001'");
    await db.rawQuery("UPDATE devices SET status='OFFLINE' WHERE device_code='DV-0001'");
    const savedStores=await db.rawQuery('SELECT * FROM stores'),savedDevices=await db.rawQuery('SELECT * FROM devices');
    const first=await run({mode:'ensure',stores:50,devicesPerStore:4});assert.deepEqual(first.after,{stores:50,devices:200});
    assert.deepEqual(await db.rawQuery('SELECT * FROM stores WHERE store_id IN (?)',[savedStores.map(s=>s.store_id)]),savedStores);
    assert.deepEqual(await db.rawQuery('SELECT * FROM devices WHERE device_id IN (?)',[savedDevices.map(d=>d.device_id)]),savedDevices);
    const repeat=await run({mode:'ensure',stores:50,devicesPerStore:4});assert.deepEqual(repeat.added,{stores:0,devices:0});
    check('empty initialization, legacy seed expansion, existing records preserved, repeat ensure');
    const p=await base.preview({mode:'append',stores:2,devicesPerStore:3});
    const concurrent=await Promise.all(Array.from({length:4},()=>base.execute({...p.params,previewToken:p.previewToken})));
    assert.equal(concurrent.filter(r=>!r.replayed).length,1);assert.deepEqual(await counts(),{stores:52,devices:206});
    await run({mode:'append',stores:2,devicesPerStore:3});assert.deepEqual(await counts(),{stores:54,devices:212});
    await assert.rejects(()=>run({...p.params,stores:3}),/参数不同/);
    const ids=savedStores.slice(0,2).map(s=>s.store_id);
    await run({mode:'append',storeIds:ids,devicesPerStore:2});assert.deepEqual(await counts(),{stores:54,devices:216});
    check('append twice, concurrent same UUID once, changed params rejected, selected-store devices');
    const stale=await base.preview({mode:'append',stores:1,devicesPerStore:1});
    await db.rawQuery('UPDATE stores SET city=? WHERE store_id=?',['changed',ids[0]]);
    await assert.rejects(()=>base.execute({...stale.params,previewToken:stale.previewToken}),/预览后资料/);
    process.env.DB_READ_ONLY='true';await base.preview({mode:'ensure',stores:54,devicesPerStore:1});
    await assert.rejects(()=>base.execute({...stale.params,previewToken:stale.previewToken}));process.env.DB_READ_ONLY='false';
    const conflictId=crypto.randomUUID();await db.rawQuery('INSERT INTO stores (store_code,store_name) VALUES (?,?)',['BS-'+conflictId.replaceAll('-','')+'-1','collision']);
    const beforeConflict=await counts();await assert.rejects(()=>run({mode:'append',stores:1,devicesPerStore:1,requestId:conflictId}),/冲突/);assert.deepEqual(await counts(),beforeConflict);
    await admin.query("CREATE TRIGGER reject_test_device BEFORE INSERT ON devices FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test rollback'");
    await assert.rejects(()=>run({mode:'append',stores:2,devicesPerStore:2}),/test rollback/);assert.deepEqual(await counts(),beforeConflict);await admin.query('DROP TRIGGER reject_test_device');
    check('stale preview, read-only, encoding conflict and database failure roll back atomically');
    const cliId=crypto.randomUUID();
    const cli=(args)=>spawnSync(process.execPath,['scripts/base-data.js',...args],{cwd:path.join(__dirname,'..'),env:process.env,encoding:'utf8'});
    let out=cli(['--mode','append','--stores','1','--devices-per-store','2','--request-id',cliId,'--dry-run']);assert.equal(out.status,0,out.stderr);assert.deepEqual(await counts(),beforeConflict);
    out=cli(['--mode','append','--stores','1','--devices-per-store','2','--request-id',cliId]);assert.equal(out.status,0,out.stderr);
    out=cli(['--mode','append','--stores','1','--devices-per-store','2','--request-id',cliId]);assert.equal(out.status,0,out.stderr);assert.match(out.stdout,/"replayed": true/);
    if(process.platform==='win32'){out=spawnSync('cmd.exe',['/d','/c','base-data.bat --mode ensure --stores 50 --devices-per-store 1 --dry-run'],{cwd:path.join(__dirname,'..'),env:process.env,encoding:'utf8'});assert.equal(out.status,0,out.stderr);}
    check('actual CLI dry-run, execute, repeat and Windows bat entrypoint');
    const app=require('../app');server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const url='http://127.0.0.1:'+server.address().port,headers={Authorization:'Basic '+Buffer.from(process.env.APP_AUTH_USER+':'+process.env.APP_AUTH_PASSWORD).toString('base64'),Accept:'application/json','Content-Type':'application/json'};
    assert.equal((await fetch(url+'/api/base-data/preview')).status,401);
    assert.equal((await fetch(url+'/api/base-data/execute',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})).status,403);
    const httpPreview=await fetch(url+'/api/base-data/preview?mode=append&stores=1&devicesPerStore=1',{headers});assert.equal(httpPreview.status,200);const hp=await httpPreview.json();
    process.env.MAINTENANCE_MODE='true';assert.equal((await fetch(url+'/api/base-data/execute',{method:'POST',headers,body:JSON.stringify({...hp.params,previewToken:hp.previewToken})})).status,503);process.env.MAINTENANCE_MODE='false';
    if(process.env.PLAYWRIGHT_MODULE){
      const {chromium}=require(process.env.PLAYWRIGHT_MODULE),browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
      try{
        const ctx=await browser.newContext({httpCredentials:{username:process.env.APP_AUTH_USER,password:process.env.APP_AUTH_PASSWORD}}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.goto(url+'/base-data');await page.locator('#mode').selectOption('append');await page.locator('#stores').fill('1');await page.locator('#per-store').fill('2');
        const beforeBrowser=await counts();await page.locator('#preview').click();await page.waitForFunction(()=>document.getElementById('base-status').textContent.includes('预览完成'));
        assert.deepEqual(await counts(),beforeBrowser);await page.locator('#execute').dblclick();await page.waitForFunction(()=>document.getElementById('base-status').textContent.includes('创建完成'));
        assert.deepEqual(await counts(),{stores:beforeBrowser.stores+1,devices:beforeBrowser.devices+2});assert.equal(await page.locator('#execute').isDisabled(),true);
        await page.locator('#new-batch').click();await page.locator('#mode').selectOption('devices');await page.locator('#selected').selectOption(ids.map(String));await page.locator('#per-store').fill('2');
        await page.locator('#preview').click();await page.waitForFunction(()=>document.getElementById('base-status').textContent.includes('预览完成'));
        await page.route('**/api/base-data/execute',async route=>{await route.fetch();await route.abort();},{times:1});
        await page.locator('#execute').click();await page.waitForFunction(()=>document.getElementById('base-status').textContent.includes('保留本批次重试'));
        await page.reload();await page.locator('#execute').click();await page.waitForFunction(()=>document.getElementById('base-status').textContent.includes('此前已完成'));
        assert.deepEqual(await counts(),{stores:beforeBrowser.stores+1,devices:beforeBrowser.devices+6});
        await page.screenshot({path:path.join(__dirname,'../reports/base-data-browser-'+Date.now()+'.png'),fullPage:true});assert.deepEqual(errors,[]);
        check('real browser preview, selected stores, double-click protection, lost response and reload retry');
      }finally{await browser.close();}
    }
    check('authentication, cross-site protection and maintenance HTTP rejection');
    const gen=spawnSync(process.execPath,['scripts/generate-test-data.js','--rows','16','--stores','60','--devices-per-store','4'],{cwd:path.join(__dirname,'..'),env:process.env,encoding:'utf8'});assert.equal(gen.status,0,gen.stderr);
    assert.equal((await counts()).stores,60);
    const [underfilled]=await db.rawQuery('SELECT COUNT(*) AS n FROM (SELECT s.store_id FROM stores s LEFT JOIN devices d ON s.store_id=d.store_id GROUP BY s.store_id HAVING COUNT(d.device_id)<4) x');assert.equal(Number(underfilled.n),0);
    check('db:generate explicit quantities apply to original and additional stores');
    const start=Date.now();const large=await run({mode:'ensure',stores:500,devicesPerStore:10});report.expansionMs=Date.now()-start;assert.deepEqual(large.after,{stores:500,devices:5000});
    await assert.rejects(()=>run({mode:'append',stores:1,devicesPerStore:1}),/超过/);
    const deviceModel=require('../models/deviceModel');assert.equal((await deviceModel.listForSelection()).length,5000);assert.equal((await deviceModel.list({page:2})).rows.length,20);
    const lab=require('../services/migrationLabService');const flowStart=Date.now();await Promise.all([lab.insertRows(250),lab.insertRows(250)]);report.flow500Ms=Date.now()-flowStart;
    const [orphan]=await db.rawQuery('SELECT COUNT(*) AS n FROM flow_events f LEFT JOIN devices d ON f.device_id=d.device_id WHERE d.device_id IS NULL OR d.store_id<>f.store_id');assert.equal(Number(orphan.n),0);
    const [newFlow]=await db.rawQuery("SELECT COUNT(*) AS n FROM flow_events f JOIN devices d ON f.device_id=d.device_id WHERE d.device_code LIKE 'BD-%'");assert.ok(Number(newFlow.n)>0);
    const [logs]=await db.rawQuery('SELECT COUNT(DISTINCT device_id) AS n,MAX(device_id) AS max_id FROM device_status_logs');assert.ok(Number(logs.max_id)>Number(savedDevices[9].device_id));
    const sample=require('../util/helpers').sampleWithoutReplacement(Array.from({length:5000},(_,i)=>i),10,()=>0.999);assert.equal(new Set(sample).size,10);assert.ok(sample.some(id=>id>10));
    check('500 stores / 5000 devices, list, concurrent flow, new-device flow and unbiased log eligibility',{expansionMs:report.expansionMs,flow500Ms:report.flow500Ms});
    // A committed batch must still be replayable when the database is at its limit.
    out=cli(['--mode','append','--stores','1','--devices-per-store','2','--request-id',cliId]);assert.equal(out.status,0,out.stderr);assert.match(out.stdout,/"replayed": true/);
    check('CLI committed batch replay at capacity limit');report.status='PASS';
  }catch(e){report.status='FAIL';report.error=e.stack;throw e;}
  finally{
    if(server)await new Promise(r=>server.close(r));if(db)await db.poolEnd();await admin.end();
    fs.mkdirSync(path.join(__dirname,'../reports'),{recursive:true});const file=path.join(__dirname,'../reports/base-data-integration-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(file);
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
