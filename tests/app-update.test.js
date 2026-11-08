// A new deploy reaches the installed app on its next open, even though
// GitHub Pages marks files fresh for 10 minutes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');

const APP = fs.readdirSync(path.join(__dirname, '..')).find((f) => /^clean-slate-v\d+\.html$/.test(f));
let srv, browser;
before(async () => { srv = await h.startServer(); browser = await h.launch(); });
after(async () => { await browser.close(); srv.server.close(); });

test('reopening the app after a deploy loads the new version', async () => {
  // No request interception here: Playwright turns the HTTP cache off when it
  // routes requests, and the HTTP cache is what this test is about.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(srv.url + '/index.html');
  await page.waitForSelector('.today-card');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('.today-card');
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker in control');

  // deploy: same file name, new contents
  const html = fs.readFileSync(path.join(__dirname, '..', APP), 'utf8');
  srv.overrides[APP] = html.replace('</body>', '<div id="deploy-marker">new build</div></body>');
  try {
    await page.goto(srv.url + '/index.html');
    await page.waitForSelector('.today-card');
    assert.equal(await page.locator('#deploy-marker').count(), 1, 'new build served, not the 10-minute HTTP cache copy');
  } finally { delete srv.overrides[APP]; }

  // offline still opens from the service worker's copy
  await page.context().setOffline(true);
  await page.goto(srv.url + '/' + APP).catch(() => {});
  await page.waitForSelector('.today-card');
  await page.context().setOffline(false);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
