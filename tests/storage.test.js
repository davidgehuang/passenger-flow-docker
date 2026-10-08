 'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {freshTables}=require('../models/statsModel');
const {createSampler}=require('../services/storageService');
after(()=>require('../config/database').poolEnd());
test('same connection awaits cache bypass; only unknown variable is compatible',async()=>{
  const seen=[];const conn={query:async sql=>{seen.push(sql);return [[{data_length:10,index_length:20}]];}};
  assert.equal((await freshTables(conn)).bytes,30);assert.match(seen[0],/SET SESSION/);assert.match(seen[1],/BASE TABLE/);
  for(const code of ['ER_UNKNOWN_SYSTEM_VARIABLE','ER_ACCESS_DENIED_ERROR','ECONNRESET']){
    const c={query:async sql=>{if(sql.startsWith('SET'))throw Object.assign(new Error(),{code});return [[]];}};
    if(code==='ER_UNKNOWN_SYSTEM_VARIABLE')assert.equal((await freshTables(c)).cacheMode,'unsupported-native');
    else await assert.rejects(freshTables(c),{code});
  }
});
test('coalesces concurrent reads, expires, preserves failed sample, recovers',async()=>{
  let now=0,calls=0,fail=false;
  const sampler=createSampler(async()=>{calls++;await Promise.resolve();if(fail)throw Object.assign(new Error('secret'),{code:'ECONNRESET'});return {bytes:calls};},()=>now);
  const results=await Promise.all(Array.from({length:20},()=>sampler.get()));assert.equal(calls,1);assert.equal(results[0].status,'ok');
  now=9999;await sampler.get();assert.equal(calls,1);
  now=10000;fail=true;const stale=await sampler.get();assert.equal(stale.status,'stale');assert.equal(stale.sample.bytes,1);assert.ok(!JSON.stringify(stale).includes('secret'));
  now=20000;fail=false;assert.equal((await sampler.get()).status,'ok');
  sampler.invalidate();await sampler.get();assert.equal(calls,4);
});
test('first failure has null sample, never zero bytes',async()=>{
  const sampler=createSampler(async()=>{throw new Error('secret');});const r=await sampler.get();assert.equal(r.status,'error');assert.equal(r.sample,null);
});
test('invalidating during a sample requests a subsequent fresh sample',async()=>{
  let resolve,calls=0;const sampler=createSampler(()=>{calls++;return calls===1?new Promise(r=>{resolve=r;}):Promise.resolve({bytes:2});});
  const first=sampler.get();sampler.invalidate();resolve({bytes:1});await first;assert.equal((await sampler.get()).sample.bytes,2);
});
