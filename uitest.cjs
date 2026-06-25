const { chromium } = require('playwright');
const BASE = 'http://localhost:3000/v1';
async function api(path, opts={}, token) {
  const headers = { 'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{}) };
  const r = await fetch(BASE+path,{...opts,headers,body:opts.body?JSON.stringify(opts.body):undefined});
  const t = await r.text(); try { return JSON.parse(t);} catch {return t;}
}
(async () => {
  const email=`uitest+${Date.now()}@example.com`;
  const reg=await api('/auth/register',{method:'POST',body:{email,password:'password123',firstName:'Ui',lastName:'Test'}});
  const token=reg.accessToken;
  const orgs=await api('/organizations',{},token); const orgId=orgs[0].id;
  const ws=await api(`/workspaces?organizationId=${orgId}`,{},token);
  const wsId=Array.isArray(ws)&&ws[0]?ws[0].id:'';
  const b=await chromium.launch({headless:true});
  const page=await b.newPage();
  const errors=[], apiResp=[];
  page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE.ERR: '+m.text());});
  page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  page.on('requestfailed',r=>errors.push('REQFAIL: '+r.method()+' '+r.url().split('/v1/').pop()+' -> '+(r.failure()&&r.failure().errorText)));
  page.on('response',r=>{if(r.url().includes('/v1/browser/'))apiResp.push(`${r.status()} ${r.request().method()} ${r.url().split('/v1/')[1]}`);});
  await page.addInitScript(([t,o,w])=>{localStorage.setItem('stack62.accessToken',t);localStorage.setItem('stack62.organizationId',o);if(w)localStorage.setItem('stack62.workspaceId',w);},[token,orgId,wsId]);
  await page.goto('http://localhost:5173/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(1500);
  // Enter the app
  const goApp = page.locator('text=Go to app');
  if (await goApp.count()) { await goApp.first().click(); await page.waitForTimeout(3000); }
  console.log('URL:', page.url());
  let globe = page.locator('button[title="Open web browser"]');
  console.log('globe count:', await globe.count());
  if (!(await globe.count())) {
    // maybe needs explicit nav
    await page.goto('http://localhost:5173/app',{waitUntil:'domcontentloaded'}).catch(()=>{});
    await page.waitForTimeout(2500);
    globe = page.locator('button[title="Open web browser"]');
    console.log('globe count after /app:', await globe.count());
  }
  if (await globe.count()) { await globe.first().click(); await page.waitForTimeout(2000); }
  const addr=page.locator('input[placeholder*="Search DuckDuckGo"]');
  console.log('addr count:', await addr.count());
  if (await addr.count()){ await addr.first().fill('https://example.com'); await addr.first().press('Enter'); await page.waitForTimeout(5000);}
  await page.screenshot({path:'ui_browser_state.png', fullPage:false});
  console.log('--- browser API responses ---'); console.log(apiResp.join('\n')||'(none)');
  console.log('--- errors ---'); console.log(errors.slice(0,25).join('\n')||'(none)');
  await b.close();
})().catch(e=>{console.error('SCRIPT FAIL',e);process.exit(1);});
