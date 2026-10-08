'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const {spawn}=require('child_process');
const root=path.resolve(__dirname,'..','.local-mysql');
const url='https://cdn.mysql.com/Downloads/MySQL-8.0/mysql-8.0.46-winx64.zip';
const length=248009349;
async function download(start,end,file){
  if(fs.existsSync(file)&&fs.statSync(file).size===end-start+1)return;
  await new Promise((resolve,reject)=>{
    const c=spawn('curl.exe',['--fail','--silent','--show-error','--retry','3','--retry-all-errors','--max-time','90','--range',start+'-'+end,'--output',file,url+'?part='+start],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let error='';c.stderr.on('data',b=>error+=b);c.on('error',reject);c.on('exit',code=>code===0?resolve():reject(new Error('官方下载失败 '+code+' '+error)));
  });
  if(fs.statSync(file).size!==end-start+1)throw new Error('Range 长度不符');
}
async function main(){
  fs.mkdirSync(root,{recursive:true});const tailPath=path.join(root,'zip-tail.bin');
  await download(length-65536,length-1,tailPath);
  const tail=fs.readFileSync(tailPath);let e=tail.length-22;
  while(e>=0&&tail.readUInt32LE(e)!==0x06054b50)e--;
  if(e<0)throw new Error('ZIP 索引不存在');
  let i=tail.readUInt32LE(e+16)-(length-65536);if(i<0)throw new Error('ZIP 索引超出范围');
  const entries=[];
  while(i<tail.length&&tail.readUInt32LE(i)===0x02014b50){
    const n=tail.readUInt16LE(i+28),ex=tail.readUInt16LE(i+30),c=tail.readUInt16LE(i+32);
    entries.push({name:tail.subarray(i+46,i+46+n).toString(),size:tail.readUInt32LE(i+20),offset:tail.readUInt32LE(i+42),method:tail.readUInt16LE(i+10),crc:tail.readUInt32LE(i+16)});
    i+=46+n+ex+c;
  }
  const selected=entries.filter(x=>x.size>0&&!/-debug/.test(x.name)&&(/\/bin\/(mysqld\.exe|mysql\.exe|mysqladmin\.exe|.*\.dll)$/.test(x.name)||/\/lib\/private\//.test(x.name)||/\/share\/(english\/|charsets\/)/.test(x.name)||/\/(LICENSE|README)$/.test(x.name)));
  const jobs=[];
  for(const entry of selected){
    if(entry.name.includes('..')||!entry.name.startsWith('mysql-8.0.46-winx64/'))throw new Error('ZIP 路径无效');
    entry.parts=[];
    const end=entry.offset+entry.size+1024;
    for(let start=entry.offset;start<end;start+=524288){
      const last=Math.min(end-1,start+524287),file=path.join(root,'range-'+start+'-'+last);
      entry.parts.push(file);jobs.push(()=>download(start,last,file));
    }
  }
  let cursor=0,done=0;
  await Promise.all(Array.from({length:8},async()=>{while(cursor<jobs.length){const job=jobs[cursor++];await job();done++;if(done%20===0)console.log('下载分段 '+done+'/'+jobs.length);}}));
  const inventory=[];
  for(const entry of selected){
    const data=Buffer.concat(entry.parts.map(f=>fs.readFileSync(f)));
    if(data.readUInt32LE(0)!==0x04034b50)throw new Error('ZIP 文件头不符 '+entry.name);
    const offset=30+data.readUInt16LE(26)+data.readUInt16LE(28);
    const compressed=data.subarray(offset,offset+entry.size);
    const bytes=entry.method===8?zlib.inflateRawSync(compressed):compressed;
    if(zlib.crc32(bytes)!==entry.crc)throw new Error('CRC 不符 '+entry.name);
    const target=path.join(root,entry.name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
    inventory.push({name:entry.name,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }
  fs.writeFileSync(path.join(root,'runtime-manifest.json'),JSON.stringify({url,version:'8.0.46',files:inventory},null,2));
  console.log('MySQL 8.0.46 便携运行文件就绪，CRC 全部通过。');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
