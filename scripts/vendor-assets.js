'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),target=path.join(root,'public','vendor');
fs.mkdirSync(target,{recursive:true});
for(const [from,to]of [
 ['bootstrap/dist/css/bootstrap.min.css','bootstrap.min.css'],
 ['bootstrap/dist/js/bootstrap.bundle.min.js','bootstrap.bundle.min.js'],
 ['chart.js/dist/chart.umd.js','chart.umd.js'],
 ['bootstrap-icons/font/bootstrap-icons.css','bootstrap-icons.css'],
 ['bootstrap-icons/font/fonts/bootstrap-icons.woff2','fonts/bootstrap-icons.woff2'],
 ['bootstrap-icons/font/fonts/bootstrap-icons.woff','fonts/bootstrap-icons.woff'],
 ['bootstrap/LICENSE','licenses/bootstrap.txt'],['bootstrap-icons/LICENSE','licenses/bootstrap-icons.txt'],['chart.js/LICENSE.md','licenses/chartjs.txt']
]){
  const dest=path.join(target,to);fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.copyFileSync(path.join(root,'node_modules',from),dest);
}
console.log('前端资源已复制到 public/vendor，运行不依赖 CDN。');
