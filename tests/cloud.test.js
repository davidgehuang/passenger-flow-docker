'use strict';
const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const {identifier, sqlString} = require('../scripts/cloud-db');
const settings = require('../config/settings');
const {poolEnd} = require('../config/database');
after(poolEnd);
test('云端SQL账号及库名边界与密码标准转义', () => {
  assert.throws(() => identifier('bad;drop'));
  assert.throws(() => identifier(''));
  assert.equal(sqlString("a$#'\\ b"), "'a$#''\\ b'");
  assert.throws(() => sqlString('x\n'));
});
test('云端TLS身份验证显式开启，默认不改变旧环境', () => {
  const old = {ssl:process.env.DB_SSL, identity:process.env.DB_SSL_VERIFY_IDENTITY};
  try {
    process.env.DB_SSL='true'; delete process.env.DB_SSL_VERIFY_IDENTITY;
    assert.equal(settings.options().ssl.verifyIdentity, false);
    process.env.DB_SSL_VERIFY_IDENTITY='true';
    assert.equal(settings.options().ssl.verifyIdentity, true);
    assert.equal(settings.options().ssl.rejectUnauthorized, true);
  } finally {
    for (const [key,value] of [['DB_SSL',old.ssl],['DB_SSL_VERIFY_IDENTITY',old.identity]]) {
      if(value === undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});
