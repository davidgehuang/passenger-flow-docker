'use strict';
const fs=require('fs'),path=require('path');
const {parseArgs,reportsDir,runScript}=require('./lib/common');
const {compare}=require('../services/compareService');
const {poolEnd}=require('../config/database');
async function main(){
  try{
    const args=parseArgs(process.argv.slice(2));
    if(!args.source||!args.target){console.error('用法: npm run db:compare -- --source 源.json --target 目标.json');return 2;}
    const source=JSON.parse(fs.readFileSync(path.resolve(args.source),'utf8'));
    const target=JSON.parse(fs.readFileSync(path.resolve(args.target),'utf8'));
    const result=compare(source,target);
    for(const r of result.results)console.log(r.status+' '+r.name+' '+r.detail);
    const file=path.join(reportsDir(),'compare-'+Date.now()+'.json');
    fs.writeFileSync(file,JSON.stringify(result,null,2),{flag:'wx'});
    console.log(JSON.stringify(result.summary));console.log(result.limitation);console.log('报告: '+file);
    return result.summary.exitCode;
  }finally{await poolEnd();}
}
runScript(main);
