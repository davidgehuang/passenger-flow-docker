'use strict';
const {parseArgs,runScript}=require('./lib/common');
const {integer,assertWritable}=require('../config/settings');
const {poolEnd}=require('../config/database');
const {seed}=require('./seed');
const lab=require('../services/migrationLabService');
async function main(){
  try{
    assertWritable();
    const args=parseArgs(process.argv.slice(2));
    if(args.rows!==undefined&&args['target-mb']!==undefined)throw new Error('--rows 和 --target-mb 只能选择一个');
    const mb=args['target-mb']===undefined?null:integer(args['target-mb'],'target-mb',1,2000,10);
    const total=mb===null?integer(args.rows,'rows',1,10000000,2000):Math.ceil(mb*1048576/512);
    const days=integer(args.days,'days',0,365,7);
    if(args.stores!==undefined||args['devices-per-store']!==undefined){
      const base=require('../services/baseDataService');
      const preview=await base.preview({mode:'ensure',stores:args.stores===undefined?5:args.stores,devicesPerStore:args['devices-per-store']===undefined?4:args['devices-per-store']});
      await base.execute({...preview.params,previewToken:preview.previewToken});
    }else await seed();
    if(mb!==null){
      const result=await lab.generateSize(mb,{historyDays:days});
      console.log('生成完成：逻辑负载 '+result.logicalPayloadBytes+' 字节；存储引擎估算容量变化 '+result.measuredTableStorageGrowthMB+' MB；来源 '+result.tableStorageSource);
      return;
    }
    let done=0;
    console.log('有界生成 '+total+' 条事件；过去 '+days+' 天');
    while(done<total){
      const n=Math.min(5000,total-done);
      const r=await lab.insertRows(n,{label:'GENERATE',historyDays:days});done+=r.insertedRows;
      console.log('已完成 '+done+'/'+total);
    }
    console.log('生成完成。');
  }finally{await poolEnd();}
}
runScript(main);
