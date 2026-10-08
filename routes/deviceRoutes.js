'use strict';

const express = require('express');
const router = express.Router();
const controller = require('../controllers/deviceController');

router.get('/', controller.index);
router.get('/new', controller.showNew);
router.post('/', controller.create);
router.post('/:id/delete', controller.remove);
router.get('/:id', controller.show);
router.get('/:id/edit', controller.showEdit);
router.post('/:id', controller.update);

module.exports = router;
