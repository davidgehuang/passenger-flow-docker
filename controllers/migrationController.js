'use strict';

// Migration Check 页面 + DTS Migration Lab 控制台（页面 / 操作 API / 状态轮询）

const migrationLabService = require('../services/migrationLabService');
const workloadService = require('../services/workloadService');
const markerModel = require('../models/markerModel');
const batchModel = require('../models/batchModel');
const { getDbConfigInfo } = require('../config/database');
const { formatMB } = require('../util/helpers');
const { APP_VERSION, GIT_COMMIT } = require('../util/version');

// ---------- 页面 ----------

async function checkPage(req, res, next) {
  try {
    const { dbVersion, storageResult, tableStats } = await migrationLabService.getMigrationCheckData();
    const info = getDbConfigInfo();
    res.render('migration-check', {
      title: 'Migration Check - 企业客流管理系统',
      active: 'migration-check',
      info: {
        ...info,
        dbVersion,
        storageResult,
      },
      tables: tableStats.map((t) => ({
        name: t.table_name,
        rowsApprox: Number(t.approx_rows || 0).toLocaleString('en-US'),
        dataSizeMB: formatMB(t.data_length),
        indexSizeMB: formatMB(t.index_length),
        dataFreeMB: formatMB(t.data_free),
        totalSizeMB: formatMB(t.total_size),
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function labPage(req, res, next) {
  try {
    const [overview, workload, markers, batches, markerStats, batchCount] = await Promise.all([
      migrationLabService.getOverview(),
      workloadService.getStatus(),
      markerModel.list({ limit: 30 }),
      batchModel.latest(10),
      markerModel.stats(),
      batchModel.count(),
    ]);

    res.render('migration-lab', {
      title: 'DTS Migration Lab - 企业客流管理系统',
      active: 'migration-lab',
      info: getDbConfigInfo(),
      overview,
      workload,
      markers,
      batches,
      markerStats,
      batchCount,
      markerTypes: markerModel.MARKER_TYPES,
      formatMB,
      formatNumber: (v) => Number(v || 0).toLocaleString('en-US'),
      appVersion: APP_VERSION,
      gitCommit: GIT_COMMIT,
    });
  } catch (err) {
    next(err);
  }
}

// ---------- 状态轮询（AJAX） ----------

async function status(req, res, next) {
  try {
    const [overview, workload, markers] = await Promise.all([
      migrationLabService.getOverview(),
      workloadService.getStatus(),
      markerModel.list({ limit: 10 }),
    ]);
    res.json({
      status: 'OK',
      overview,
      workload,
      markers,
    });
  } catch (err) {
    next(err);
  }
}

// ---------- 动态实验操作 ----------

async function opInsert(req, res, next) {
  try {
    const rows = req.body.rows ?? 1000;
    const result = await migrationLabService.insertRows(rows);
    res.json({ status: 'OK', result });
  } catch (err) {
    next(err);
  }
}

async function opUpdate(req, res, next) {
  try {
    const rows = req.body.rows ?? 1000;
    const result = await migrationLabService.updateRows(rows);
    res.json({ status: 'OK', result });
  } catch (err) {
    next(err);
  }
}

async function opDelete(req, res, next) {
  try {
    const rows = req.body.rows ?? 1000;
    const result = await migrationLabService.deleteRows(rows);
    res.json({ status: 'OK', result });
  } catch (err) {
    next(err);
  }
}

async function opGenerate(req, res, next) {
  try {
    const targetMB = req.body.targetMB ?? 10;
    const result = await migrationLabService.generateSize(targetMB);
    res.json({ status: 'OK', result });
  } catch (err) {
    next(err);
  }
}

async function opPurge(req, res, next) {
  try {
    const targetMB = req.body.targetMB ?? 10;
    const result = await migrationLabService.purgeSize(targetMB);
    res.json({ status: 'OK', result });
  } catch (err) {
    next(err);
  }
}

async function opMarker(req, res, next) {
  try {
    const type = String(req.body.type || '').trim();
    const message = String(req.body.message || '').trim();
    if (!markerModel.MARKER_TYPES.includes(type)) {
      return res.status(400).json({ status: 'ERROR', message: `无效的 marker 类型，可选: ${markerModel.MARKER_TYPES.join(', ')}` });
    }
    const result = await migrationLabService.createMarker(type, message);
    res.json({ status: 'OK', result });
  } catch (err) {
    next(err);
  }
}

async function opWorkloadStart(req, res, next) {
  try {
    const result = await workloadService.start({
      qps: req.body.qps ?? 20,
      insertPercent: Number(req.body.insertPercent ?? 70),
      updatePercent: Number(req.body.updatePercent ?? 20),
      deletePercent: Number(req.body.deletePercent ?? 10),
    });
    res.json({ status: 'OK', result });
  } catch (err) {
    next(err);
  }
}

async function opWorkloadStop(req, res, next) {
  try {
    const result = await workloadService.stop();
    res.json({ status: 'OK', result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  checkPage,
  labPage,
  status,
  opInsert,
  opUpdate,
  opDelete,
  opGenerate,
  opPurge,
  opMarker,
  opWorkloadStart,
  opWorkloadStop,
};
