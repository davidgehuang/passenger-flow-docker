'use strict';
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<2)){
 console.error('需要 Node.js 22.2 以上，推荐 Node.js 24 LTS');process.exitCode=1;
}else console.log('Node.js '+process.versions.node+' 符合要求');
