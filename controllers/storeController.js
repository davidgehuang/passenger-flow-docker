'use strict';

const storeModel = require('../models/storeModel');

const PAGE_SIZE = 15;

function sanitize(body) {
  return {
    store_code: String(body.store_code || '').trim(),
    store_name: String(body.store_name || '').trim(),
    region: String(body.region || '').trim(),
    city: String(body.city || '').trim(),
    address: String(body.address || '').trim(),
    business_type: String(body.business_type || '').trim(),
    opening_date: body.opening_date ? String(body.opening_date).trim() : null,
    status: String(body.status || 'ACTIVE').trim(),
  };
}

async function index(req, res, next) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const { rows, total } = await storeModel.list({
      page,
      pageSize: PAGE_SIZE,
      keyword: (req.query.keyword || '').trim(),
      status: (req.query.status || '').trim(),
    });
    res.render('stores/index', {
      title: '门店管理 - 企业客流管理系统',
      active: 'stores',
      stores: rows,
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      keyword: req.query.keyword || '',
      status: req.query.status || '',
    });
  } catch (err) {
    next(err);
  }
}

async function showNew(req, res, next) {
  try {
    res.render('stores/form', {
      title: '新增门店 - 企业客流管理系统',
      active: 'stores',
      store: null,
      action: '/stores',
      error: null,
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  const data = sanitize(req.body);
  try {
    if (!data.store_code || !data.store_name) {
      return res.status(400).render('stores/form', {
        title: '新增门店 - 企业客流管理系统',
        active: 'stores',
        store: data,
        action: '/stores',
        error: '门店编码与门店名称为必填项',
      });
    }
    await storeModel.create(data);
    req.flashMessage = '门店创建成功';
    res.redirect('/stores');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).render('stores/form', {
        title: '新增门店 - 企业客流管理系统',
        active: 'stores',
        store: data,
        action: '/stores',
        error: `门店编码 ${data.store_code} 已存在`,
      });
    }
    next(err);
  }
}

async function show(req, res, next) {
  try {
    const store = await storeModel.findById(Number(req.params.id));
    if (!store) return res.status(404).render('error', { title: '404', isDbError: false, error: 'NOT_FOUND', message: '门店不存在' });

    const [counts] = await require('../config/database').rawQuery("SELECT COUNT(*) AS events, COALESCE(SUM(CASE WHEN direction='IN' THEN people_count ELSE 0 END),0) AS in_people, COALESCE(SUM(CASE WHEN direction='OUT' THEN people_count ELSE 0 END),0) AS out_people FROM flow_events WHERE store_id=? AND event_time>=CURDATE() AND event_time<DATE_ADD(CURDATE(),INTERVAL 1 DAY)",[store.store_id]);
    store.today=counts;
    res.render('stores/show', { title: `${store.store_name} - 企业客流管理系统`, active: 'stores', store });
  } catch (err) {
    next(err);
  }
}

async function showEdit(req, res, next) {
  try {
    const store = await storeModel.findById(Number(req.params.id));
    if (!store) return res.status(404).render('error', { title: '404', isDbError: false, error: 'NOT_FOUND', message: '门店不存在' });
    res.render('stores/form', {
      title: `编辑门店 - 企业客流管理系统`,
      active: 'stores',
      store,
      action: `/stores/${store.store_id}`,
      error: null,
    });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  const data = sanitize(req.body);
  try {
    if (!data.store_code || !data.store_name) {
      return res.status(400).render('stores/form', {
        title: '编辑门店 - 企业客流管理系统',
        active: 'stores',
        store: { ...data, store_id: Number(req.params.id) },
        action: `/stores/${req.params.id}`,
        error: '门店编码与门店名称为必填项',
      });
    }
    if (!await storeModel.findById(Number(req.params.id))) return res.status(404).send('门店不存在');
    await storeModel.update(Number(req.params.id), data);
    res.redirect('/stores');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') { err.status=409; err.message='门店编码已存在'; }
    next(err);
  }
}

module.exports = { index, showNew, create, show, showEdit, update };

async function remove(req,res,next){
  try{await require('../services/managementService').remove('store',Number(req.params.id));res.redirect('/stores');}catch(e){next(e);}
}
module.exports.remove=remove;
