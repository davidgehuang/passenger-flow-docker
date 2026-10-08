'use strict';
const {transaction,rawQuery}=require('../config/database');
function error(message,status=400){return Object.assign(new Error(message),{status});}
async function createDevice(data){
  return transaction(async()=>{
    const [store]=await rawQuery('SELECT store_id FROM stores WHERE store_id=? FOR UPDATE',[data.store_id]);
    if(!store)throw error('所属门店不存在');
    const result=await rawQuery('INSERT INTO devices (device_code,store_id,device_name,device_type,ip_address,firmware_version,status) VALUES (?,?,?,?,?,?,?)',
      [data.device_code,data.store_id,data.device_name,data.device_type||'CAMERA',data.ip_address||'',data.firmware_version||'',data.status||'ONLINE']);
    return result.insertId;
  });
}
async function updateDevice(id,data){
  return transaction(async()=>{
    const [store]=await rawQuery('SELECT store_id FROM stores WHERE store_id=? FOR UPDATE',[data.store_id]);
    if(!store)throw error('所属门店不存在');
    const [device]=await rawQuery('SELECT device_id FROM devices WHERE device_id=? FOR UPDATE',[id]);
    if(!device)throw error('设备不存在',404);
    return require('../models/deviceModel').update(id,data);
  });
}
async function remove(kind,id){
  return transaction(async()=>{
    const table=kind==='store'?'stores':'devices',pk=kind==='store'?'store_id':'device_id';
    const [row]=await rawQuery('SELECT '+pk+' FROM '+table+' WHERE '+pk+'=? FOR UPDATE',[id]);
    if(!row)throw error('记录不存在',404);
    const refs=kind==='store'?['devices','flow_events','flow_hourly']:['flow_events','device_status_logs'];
    for(const ref of refs){
      const [count]=await rawQuery('SELECT COUNT(*) AS n FROM '+ref+' WHERE '+pk+'=?',[id]);
      if(Number(count.n)>0)throw error('存在关联记录，不能删除；可编辑为关闭或维护状态',409);
    }
    await rawQuery('DELETE FROM '+table+' WHERE '+pk+'=?',[id]);
  });
}
module.exports={createDevice,updateDevice,remove};
