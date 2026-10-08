'use strict';
const {integer}=require('../config/settings');
const limits={store_code:64,device_code:64,store_name:128,region:64,city:64,address:255,business_type:64,device_name:128,device_type:64,ip_address:64,firmware_version:64,message:255};
function date(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z')))return false;
  return new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
module.exports=function validation(req,res,next){
  try{
    for(const [key,value]of Object.entries(req.query)){
      if(typeof value!=='string')throw new Error('查询参数 '+key+' 必须是单个字符串');
      if(value.length>(req.path==='/api/base-data/preview'&&key==='payload'?12000:255))throw new Error('查询参数过长');
    }
    if(req.query.page!==undefined)integer(req.query.page,'page',1,1000000,1);
    for(const k of ['storeId'])if(req.query[k])integer(req.query[k],k,1,Number.MAX_SAFE_INTEGER,1);
    for(const k of ['dateFrom','dateTo'])if(req.query[k]&&!date(req.query[k]))throw new Error('日期格式必须为 YYYY-MM-DD');
    if(req.query.dateFrom&&req.query.dateTo&&req.query.dateFrom>req.query.dateTo)throw new Error('开始日期不能晚于结束日期');
    if(req.query.direction&&!['IN','OUT'].includes(req.query.direction))throw new Error('方向必须为 IN 或 OUT');
    const id=req.path.match(/^\/(stores|devices)\/([^/]+)/);
    if(id&&id[2]!=='new')integer(id[2],'id',1,Number.MAX_SAFE_INTEGER,1);
    for(const [key,max]of Object.entries(limits))if(req.body?.[key]!==undefined&&(typeof req.body[key]!=='string'||req.body[key].length>max))throw new Error(key+' 字段类型或长度不正确');
    if(req.body?.opening_date&&!date(req.body.opening_date))throw new Error('开业日期无效');
    if(req.body?.store_id!==undefined)integer(req.body.store_id,'store_id',1,Number.MAX_SAFE_INTEGER,1);
    if(req.body?.status){
      const allowed=req.path.startsWith('/devices')?['ONLINE','OFFLINE','WARNING','MAINTENANCE']:['ACTIVE','MAINTENANCE','CLOSED'];
      if(!allowed.includes(req.body.status))throw new Error('状态值无效');
    }
    next();
  }catch(e){e.status=400;next(e);}
};
