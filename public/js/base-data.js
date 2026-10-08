'use strict';
(function(){
  const form=document.getElementById('base-form'),mode=document.getElementById('mode'),execute=document.getElementById('execute');
  const status=document.getElementById('base-status'),result=document.getElementById('base-result');
  let preview=null,busy=false;
  const newId=()=>{const b=window.crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);};
  let requestId=newId();
  function layout(){document.getElementById('stores').disabled=mode.value==='devices';document.getElementById('selected').disabled=mode.value!=='devices';}
  function changed(){preview=null;execute.disabled=true;layout();document.getElementById('selected-label').hidden=mode.value!=='devices';document.getElementById('stores-label').hidden=mode.value==='devices';}
  form.addEventListener('input',changed);
  function input(){
    const data={mode:mode.value==='devices'?'append':mode.value,devicesPerStore:document.getElementById('per-store').value,requestId};
    if(mode.value==='devices')data.storeIds=Array.from(document.getElementById('selected').selectedOptions,o=>o.value);
    else data.stores=document.getElementById('stores').value;
    return data;
  }
  async function call(url,options={}){
    const controller=new window.AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{const r=await fetch(url,{...options,signal:controller.signal,headers:{Accept:'application/json','Content-Type':'application/json'},cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.message||'请求失败 '+r.status);return data;}finally{clearTimeout(timer);}
  }
  function show(data){result.textContent='批次号：'+requestId+'\n当前：'+data.before.stores+' 家门店 / '+data.before.devices+' 台设备\n本批新增：'+data.added.stores+' 家门店 / '+data.added.devices+' 台设备\n完成后：'+data.after.stores+' 家门店 / '+data.after.devices+' 台设备';}
  function lock(value){busy=value;for(const el of form.elements)el.disabled=value;execute.disabled=value||!preview;if(!value)layout();}
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;lock(true);status.textContent='正在预览…';
    try{preview=await call('/api/base-data/preview?payload='+encodeURIComponent(JSON.stringify(input())));show(preview);status.textContent='预览完成，尚未写入。';}
    catch(e){preview=null;status.textContent=e.message;}finally{lock(false);}
  });
  execute.addEventListener('click',async()=>{
    if(busy||!preview)return;lock(true);status.textContent='正在执行，请勿关闭页面；批次号：'+requestId;
    try{window.sessionStorage.setItem('base-data-pending',JSON.stringify({...preview.params,previewToken:preview.previewToken}));const data=await call('/api/base-data/execute',{method:'POST',body:window.sessionStorage.getItem('base-data-pending')});show(data);status.textContent=data.replayed?'此批次此前已完成，未重复创建。':'创建完成。再次追加请点击“开始新批次”。';preview=null;window.sessionStorage.removeItem('base-data-pending');}
    catch(e){status.textContent=e.message+'；可以保留本批次重试，若提示资料变化则重新预览。';}finally{lock(false);}
  });
  document.getElementById('new-batch').addEventListener('click',()=>{requestId=newId();window.sessionStorage.removeItem('base-data-pending');changed();result.textContent='';status.textContent='新批次：'+requestId;});
  const pending=window.sessionStorage.getItem('base-data-pending');
  if(pending){try{const data=JSON.parse(pending);requestId=data.requestId;mode.value=data.storeIds?.length?'devices':data.mode;document.getElementById('stores').value=data.stores||1;document.getElementById('per-store').value=data.devicesPerStore;for(const option of document.getElementById('selected').options)option.selected=(data.storeIds||[]).map(String).includes(option.value);changed();preview={params:data,previewToken:data.previewToken};execute.disabled=false;status.textContent='有未确认结果的批次 '+requestId+'；点击执行可安全重试原批次，或开始新批次。';}catch{window.sessionStorage.removeItem('base-data-pending');}}
})();
