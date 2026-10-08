'use strict';

const dashboardService = require('../services/dashboardService');

async function index(req, res, next) {
  try {
    const [summary, charts] = await Promise.all([
      dashboardService.getSummary(),
      dashboardService.getCharts(),
    ]);
    res.render('dashboard', {
      title: 'Dashboard - 企业客流管理系统',
      active: 'dashboard',
      summary,
      chartsJson: JSON.stringify(charts).replace(/</g, '\\u003c'),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { index };
