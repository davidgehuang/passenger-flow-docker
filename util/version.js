'use strict';

// 版本信息：APP_VERSION 优先取环境变量，GIT_COMMIT 优先取 git 命令，失败回退环境变量

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

function readGitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    })
      .toString()
      .trim();
  } catch {
    return process.env.GIT_COMMIT && process.env.GIT_COMMIT.trim() ? process.env.GIT_COMMIT.trim() : 'unknown';
  }
}

const GIT_COMMIT = readGitCommit();
const APP_VERSION = process.env.APP_VERSION && process.env.APP_VERSION.trim() ? process.env.APP_VERSION.trim() : `v${pkg.version}`;

module.exports = { APP_VERSION, GIT_COMMIT };
