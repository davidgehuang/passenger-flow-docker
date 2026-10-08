'use strict';
const { integer, assertWritable, isReadOnly } = require('../config/settings');
const lab = require('./migrationLabService');
const deviceModel = require('../models/deviceModel');
const markerModel = require('../models/markerModel');
const { performance } = require('perf_hooks');
class WorkloadEngine {
  constructor(){this.state='STOPPED';this.inflight=0;this.pending=new Set();this.timer=null;this.options=null;this.stats=null;this.lastError=null;this.generation=0;}
  async start({qps=20,insertPercent=70,updatePercent=20,deletePercent=10}={}) {
    assertWritable();
    if(this.pending.size||['RUNNING','STARTING','STOPPING'].includes(this.state))throw new Error('负载尚未停止');
    const percentages=[insertPercent,updatePercent,deletePercent].map(v=>integer(v,'操作比例',0,100,0));
    if(percentages.reduce((a,b)=>a+b,0)!==100)throw Object.assign(new Error('操作比例之和必须为 100'),{status:400});
    this.options={qps:integer(qps,'qps',1,500,20),insertPercent:percentages[0],updatePercent:percentages[1],deletePercent:percentages[2]};
    const generation=++this.generation;this.state='STARTING';this.lastError=null;this.errors=0;this.stoppedAt=null;
    this.stats={totalInsert:0,totalUpdate:0,totalDelete:0,successSql:0,failedSql:0,latestId:null,lastOp:null,lastMarkerType:null,startedAt:new Date().toISOString()};
    try{
      const devices=await deviceModel.listForSelection();
      if(generation!==this.generation||this.state!=='STARTING')return this.getStatus();
      if(!devices.length)throw new Error('没有设备，请先执行 db:seed');
      assertWritable();this.credit=0;this.lastTick=performance.now();this.state='RUNNING';
      this.timer=setInterval(()=>this._tick(),50);return this.getStatus();
    }catch(e){if(generation===this.generation){this.state='ERROR';this.lastError=e.message;}throw e;}
  }
  _tick(){
    if(this.state!=='RUNNING')return;
    if(isReadOnly()){this.stop().catch(e=>{this.lastError=e.message;});return;}
    const now=performance.now();
    this.credit=Math.min(this.options.qps,this.credit+(now-this.lastTick)*this.options.qps/1000);this.lastTick=now;
    while(this.credit>=1&&this.pending.size<10&&this.state==='RUNNING'){this.credit--;this._scheduleOne();}
  }
  _pickOperation(){const r=Math.random()*100;return r<this.options.insertPercent?'INSERT':r<this.options.insertPercent+this.options.updatePercent?'UPDATE':'DELETE';}
  _scheduleOne(){
    const op=this._pickOperation();
    const promise=this._runOperation(op).then(()=>{this.errors=0;}).catch(e=>{
      this.stats.failedSql++;this.lastError=e.message;this.errors++;
      if(this.errors>=30){clearInterval(this.timer);this.timer=null;this.state='ERROR';}
    }).finally(()=>{this.pending.delete(promise);this.inflight=this.pending.size;if(this.state==='ERROR'&&!this.pending.size)this.stoppedAt=Date.now();});
    this.pending.add(promise);this.inflight=this.pending.size;
  }
  async _runOperation(op){
    assertWritable();
    const r=await(op==='INSERT'?lab.insertRows(1):op==='UPDATE'?lab.updateRows(1):lab.deleteRows(1));
    if(op==='INSERT'){this.stats.totalInsert+=r.insertedRows;this.stats.latestId=r.maxId;}
    else if(op==='UPDATE')this.stats.totalUpdate+=r.updatedRows;
    else this.stats.totalDelete+=r.deletedRows;
    this.stats.successSql++;this.stats.lastOp=op;
  }
  async stop(){
    ++this.generation;if(this.timer)clearInterval(this.timer);this.timer=null;this.state='STOPPING';
    let timeout;
    try{
      await Promise.race([Promise.all([...this.pending]),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('仍有在途写入，不能宣称已停写')),30000);})]);
      this.state='STOPPED';this.stoppedAt=this.stoppedAt||Date.now();return this.getStatus();
    }catch(e){this.state='ERROR';this.lastError=e.message;throw e;}finally{clearTimeout(timeout);}
  }
  async refreshMarkerInfo(){if(this.stats)this.stats.lastMarkerType=(await markerModel.stats()).lastType;}
  getStatus(){
    const runtimeMs=this.stats?(this.stoppedAt||Date.now())-Date.parse(this.stats.startedAt):0;
    return {state:this.state,options:this.options,inflight:this.pending.size,lastError:this.lastError,
      stats:this.stats?{...this.stats,runtimeMs,actualOpsPerSecond:runtimeMs?Number((this.stats.successSql*1000/runtimeMs).toFixed(2)):0}:null};
  }
}
module.exports={WorkloadEngine};
