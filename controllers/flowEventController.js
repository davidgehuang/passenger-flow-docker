'use strict';

const flowEventModel = require('../models/flowEventModel');
const storeModel = require('../models/storeModel');

const PAGE_SIZE = 30;

async function index(req, res, next) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const filters = {
      storeId: (req.query.storeId || '').trim(),
      direction: (req.query.direction || '').trim(),
      dateFrom: (req.query.dateFrom || '').trim(),
      dateTo: (req.query.dateTo || '').trim(),
    };
    const [{ rows, total }, stores] = await Promise.all([
      flowEventModel.list({ page, pageSize: PAGE_SIZE, ...filters }),
      storeModel.listAll(),
    ]);
    res.render('flow-events/index', {
      title: '客流事件 - 企业客流管理系统',
      active: 'flow-events',
      events: rows,
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      stores,
      filters,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { index };
