 'use strict';
const fs=require('fs'),path=require('path');
const {buildPool,runScript,reportsDir}=require('./lib/common');
const {dbName}=require('../config/settings');
const {freshTables,TRACKED_TABLES}=require('../models/statsModel');
async function main(){
  const pool=buildPool();let conn;
  const report={startedAt:new Date().toISOString(),database:dbName(),scope:'all base tables; exact counts of eight business tables'};
  try{
    conn=await pool.getConnection();
    const [[v]]=await conn.query('SELECT VERSION() AS version');report.version=v.version;
    try{const [[r]]=await conn.query('SELECT @@SESSION.information_schema_stats_expiry AS expiry');report.expiryBefore=r.expiry;}
    catch(e){if(e.code!=='ER_UNKNOWN_SYSTEM_VARIABLE')throw e;report.expiryBefore='unsupported';}
    const [[before]]=await conn.query("SELECT COALESCE(SUM(DATA_LENGTH+INDEX_LENGTH),0) AS bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'",[dbName()]);
    report.beforeBytes=Number(before.bytes);
    report.fresh=await freshTables(conn);
    const [counts]=await conn.query('SELECT '+TRACKED_TABLES.map(t=>'(SELECT COUNT(*) FROM `'+t+'`) AS `'+t+'`').join(','));
    report.exactCounts=counts[0];report.completedAt=new Date().toISOString();report.status='ok';
  }catch(e){report.status='error';report.error={code:e.code||'STORAGE_READ_FAILED'};process.exitCode=1;}
  finally{if(conn)conn.release();await pool.end();}
  const file=path.join(reportsDir(),'storage-diagnose-'+Date.now()+'.json');
  fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify(report,null,2));console.log(file);
}
runScript(main);
