'use strict';

// npm run migration:marker -- --type PRE_DTS [--message "..."] [--batch-uuid "..."]
// 创建迁移标记（写入 migration_markers，sequence 单调递增）

require('../config/settings');

const { parseArgs } = require('./lib/common');
const markerModel = require('../models/markerModel');
const { poolEnd } = require('../config/database');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const type = String(args.type || (args.note ? 'DURING_DTS' : '')).toUpperCase();

  if (!type || !markerModel.MARKER_TYPES.includes(type)) {
    console.log('用法: npm run migration:marker -- --type <MARKER_TYPE> [--message "备注"] [--batch-uuid "批次"]');
    console.log('');
    console.log('可用的 Marker 类型:');
    markerModel.MARKER_TYPES.forEach((t) => console.log(`  - ${t}`));
    await poolEnd();
    process.exitCode = 1;
    return;
  }

  const result = await markerModel.create({
    type,
    message: String(args.message || args.note || ''),
    batchUuid: String(args['batch-uuid'] || ''),
    operationType: 'MARKER',
  });

  console.log('Migration Marker 创建成功:');
  console.log(`  sequence_number: ${result.sequence}`);
  console.log(`  marker_uuid:     ${result.markerUuid}`);
  console.log(`  marker_type:     ${result.markerType}`);
  console.log(`  source_env:      ${result.sourceEnv}`);
  console.log(`  message:         ${args.message || ''}`);

  const stats = await markerModel.stats();
  console.log('');
  console.log(`当前 markers 总数: ${stats.count}（sequence ${stats.minSequence} ~ ${stats.maxSequence}）`);

  await poolEnd();
}

main().catch(async (err) => {
  console.error(`[ERROR] ${err.code || ''} ${err.message}`.trim());
  await poolEnd().catch(() => {});
  process.exit(1);
});
