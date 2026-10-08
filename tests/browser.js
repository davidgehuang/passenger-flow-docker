'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base='http://127.0.0.1:'+(process.env.APP_TEST_PORT||3030),dir=path.resolve(__dirname,'../reports/browser');
async function main(){
 fs.mkdirSync(dir,{recursive:true});const report={startedAt:new Date().toISOString(),checks:[],errors:[],externalRequests:[]};
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){report.externalRequests.push(route.request().url());return route.abort();}return route.continue();});
  for(const [name,url] of [['dashboard','/'],['stores','/stores'],['devices','/devices'],['events','/flow-events'],['lab','/migration-lab']]){
   assert.equal((await page.goto(base+url)).status(),200);await page.waitForLoadState('networkidle');
   if(name==='dashboard'){assert.equal(await page.evaluate(()=>Object.keys(globalThis.Chart.instances).length),6);report.checks.push('6 charts rendered');}
   await page.screenshot({path:path.join(dir,name+'.png'),fullPage:true});report.checks.push(url+' 200');
  }
  const code='BROWSER_'+Date.now();
  await page.goto(base+'/devices/new');await page.locator('[name=device_code]').fill(code);await page.locator('[name=device_name]').fill('浏览器验证设备');
  await Promise.all([page.waitForURL(base+'/devices'),page.locator('form button[type=submit]').click()]);
  await page.goto(base+'/devices?keyword='+code);assert.ok((await page.locator('body').innerText()).includes(code));report.checks.push('device form submitted');
  const editLink=await page.locator('a[href$="/edit"]').first().getAttribute('href');assert.ok(editLink);
  await page.goto(base+editLink);await page.locator('[name=device_name]').fill('浏览器验证设备已修改');
  await Promise.all([page.waitForURL(base+'/devices'),page.locator('form button[type=submit]').click()]);
  const id=editLink.split('/')[2];const removed=await page.request.post(base+'/devices/'+id+'/delete');assert.equal(removed.status(),200);report.checks.push('device edit and safe deletion');
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/');await page.waitForLoadState('networkidle');
  await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
  assert.equal(report.errors.length,0);assert.equal(report.externalRequests.length,0);report.status='PASS';
 }catch(e){report.status='FAIL';report.failure=e.message;throw e;}finally{
  await browser.close();report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
