'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),target=path.join(root,'artifacts','passenger-flow-system-codex-'+new Date().toISOString().replace(/[:.]/g,'-')),manifest=[];
function copy(relative){
 const source=path.join(root,relative);
 if(fs.lstatSync(source).isSymbolicLink())throw new Error('拒绝导出符号链接 '+relative);
 if(fs.statSync(source).isDirectory()){for(const name of fs.readdirSync(source))copy(path.join(relative,name));return;}
 if(/(^|[\\/])\.env(?!\.example$)|\.(pem|key|p12|pfx|log|dump|bak)$/i.test(relative))throw new Error('请检查敏感文件 '+relative);
 const data=fs.readFileSync(source),out=path.join(target,relative);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,data,{flag:'wx'});
 manifest.push({file:relative.split(path.sep).join('/'),sha256:crypto.createHash('sha256').update(data).digest('hex')});
}
fs.mkdirSync(target,{recursive:true});
for(const name of ['config','controllers','db','deploy','docs','middleware','models','routes','scripts','services','tests','util','views','.env.example','.gitignore','.gitattributes','package.json','package-lock.json','app.js','eslint.config.js','README.md',...fs.readdirSync(root).filter(f=>f.endsWith('.bat'))])copy(name);
for(const name of fs.readdirSync(path.join(root,'public')).filter(f=>f!=='vendor'))copy(path.join('public',name));
fs.writeFileSync(path.join(target,'SOURCE-MANIFEST.json'),JSON.stringify(manifest,null,2));
console.log('源码导出: '+target);console.log('不含 .git、.env、运行时和数据；上传前仍需审阅源码是否包含个人信息。');
