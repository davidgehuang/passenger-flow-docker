'use strict';
const crypto=require('crypto');
const {parseArgs,runScript}=require('./lib/common');
const {poolEnd}=require('../config/database');
const service=require('../services/baseDataService');
async function main(){
  try {
    const args=parseArgs(process.argv.slice(2));
    const allowed=['mode','stores','devices-per-store','store-ids','dry-run','request-id'];
    if(Object.keys(args).some(k=>!allowed.includes(k)))throw new Error('存在未知参数，请查看使用手册');
    const requestId=args['request-id']||crypto.randomUUID();
    console.log('批次号（网络中断后请用 --request-id 重试）：'+requestId);
    const input={mode:args.mode,stores:args.stores,devicesPerStore:args['devices-per-store'],storeIds:args['store-ids'],requestId};
    const preview=await service.preview(input);
    console.log('预览：'+JSON.stringify(preview,null,2));
    if(args['dry-run']!==undefined){if(args['dry-run']!==true)throw new Error('--dry-run 不接受值');return;}
    const result=await service.execute({...preview.params,previewToken:preview.previewToken});
    console.log('完成：'+JSON.stringify(result,null,2));
  } finally {await poolEnd();}
}
runScript(main);
