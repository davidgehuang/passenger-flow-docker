'use strict';
const router = require('express').Router();
const service = require('../services/baseDataService');
router.get('/base-data', async (req,res,next)=>{
  try { res.render('base-data',{title:'基础资料初始化／扩容',stores:await require('../models/storeModel').listAll()}); } catch(e){next(e);}
});
router.get('/api/base-data/preview', async (req,res,next)=>{
  try {
    res.set('Cache-Control','no-store');
    const input=req.query.payload ? JSON.parse(req.query.payload) : req.query;
    res.json(await service.preview(input));
  } catch(e){if(e instanceof SyntaxError)e.status=400;next(e);}
});
router.post('/api/base-data/execute', async (req,res,next)=>{
  try {res.json(await service.execute(req.body));}catch(e){next(e);}
});
module.exports=router;
