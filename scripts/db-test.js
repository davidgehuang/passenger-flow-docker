'use strict';
const {transaction,rawQuery,poolEnd}=require('../config/database');
const {uuid}=require('../util/helpers');
const {assertWritable}=require('../config/settings');
async function main(){
  assertWritable();
  // 使用唯一标记并强制回滚，绝不覆盖固定门店编码。
  const rollback=new Error('TEST_ROLLBACK');
  try{await transaction(async()=>{
    const code='TEST-'+uuid();
    const r=await rawQuery('INSERT INTO stores (store_code,store_name) VALUES (?,?)',[code,'临时验证']);
    await rawQuery('UPDATE stores SET store_name=? WHERE store_id=?',['已更新',r.insertId]);
    const [row]=await rawQuery('SELECT store_name FROM stores WHERE store_id=?',[r.insertId]);
    if(row.store_name!=='已更新')throw new Error('UPDATE 未生效');
    await rawQuery('DELETE FROM stores WHERE store_id=?',[r.insertId]);
    const [count]=await rawQuery('SELECT COUNT(*) AS n FROM stores WHERE store_id=?',[r.insertId]);
    if(Number(count.n)!==0)throw new Error('DELETE 未生效');
    throw rollback;
  });}catch(e){if(e!==rollback)throw e;}
  console.log('INSERT/UPDATE/DELETE 实测通过，事务已回滚；自增序列可能留下空号。');
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(poolEnd);
