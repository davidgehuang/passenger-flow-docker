'use strict';
const {buildPool,printHeader,printCheck,runScript}=require('./lib/common');
const {TRACKED_TABLES}=require('../models/statsModel');
const {dbName}=require('../config/settings');
async function main(){
  printHeader('DTS 源库预检查（只读）');
  const pool=buildPool();let conn;let failures=0,unknown=0;
  const check=(name,ok,detail)=>{const status=ok===true?'PASS':ok===false?'FAIL':'WARN';if(ok===false)failures++;if(ok===null)unknown++;printCheck(name,status,detail);};
  try{
    conn=await pool.getConnection();
    const [[v]]=await conn.query('SELECT VERSION() AS version');
    check('已适配的源端版本',/^8\.(0|4)\./.test(v.version)||/^10\.3\.39[-.].*MariaDB/i.test(v.version),v.version+'；MariaDB 源端应选择 MariaDB 到 MySQL 迁移任务');
    const [tables]=await conn.query('SELECT TABLE_NAME,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[dbName()]);
    for(const name of TRACKED_TABLES){
      const table=tables.find(r=>r.TABLE_NAME===name);
      check(name+' 存在且 InnoDB',Boolean(table&&table.ENGINE==='InnoDB'),table?.TABLE_COLLATION||'缺表');
      const [keys]=await conn.query("SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY'",[dbName(),name]);
      check(name+' 主键',keys.length>0,'');
      if(table)check(name+' 字符集',String(table.TABLE_COLLATION).startsWith('utf8mb4'),'');
      if(table)try{await conn.query('SELECT * FROM '+name+' LIMIT 0');check(name+' SELECT',true,'');}catch{check(name+' SELECT',false,'账号不能读取');}
    }
    const names=['log_bin','binlog_format','binlog_row_image','server_id','gtid_mode','binlog_expire_logs_seconds','expire_logs_days','lower_case_table_names'];
    const vars={};
    for(const name of names){const [rows]=await conn.query('SHOW GLOBAL VARIABLES LIKE ?',[name]);vars[name]=rows[0]?.Value??null;}
    check('log_bin',['ON','1'].includes(vars.log_bin),String(vars.log_bin));
    check('binlog_format',vars.binlog_format==='ROW',String(vars.binlog_format)+'；本实验选择 ROW');
    check('binlog_row_image',vars.binlog_row_image==='FULL',String(vars.binlog_row_image));
    check('server_id',Number(vars.server_id)>1,String(vars.server_id));
    console.log('INFO gtid_mode='+vars.gtid_mode+'；OFF 不自动判失败，采用的迁移模式由 DTS 校验确认');
    console.log('INFO lower_case_table_names='+vars.lower_case_table_names+'；请核对两端设置与小写表名');
    try{
      const [grants]=await conn.query('SHOW GRANTS FOR CURRENT_USER()');
      const text=grants.flatMap(r=>Object.values(r)).join(' ').toUpperCase();
      const all=/GRANT ALL PRIVILEGES ON \*\.\*/.test(text);
      for(const permission of ['REPLICATION SLAVE','REPLICATION CLIENT'])check(permission,all||text.includes(permission)?true:null,'权限来自当前账号；通过角色继承时需 DTS 控制台确认');
    }catch{check('迁移权限',null,'无法读取授权；不要将应用账号权限视作迁移账号权限');}
    try{await conn.query('SHOW MASTER STATUS');check('binlog 位点可读',true,'');}
    catch{try{await conn.query('SHOW BINARY LOG STATUS');check('binlog 位点可读',true,'');}catch{check('binlog 位点可读',false,'需要具备复制查看权限');}}
    if(process.env.APP_ENV_NAME==='AWS'){
      try{
        const [result]=await conn.query('CALL mysql.rds_show_configuration');
        const value=Array.isArray(result[0])?result[0].find(r=>r.name==='binlog retention hours')?.value:null;
        check('RDS binlog 保留至少 24 小时',value===null||value===undefined?null:Number(value)>=24,String(value));
      }catch{check('RDS binlog 保留时长',null,'无法读取，需在 RDS 配置中核实');}
    }else{
      const seconds=Number(vars.binlog_expire_logs_seconds)||Number(vars.expire_logs_days)*86400;
      check('本地 binlog 保留至少 24 小时',seconds>0?seconds>=86400:null,String(seconds));
    }
    check('DTS 网络、目标权限及任务预校验',null,'必须在 DTS 控制台执行，本地脚本无法验证跨云链路');
  }catch(e){check('连接或查询',false,e.code||e.message);}
  finally{if(conn)conn.release();await pool.end();}
  const code=failures?1:unknown?2:0;
  console.log(JSON.stringify({failures,unverified:unknown,exitCode:code}));
  console.log('退出码 0=本脚本覆盖项通过，1=明确失败，2=仍有待验证项。任何结果均不等同于 DTS 已迁移成功。');
  return code;
}
runScript(main);
