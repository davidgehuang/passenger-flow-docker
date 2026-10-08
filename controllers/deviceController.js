'use strict';

const deviceModel = require('../models/deviceModel');
const storeModel = require('../models/storeModel');

const PAGE_SIZE = 15;

function sanitize(body) {
  return {
    device_name: String(body.device_name || '').trim(),
    device_type: String(body.device_type || 'CAMERA').trim(),
    ip_address: String(body.ip_address || '').trim(),
    firmware_version: String(body.firmware_version || '').trim(),
    store_id: Number(body.store_id) || 0,
    status: String(body.status || 'ONLINE').trim(),
  };
}

async function index(req, res, next) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const { rows, total } = await deviceModel.list({
      page,
      pageSize: PAGE_SIZE,
      keyword: (req.query.keyword || '').trim(),
      status: (req.query.status || '').trim(),
      storeId: (req.query.storeId || '').trim(),
    });
    res.render('devices/index', {
      title: '设备管理 - 企业客流管理系统',
      active: 'devices',
      devices: rows,
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      keyword: req.query.keyword || '',
      status: req.query.status || '',
      storeId: req.query.storeId || '',
    });
  } catch (err) {
    next(err);
  }
}

async function show(req, res, next) {
  try {
    const device = await deviceModel.findById(Number(req.params.id));
    if (!device) return res.status(404).render('error', { title: '404', isDbError: false, error: 'NOT_FOUND', message: '设备不存在' });
    res.render('devices/show', { title: `${device.device_name} - 企业客流管理系统`, active: 'devices', device });
  } catch (err) {
    next(err);
  }
}

async function showEdit(req, res, next) {
  try {
    const [device, stores] = await Promise.all([
      deviceModel.findById(Number(req.params.id)),
      storeModel.listAll(),
    ]);
    if (!device) return res.status(404).render('error', { title: '404', isDbError: false, error: 'NOT_FOUND', message: '设备不存在' });
    res.render('devices/form', {
      title: '编辑设备 - 企业客流管理系统',
      active: 'devices',
      device,
      stores,
      error: null,
    });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  const data = sanitize(req.body);
  try {
    if (!await deviceModel.findById(Number(req.params.id))) return res.status(404).send('设备不存在');
    if (!data.device_name || !data.store_id) {
      const stores = await storeModel.listAll();
      const device = await deviceModel.findById(Number(req.params.id));
      return res.status(400).render('devices/form', {
        title: '编辑设备 - 企业客流管理系统',
        active: 'devices',
        device,
        stores,
        error: '设备名称与所属门店为必填项',
      });
    }
    if (!await storeModel.findById(data.store_id)) return res.status(400).send('所属门店不存在');
    if (!await deviceModel.findById(Number(req.params.id))) return res.status(404).send('设备不存在');
    await require('../services/managementService').updateDevice(Number(req.params.id), data);
    res.redirect('/devices');
  } catch (err) {
    next(err);
  }
}

module.exports = { index, show, showEdit, update };

async function showNew(req,res,next){
  try{res.render('devices/form',{title:'新增设备',active:'devices',device:{device_code:'',device_name:'',device_type:'ENTRANCE_CAMERA',ip_address:'',firmware_version:'',status:'ONLINE',store_id:''},stores:await storeModel.listAll(),error:null});}catch(e){next(e);}
}
async function create(req,res,next){
  try{
    const data={...sanitize(req.body),device_code:String(req.body.device_code||'').trim()};
    if(!data.device_code||!data.device_name||!data.store_id)return res.status(400).send('设备编码、名称和所属门店必填');
    await require('../services/managementService').createDevice(data);res.redirect('/devices');
  }catch(e){if(e.code==='ER_DUP_ENTRY')e.status=409;next(e);}
}
async function remove(req,res,next){
  try{await require('../services/managementService').remove('device',Number(req.params.id));res.redirect('/devices');}catch(e){next(e);}
}
module.exports.showNew=showNew;module.exports.create=create;module.exports.remove=remove;
