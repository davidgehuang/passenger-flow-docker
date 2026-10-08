'use strict';
// 仅由cloud-container.py传入其独立项目配置；不读取用户.env。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
async function main() {
  const configFile = process.env.CLOUD_TEST_CONFIG;
  if (!configFile || !path.resolve(configFile).includes(path.sep + '.cloud-local' + path.sep + 'pf-cloud-check-')) throw new Error('Isolated test config required');
  const c = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const base = 'http://127.0.0.1:3032';
  const output = path.resolve(__dirname, '../reports/cloud-browser');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const report = { pages: [], browserErrors: [], externalRequests: [] };
  try {
    const context = await browser.newContext({ httpCredentials: { username: c.app_user, password: c.app_password }, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', () => report.browserErrors.push('browser script error'));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin !== base) { report.externalRequests.push('external resource'); return route.abort(); }
      return route.continue();
    });
    for (const [name, url] of [['dashboard','/'], ['stores','/stores'], ['devices','/devices'], ['events','/flow-events'],
      ['lab','/migration-lab'], ['migration','/migration-check'], ['health','/system-health']]) {
      const start = Date.now();
      assert.equal((await page.goto(base + url)).status(), 200);
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('nav.navbar').count(), 1);
      await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
      report.pages.push({ path: url, status: 200, elapsedMs: Date.now()-start });
    }
    assert.equal(report.browserErrors.length, 0);
    assert.equal(report.externalRequests.length, 0);
    const denied = await context.request.post(base + '/migration-lab/insert', {
      headers: { Origin: 'https://untrusted.example' }, data: { rows: 1 }
    });
    assert.equal(denied.status(), 403);
    const inserted = await context.request.post(base + '/migration-lab/insert', {
      headers: { Origin: base }, data: { rows: 1 }
    });
    assert.equal(inserted.status(), 200);
    assert.equal((await inserted.json()).result.insertedRows, 1);
    report.sameOriginWrite = 'PASS';
    report.crossOriginRejected = 'PASS';
    report.status = 'PASS';
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  }
  console.log('Isolated cloud browser PASS: 7 pages');
}
main().catch(() => { console.error('Isolated cloud browser failed; no credentials logged.'); process.exitCode = 1; });
