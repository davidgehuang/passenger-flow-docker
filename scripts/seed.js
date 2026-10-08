'use strict';
const { transaction, rawQuery, poolEnd } = require('../config/database');
async function seed() {
  return transaction(async () => {
    const stores = [['ST-0001','北京国贸旗舰店','华北','北京'],['ST-0002','上海陆家嘴店','华东','上海'],['ST-0003','广州天河城店','华南','广州'],['ST-0004','深圳南山科技园店','华南','深圳'],['ST-0005','成都春熙路店','西南','成都']];
    for (const row of stores) await rawQuery('INSERT INTO stores (store_code,store_name,region,city) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE store_id=store_id',row);
    const found = await rawQuery('SELECT store_id,store_code,store_name FROM stores WHERE store_code IN (?)',[stores.map(s=>s[0])]);
    for (const s of found) {
      const index = stores.findIndex(row=>row[0]===s.store_code);
      for (let i=1;i<=2;i++) {
        const code='DV-'+String(index*2+i).padStart(4,'0');
        await rawQuery('INSERT INTO devices (device_code,store_id,device_name,device_type,status,last_online_time) VALUES (?,?,?,?,?,NOW(6)) ON DUPLICATE KEY UPDATE device_id=device_id',
          [code,s.store_id,s.store_name+'-设备'+i,'ENTRANCE_CAMERA','ONLINE']);
      }
    }
  });
}
if (require.main === module) seed().then(()=>console.log('种子数据完成；已有门店和设备未覆盖')).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(poolEnd);
module.exports={seed};
