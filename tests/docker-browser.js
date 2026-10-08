'use strict';
// This read-only browser acceptance uses only the explicitly named isolated stack.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const project = 'passenger-flow-docker-acceptance';
const childEnv = { ...process.env };
for (const key of ['DB_NAME','DB_USER','DB_PASSWORD','MYSQL_ROOT_PASSWORD','APP_AUTH_USER','APP_AUTH_PASSWORD','APP_HTTP_PORT','COMPOSE_PROJECT_NAME','COMPOSE_FILE','COMPOSE_PROFILES','COMPOSE_ENV_FILES']) delete childEnv[key];
const composeArgs = ['compose', '--project-name', project, '--env-file', '.env.docker.acceptance', '-f', 'compose.yaml'];
const invokeOptions = { cwd: root, env: childEnv, encoding: 'utf8', timeout: 30000 };
const config = JSON.parse(execFileSync('docker', [...composeArgs, 'config', '--format', 'json'], invokeOptions));
const env = config.services.app.environment;
const actual = Object.fromEntries(execFileSync('docker', [...composeArgs, 'config', '--environment'], invokeOptions).split(/\r?\n/).filter(line => line.includes('=')).map(line => [line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));
for (const key of ['APP_AUTH_USER','APP_AUTH_PASSWORD']) env[key] = actual[key];
const base = 'http://127.0.0.1:' + config.services.app.ports[0].published;
const output = path.join(root, 'reports', 'docker-browser');
const report = { project, startedAt: new Date().toISOString(), pages: [], browserErrors: [], externalRequests: [] };
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const anonymous = await browser.newContext();
    assert.equal((await anonymous.request.get(base + '/metrics')).status(), 401);
    await anonymous.close();
    const context = await browser.newContext({ httpCredentials: { username: env.APP_AUTH_USER, password: env.APP_AUTH_PASSWORD }, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => report.browserErrors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin !== base) { report.externalRequests.push('external resource blocked'); return route.abort(); }
      return route.continue();
    });
    for (const [name, url] of [['dashboard','/'],['stores','/stores'],['devices','/devices'],['events','/flow-events'],['lab','/migration-lab'],['migration','/migration-check'],['health','/system-health']]) {
      const start = Date.now();
      assert.equal((await page.goto(base + url, { timeout: 30000 })).status(), 200);
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      // Flow Events also has a pagination nav once rows exist.
      assert.equal(await page.locator('nav.navbar').count(), 1);
      if (name === 'dashboard') assert.equal(await page.evaluate(() => Object.keys(globalThis.Chart.instances).length), 6);
      await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
      report.pages.push({ path: url, status: 200, elapsedMs: Date.now() - start });
    }
    assert.equal(report.browserErrors.length, 0);
    assert.equal(report.externalRequests.length, 0);
    const storage = await context.request.get(base + '/api/database-storage');
    assert.equal(storage.status(), 200);
    report.storage = await storage.json();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/'); await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.failure = String(error.message);
    for (const value of [env.APP_AUTH_PASSWORD, env.DB_PASSWORD]) {
      if (value) report.failure = report.failure.split(value).join('[redacted]');
    }
    throw error;
  } finally {
    await browser.close();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  }
  console.log('Browser acceptance PASS: ' + report.pages.length + ' pages; artifacts in reports/docker-browser.');
}
main().catch(() => { console.error('Browser acceptance failed; inspect the local report. No credentials printed.'); process.exitCode = 1; });
