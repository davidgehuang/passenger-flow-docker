'use strict';

const express = require('express');
const router = express.Router();

const dashboardController = require('../controllers/dashboardController');
const storeRoutes = require('./storeRoutes');
const deviceRoutes = require('./deviceRoutes');
const flowEventRoutes = require('./flowEventRoutes');
const healthRoutes = require('./healthRoutes');
const migrationRoutes = require('./migrationRoutes');

router.use((req,res,next)=>{
  if(!['GET','HEAD','OPTIONS'].includes(req.method))res.on('finish',()=>{
    if(res.statusCode<400)require('../services/storageService').invalidate();
  });
  next();
});
router.get('/api/database-storage', async (req,res,next)=>{
  try { res.set('Cache-Control','no-store');res.json(await require('../services/storageService').get()); }
  catch(e){next(e);}
});
router.use(require('./baseDataRoutes'));
router.get('/', dashboardController.index);
router.use('/stores', storeRoutes);
router.use('/devices', deviceRoutes);
router.use('/flow-events', flowEventRoutes);
router.use(healthRoutes);
router.use(migrationRoutes);

module.exports = router;
