'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const env = { ...process.env, ENV_FILE: path.join(root, 'tests', '__no_user_config__') };
// Unit tests must not load or connect to a user's Docker/cloud database.
for (const key of Object.keys(env)) {
  if (/^(DB_|APP_AUTH_|APP_ENV_NAME$|BIND_HOST$|CONTAINER_RUNTIME$|NODE_ENV$|MAINTENANCE_MODE$|MAINTENANCE_FILE$|AUTO_INIT_SCHEMA$|SEED_DEMO_DATA$|ENABLE_CONTINUOUS_WORKLOAD$)/.test(key)) delete env[key];
}
const result = spawnSync(process.execPath, ['--test', 'tests/unit.test.js', 'tests/storage.test.js', 'tests/container.test.js', 'tests/cloud.test.js'], { cwd: root, env, stdio: 'inherit' });
if (result.error) console.error(result.error.code);
process.exitCode = result.status === null ? 1 : result.status;
