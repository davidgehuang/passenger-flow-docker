'use strict';

const express = require('express');
const router = express.Router();
const controller = require('../controllers/migrationController');

// 页面
router.get('/migration-check', controller.checkPage);
router.get('/migration-lab', controller.labPage);

// 状态轮询（AJAX）
router.get('/migration-lab/status', controller.status);

// 动态实验操作（POST）
router.post('/migration-lab/insert', controller.opInsert);
router.post('/migration-lab/update', controller.opUpdate);
router.post('/migration-lab/delete', controller.opDelete);
router.post('/migration-lab/generate', controller.opGenerate);
router.post('/migration-lab/purge', controller.opPurge);
router.post('/migration-lab/marker', controller.opMarker);

// Continuous Workload 控制
router.post('/migration-lab/workload/start', controller.opWorkloadStart);
router.post('/migration-lab/workload/stop', controller.opWorkloadStop);

module.exports = router;
