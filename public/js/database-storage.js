 'use strict';
(function(){
  const card=document.getElementById('database-storage');if(!card)return;
  let running=false,last=null,timer,again=false;
  const unit=n=>n>=1073741824?(n/1073741824).toFixed(3)+' GiB':(n/1048576).toFixed(3)+' MiB';
  const value=card.querySelector('[data-storage-value]'),detail=card.querySelector('[data-storage-detail]'),time=card.querySelector('[data-storage-time]');
  function render(sample){
    value.textContent=unit(sample.bytes)+'（'+sample.bytes.toLocaleString()+' 字节）';
    detail.textContent='数据 '+unit(sample.dataBytes)+'；索引 '+unit(sample.indexBytes)+'；八张业务表共 '+Object.values(sample.exactCounts).reduce((s,n)=>s+Number(n),0).toLocaleString()+' 行';
    const ids={'stat-total-rows':Object.values(sample.exactCounts).reduce((s,n)=>s+Number(n),0),
      'stat-flow-rows':sample.exactCounts.flow_events,'stat-log-rows':sample.exactCounts.device_status_logs,'stat-marker-rows':sample.exactCounts.migration_markers};
    for(const [id,n] of Object.entries(ids)){const el=document.getElementById(id);if(el)el.textContent=Number(n).toLocaleString();}
    const tbody=document.getElementById('storage-table-body');
    if(tbody){
      tbody.replaceChildren();
      for(const table of sample.tables){
        const tr=document.createElement('tr');
        for(const text of [table.table_name,table.approx_rows,...['data_length','index_length','data_free','total_size'].map(k=>(Number(table[k])/1048576).toFixed(3))]){
          const td=document.createElement('td');td.textContent=text;tr.appendChild(td);
        }tbody.appendChild(tr);
      }
    }
  }
  async function refresh(){
    if(running){again=true;return;}running=true;clearTimeout(timer);
    const controller=new window.AbortController();const deadline=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch('/api/database-storage',{cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const result=await response.json();last=result.sample||last;
      if(last){render(last);time.textContent=(result.status==='ok'?'正常':'过期：'+result.error.code)+'；采样时间 '+new Date(last.sampledAt).toLocaleString();}
      else{value.textContent='读取失败';time.textContent=result.error?.code||'STORAGE_READ_FAILED';}
    }catch(e){time.textContent=(last?'过期；采样时间 '+new Date(last.sampledAt).toLocaleString()+'；':'读取失败；')+e.message;if(!last)value.textContent='读取失败';}
    finally{clearTimeout(deadline);running=false;timer=setTimeout(refresh,again?0:10000);again=false;}
  }
  window.refreshDatabaseStorage=refresh;refresh();
})();
