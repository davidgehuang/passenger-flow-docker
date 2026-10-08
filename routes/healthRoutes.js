'use strict';

const express = require('express');
const router = express.Router();
const controller = require('../controllers/healthController');

router.get('/live', (req, res) => res.json({ status: 'UP' }));
router.get('/health', controller.health);
router.get('/system-health', controller.systemHealthPage);

module.exports = router;
