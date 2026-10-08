/* global document, window */
 'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const mysql=require('mysql2/promise'),settings=require('../config/settings');
const report={checks:[],startedAt:new Date().toISOString()};
const check=(name,detail)=>{report.checks.push({name,detail});console.log('PASS '+name+(detail?' '+JSON.stringify(detail):''));};
async function main(){
  if(!['127.0.0.1','localhost','::1'].includes(process.env.DB_HOST))throw new Error('仅允许本地隔离测试');
  const admin=await mysql.createConnection(settings.options(false));let db,server,createdUser=false;
  const suffix=Date.now(),name='pf_storage_'+suffix,user='pf_ro_'+suffix,password=crypto.randomBytes(20).toString('hex');
  report.database=name;
  try{
    const [[version]]=await admin.query('SELECT VERSION() AS version');report.version=version.version;
    const schema=fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8').split('INSERT INTO stores')[0].replaceAll('passenger_flow_codex',name);
    for(const sql of schema.split(';').map(s=>s.trim()).filter(Boolean))await admin.query(sql);
    await admin.query('CREATE TABLE storage_probe (id INT PRIMARY KEY AUTO_INCREMENT, payload MEDIUMTEXT) ENGINE=InnoDB');
    await admin.query('CREATE VIEW probe_view AS SELECT id FROM storage_probe');
    await admin.query('CREATE USER ?@? IDENTIFIED BY ?',[user,'127.0.0.1',password]);createdUser=true;
    await admin.query('GRANT SELECT ON `'+name+'`.* TO ?@?',[user,'127.0.0.1']);
    Object.assign(process.env,{DB_NAME:name,DB_USER:user,DB_PASSWORD:password,DB_READ_ONLY:'true',APP_ENV_NAME:'LOCAL',BIND_HOST:'127.0.0.1',APP_AUTH_USER:'storage-test',APP_AUTH_PASSWORD:password});
    db=require('../config/database');const stats=require('../models/statsModel'),sampler=require('../services/storageService');
    const baseline=await stats.collectStorage();assert.equal(baseline.tables.length,9);assert.equal(Number(baseline.exactCounts.stores),0);check('SELECT-only account samples without PROCESS; views excluded; read-only works',baseline.cacheMode);
    const sizes=[baseline.bytes];
    for(let round=0;round<2;round++){
      for(let chunk=0;chunk<20;chunk++)await admin.query('INSERT INTO storage_probe (payload) VALUES ?',[Array.from({length:100},()=>[crypto.randomBytes(1000).toString('hex')])]);
      await admin.query('INSERT INTO stores (store_code,store_name) VALUES (?,?)',['probe'+round,'external insert']);
      const sample=await stats.collectStorage();sizes.push(sample.bytes);assert.equal(Number(sample.exactCounts.stores),round+1);
    }
    for(let retry=0;retry<90 && sizes[2]<=sizes[0];retry++){await new Promise(r=>setTimeout(r,1000));sizes[2]=(await stats.collectStorage()).bytes;}
    assert.ok(sizes[2]>sizes[0],JSON.stringify(sizes));check('external SQL grows current schema capacity and exact counts',sizes);
    const parallel=await Promise.all(Array.from({length:8},()=>stats.collectStorage()));assert.ok(parallel.every(s=>s.bytes===sizes[2]));check('pool concurrency uses initialized connections');
    await db.withConnection(async conn=>{conn.destroy();});assert.equal((await stats.collectStorage()).bytes,sizes[2]);check('replacement connection bypasses cache');
    await db.withConnection(async conn=>{
      const [rows]=await conn.query("SELECT COALESCE(SUM(DATA_LENGTH+INDEX_LENGTH),0) AS bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'",[name]);
      assert.equal(Number(rows[0].bytes),sizes[2]);
    });check('SQL and collector agree');
    const app=require('../app');server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Basic '+Buffer.from('storage-test:'+password).toString('base64')};
    assert.equal((await fetch(base+'/api/database-storage')).status,401);
    for(const url of ['/','/migration-lab','/migration-check']){const r=await fetch(base+url,{headers});assert.equal(r.status,200);assert.match(await r.text(),/id="database-storage"/);}
    const response=await fetch(base+'/api/database-storage',{headers});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).sample.bytes,sizes[2]);check('authenticated endpoint and all three pages');
    if(process.env.PLAYWRIGHT_MODULE){
      const {chromium}=require(process.env.PLAYWRIGHT_MODULE);const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
      try{
        const context=await browser.newContext({httpCredentials:{username:'storage-test',password}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
        for(const url of ['/','/migration-lab','/migration-check']){
          await page.goto(base+url);await page.waitForFunction(()=>document.querySelector('[data-storage-time]')?.textContent.startsWith('正常'));
          assert.ok((await page.locator('[data-storage-value]').innerText()).includes(sizes[2].toLocaleString()));
        }
        const first=await page.locator('[data-storage-time]').innerText();
        await admin.query("INSERT INTO stores (store_code,store_name) VALUES ('browser','poll')");
        await page.waitForFunction(old=>document.querySelector('[data-storage-time]').textContent!==old,first,{timeout:25000});
        assert.match(await page.locator('[data-storage-detail]').innerText(),/3 行/);
        await page.route('**/api/database-storage',route=>route.fulfill({status:503,body:'offline'}));
        await page.evaluate(()=>window.refreshDatabaseStorage());await page.waitForFunction(()=>document.querySelector('[data-storage-time]').textContent.startsWith('过期'));
        assert.ok((await page.locator('[data-storage-value]').innerText()).includes(sizes[2].toLocaleString()));
        await page.screenshot({path:path.join(__dirname,'../reports/storage-browser-'+suffix+'.png'),fullPage:true});
        assert.deepEqual(errors,[]);check('real browser renders 3 pages, polls external writes and retains values on network failure');
      }finally{await browser.close();}
    }
    const prior=await sampler.get();await admin.query('REVOKE SELECT ON `'+name+'`.* FROM ?@?',[user,'127.0.0.1']);
    const [sessions]=await admin.query('SELECT ID FROM information_schema.PROCESSLIST WHERE USER=?',[user]);
    for(const session of sessions)await admin.query('KILL CONNECTION '+Number(session.ID));
    sampler.invalidate();const stale=await sampler.get();assert.equal(stale.status,'stale');assert.deepEqual(stale.sample,prior.sample);
    await admin.query('GRANT SELECT ON `'+name+'`.* TO ?@?',[user,'127.0.0.1']);sampler.invalidate();assert.equal((await sampler.get()).status,'ok');check('permission loss is stale, then recovers');
    report.status='PASS';
  }finally{
    if(server)await new Promise(r=>server.close(r));if(db)await db.poolEnd();
    if(createdUser)await admin.query('DROP USER ?@?',[user,'127.0.0.1']);await admin.end();
    report.note='独立测试库保留；临时只读账号已删除；未修改现有业务库。';
  }
}
main().catch(e=>{report.status='FAIL';report.error=e.code||e.message;console.error(e.stack);process.exitCode=1;}).finally(()=>{
  fs.mkdirSync(path.join(__dirname,'../reports'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../reports/storage-integration-'+Date.now()+'.json'),JSON.stringify(report,null,2));
});
