'use strict';
const { TRACKED_TABLES } = require('../models/statsModel');
const { canonical } = require('./snapshotService');
function compare(source,target,{allowSameDatabase=false}={}){
  const results=[];const add=(name,status,detail)=>results.push({name,status,detail});
  for(const [label,s]of [['源',source],['目标',target]]){
    if(s?.formatVersion!==2||!s.meta?.consistentSnapshot){add(label+'快照格式','FAIL','需要完整的 v2 一致性快照');continue;}
    if(!s.meta.readOnly)add(label+'停写状态','BLOCKED','不是只读状态采集，不能用于割接');
    if(s.meta.runningBatches!==0)add(label+'未完成批次','BLOCKED','仍有 RUNNING 批次，需确认在途或中断任务');
    for(const name of TRACKED_TABLES){
      const t=s.tables?.[name];
      if(!t||!Number.isSafeInteger(t.rowsExact)||t.rowsExact<0||!/^[a-f0-9]{64}$/.test(t.contentHash||'')||
          !t.schema?.columns?.length||!t.schema?.indexes?.length||t.schema?.table?.ENGINE!=='InnoDB'||
          (t.rowsExact>0&&(!/^\d+$/.test(t.minId||'')||!/^\d+$/.test(t.maxId||'')))){
        add(label+' '+name+'完整性','FAIL','缺失或无效的精确计数、主键边界、结构或摘要');
      }
    }
  }
  if(source?.meta?.endpointFingerprint===target?.meta?.endpointFingerprint&&!allowSameDatabase)add('独立数据库','BLOCKED','两份快照来自同一端点和库名');
  for(const name of TRACKED_TABLES){
    const a=source?.tables?.[name],b=target?.tables?.[name];
    if(!a||!b)continue;
    for(const key of ['rowsExact','minId','maxId','contentHash','schema'])add(name+' '+key,
      canonical(a[key])===canonical(b[key])?'PASS':'FAIL',canonical(a[key])===canonical(b[key])?'一致':'不一致');
  }
  const fail=results.filter(r=>r.status==='FAIL').length,blocked=results.filter(r=>r.status==='BLOCKED').length;
  return {results,summary:{pass:results.filter(r=>r.status==='PASS').length,fail,blocked,
    verdict:fail?'MISMATCH':blocked?'INCONCLUSIVE':'PASS',exitCode:fail?1:blocked?2:0},
    limitation:'PASS 仅证明这些快照所覆盖的数据库内容和结构一致；仍需 DTS 控制台校验、停写确认和目标应用验收。'};
}
module.exports={compare};
