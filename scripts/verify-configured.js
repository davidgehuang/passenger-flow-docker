'use strict';
const fs=require('fs'),path=require('path');
const {reportsDir}=require('./lib/common');
const {databaseErrorDetail,databaseErrorHint}=require('../util/database-error');
require('../config/settings');process.env.MAINTENANCE_MODE='true';
const db=require('../config/database'),report={startedAt:new Date().toISOString(),mode:'read-only',checks:[]};
async function main(){
 let server;
 try{
  report.databaseVersion=await db.ping();
  const app=require('../app');
  server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
  const base='http://127.0.0.1:'+server.address().port,headers={};
  if(process.env.APP_AUTH_USER)headers.Authorization='Basic '+Buffer.from(process.env.APP_AUTH_USER+':'+process.env.APP_AUTH_PASSWORD).toString('base64');
  for(const url of ['/','/stores','/stores/new','/devices','/devices/new','/flow-events','/migration-check','/migration-lab','/migration-lab/status','/system-health','/health','/live']){
   const r=await fetch(base+url,{headers});if(r.status!==200)throw new Error(url+' HTTP '+r.status);
   report.checks.push({name:url,status:'PASS'});
  }
  await db.transaction(()=>db.rawQuery('SELECT COUNT(*) AS n FROM migration_markers'),{readOnly:true});
  report.status='PASS';console.log('只读验证通过: '+report.databaseVersion+'，12 个页面/接口与只读事务。');
 }finally{if(server)await new Promise(r=>server.close(r));await db.poolEnd();}
}
main().catch(e=>{report.status='FAIL';report.error=e.code||e.message;console.error(databaseErrorDetail(e));const hint=databaseErrorHint(e);if(hint)console.error(hint);process.exitCode=1;}).finally(()=>{
 report.finishedAt=new Date().toISOString();const dir=reportsDir();
 const file=path.join(dir,'configured-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(file);
});
