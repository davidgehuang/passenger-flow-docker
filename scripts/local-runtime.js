'use strict';
// 项目内的便携 MySQL，仅监听回环；不注册系统服务。
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawn,spawnSync}=require('child_process');
const mysql=require('mysql2/promise');
const dotenv=require('dotenv');
const root=path.resolve(__dirname,'..'),home=path.join(root,'.local-mysql'),base=path.join(home,'mysql-8.0.46-winx64');
const envFile=path.join(root,'.env.local'),data=path.join(home,'data'),exe=path.join(base,'bin','mysqld.exe');
const port=33317;
async function connect(password=''){return mysql.createConnection({host:'127.0.0.1',port,user:'root',password,connectTimeout:1000});}
async function main(){
  if(process.platform!=='win32')throw new Error('此入口仅用于 Windows；Linux 请使用部署手册');
  const action=process.argv[2]||'start';
  let env=fs.existsSync(envFile)?dotenv.parse(fs.readFileSync(envFile)):{};
  if(action==='stop'){
    const conn=await connect(env.DB_PASSWORD||'');
    try {
      const [[identity]]=await conn.query('SELECT @@datadir AS directory');
      if(path.resolve(identity.directory).toLowerCase()!==path.resolve(data).toLowerCase())throw new Error('端口对应的数据库不是本项目实例，拒绝停止');
      await conn.query('SHUTDOWN');console.log('本地 MySQL 已停止');
    } finally { await conn.end(); }
    return;
  }
  if(!fs.existsSync(exe))throw new Error('缺少便携 MySQL，请先运行 npm run local:download');
  const isNew=!fs.existsSync(data);
  if(isNew){
    fs.mkdirSync(data,{recursive:true});
    const r=spawnSync(exe,['--no-defaults','--initialize-insecure','--basedir='+base,'--datadir='+data],{windowsHide:true,encoding:'utf8'});
    if(r.status!==0)throw new Error('初始化失败；请查看 .local-mysql/data 下的 .err 日志。目录保留，未删除。');
  }
  let conn;
  try{conn=await connect(env.DB_PASSWORD||'');}
  catch(e){
    if(e.code==='ER_ACCESS_DENIED_ERROR')throw new Error('33317 已有数据库或本地凭据不匹配，拒绝覆盖');
    const log=fs.openSync(path.join(home,'mysql-console.log'),'a');
    const child=spawn(exe,['--no-defaults','--basedir='+base,'--datadir='+data,'--port='+port,'--bind-address=127.0.0.1','--mysqlx=0','--server-id=317','--log-bin=local-bin','--binlog-format=ROW','--binlog-row-image=FULL','--binlog-expire-logs-seconds=86400','--innodb-buffer-pool-size=128M','--console'],{windowsHide:true,detached:true,stdio:['ignore',log,log]});
    child.unref();fs.closeSync(log);
    fs.writeFileSync(path.join(home,'mysql.pid'),String(child.pid));
    for(let i=0;i<60;i++){try{conn=await connect(env.DB_PASSWORD||'');break;}catch{await new Promise(r=>setTimeout(r,500));}}
    if(!conn)throw new Error('MySQL 启动失败，查看 .local-mysql/mysql-console.log');
  }
  try{
    const [[identity]]=await conn.query('SELECT @@datadir AS directory');
    if(path.resolve(identity.directory).toLowerCase()!==path.resolve(data).toLowerCase())throw new Error('端口对应的数据库不是本项目实例，停止操作');
    if(!fs.existsSync(envFile)){
      const password=crypto.randomBytes(24).toString('hex');
      // 先保存配置，避免改密成功后异常退出导致密码丢失。
      env={NODE_ENV:'development',APP_ENV_NAME:'LOCAL',BIND_HOST:'127.0.0.1',PORT:'3030',DB_HOST:'127.0.0.1',DB_PORT:String(port),DB_NAME:'passenger_flow_local',DB_USER:'root',DB_PASSWORD:password,DB_TIME_ZONE:'+08:00',DB_SSL:'false',MAINTENANCE_MODE:'false'};
      fs.writeFileSync(envFile,Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n',{flag:'wx'});
      await conn.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?",[password]);
    }
    console.log('本地 MySQL 8.0 就绪，配置使用 .env.local；原 .env 未改动。');
  }finally{await conn.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
