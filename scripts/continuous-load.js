'use strict';
require('../config/settings');
const {parseArgs}=require('./lib/common');
const {WorkloadEngine}=require('../services/workloadEngine');
const {integer}=require('../config/settings');
const {poolEnd}=require('../config/database');
async function main(){
  const args=parseArgs(process.argv.slice(2)),engine=new WorkloadEngine();
  const duration=integer(args.duration,'duration',1,86400,300);
  let stopping=false,timer,statusTimer;
  async function stop(){
    if(stopping)return;stopping=true;clearTimeout(timer);clearInterval(statusTimer);
    try{const final=await engine.stop();console.log(JSON.stringify(final,null,2));if(final.stats.failedSql)process.exitCode=1;}
    catch(e){console.error(e.message);process.exitCode=1;}finally{await poolEnd();}
  }
  await engine.start({qps:args.qps??args.rate??20,insertPercent:args['insert-percent']??70,updatePercent:args['update-percent']??20,deletePercent:args['delete-percent']??10});
  console.log('持续负载启动，操作/秒='+engine.options.qps+'，持续秒数='+duration);
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  timer=setTimeout(stop,duration*1000);
  statusTimer=setInterval(()=>{console.log(JSON.stringify(engine.getStatus()));if(['ERROR','STOPPED'].includes(engine.state))stop();},1000);
}
if(require.main===module)main().catch(async e=>{console.error(e.message);process.exitCode=1;await poolEnd();});
