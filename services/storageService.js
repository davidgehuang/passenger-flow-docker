 'use strict';
const stats = require('../models/statsModel');
function createSampler(collect, now=Date.now) {
  let last=null, pending=null, attemptedAt=-Infinity, invalid=true, error=null, generation=0;
  function result() {
    return {status:error?(last?'stale':'error'):'ok',sample:last,error,
      attemptedAt:Number.isFinite(attemptedAt)?new Date(attemptedAt).toISOString():null};
  }
  async function get() {
    if(pending)return pending;
    if(!invalid && now()-attemptedAt<10000)return result();
    const startedGeneration=generation;
    attemptedAt=now();invalid=false;
    pending=(async()=>{
      try { last=await collect();error=null; }
      catch(e){error={code:e.code||'STORAGE_READ_FAILED'};}
      finally { pending=null;if(generation!==startedGeneration)invalid=true; }
      return result();
    })();
    return pending;
  }
  return {get,invalidate(){invalid=true;generation++;}};
}
const sampler=createSampler(stats.collectStorage);
module.exports={...sampler,createSampler};
