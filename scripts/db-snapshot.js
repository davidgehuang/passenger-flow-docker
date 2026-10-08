'use strict';
require('../config/settings');
const fs=require('fs'),path=require('path');
const {parseArgs,reportsDir,runScript}=require('./lib/common');
const {collect}=require('../services/snapshotService');
const {poolEnd}=require('../config/database');
async function main(){
  try{
    const args=parseArgs(process.argv.slice(2));
    const name=String(args.output||'snapshot-'+Date.now()+'.json').replace(/[\\/]/g,'_');
    const file=path.join(reportsDir(),name.endsWith('.json')?name:name+'.json');
    const snapshot=await collect();
    fs.writeFileSync(file,JSON.stringify(snapshot,null,2),{encoding:'utf8',flag:'wx'});
    console.log(JSON.stringify({file,meta:snapshot.meta,rows:Object.fromEntries(Object.entries(snapshot.tables).map(([k,v])=>[k,v.rowsExact]))},null,2));
    return 0;
  }finally{await poolEnd();}
}
runScript(main);
