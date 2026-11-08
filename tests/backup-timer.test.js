// Rest timer accuracy/persistence and Airtable backup + restore.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let srv, browser, page, worker;
before(async () => { srv = await h.startServer(); browser = await h.launch(); worker = h.fakeWorker(); page = await h.newPage(browser, srv.url, worker); });
after(async () => { await browser.close(); srv.server.close(); });

const posts = () => worker.requests.filter((r) => r.method === 'POST' && r.path === '/sessions').length;

test('rest timer: starts on tick, +30, survives reload, ends on the wall clock', async () => {
  await page.click('.today-card'); await page.waitForSelector('.ex-card');
  await page.fill('#rpw-leg-press-0', '100'); await page.fill('#rpr-leg-press-0', '12');
  await page.click('#rps-leg-press-0 .rp-tick');
  assert.match(await page.textContent('.timer-num'), /^2:/);
  await page.click('#timer-pill >> text=+30');
  assert.match(await page.textContent('.timer-num'), /^(2:5|3:)/);
  await page.reload(); await page.waitForSelector('#timer-pill');
  assert.match(await page.textContent('.timer-num'), /^(2:5|3:)/);
  await page.evaluate(() => { timer.end = Date.now() + 1500; });
  await page.waitForSelector('#timer-pill', { state: 'detached', timeout: 5000 });
});

test('session uploads once, after feedback, with log + state', async () => {
  await page.click('.today-card'); await page.waitForSelector('.ex-card');
  await h.doSession(page, 10, { onFeedback: async () => assert.equal(posts(), 0) });
  await page.waitForTimeout(300);
  assert.equal(posts(), 1);
  const payload = JSON.parse(worker.store[0].fields.Log);
  assert.equal(worker.store[0].fields.Kind, 'lift');
  assert.equal(payload.rp.session, 'A');
  assert.ok(payload.rp.feedback);
  assert.equal(payload.state.lastCompletedSession, 'A');
  await h.closeDone(page);
  await page.reload(); await page.waitForSelector('.today-card'); await page.waitForTimeout(500);
  assert.equal(posts(), 1, 'no duplicate on reload');
  await page.click('[data-nav=history]'); await page.waitForSelector('.hist-row');
  assert.equal(await page.locator('.hist-row').count(), 1, 'history not duplicated');
});

test('older local-only sessions are backfilled', async () => {
  await page.evaluate(() => { const l = JSON.parse(localStorage.cleanslate_rp_logs); l.unshift(Object.assign({}, l[0], { id: l[0].id - 100000, session: 'C' })); localStorage.cleanslate_rp_logs = JSON.stringify(l); });
  await page.click('[data-nav=manage]');
  await page.click('text=Back up to Airtable now'); await page.waitForTimeout(500);
  assert.equal(posts(), 2);
});

test('a fresh phone restores logs and position without re-uploading', async () => {
  const q = await h.newPage(browser, srv.url, worker);
  await q.waitForFunction(() => JSON.parse(localStorage.cleanslate_rp_logs || '[]').length === 2, null, { timeout: 5000 });
  await q.waitForTimeout(300);
  assert.match(await q.textContent('.today-card'), /Week 1 · Day B/);
  await q.reload(); await q.waitForSelector('.today-card'); await q.waitForTimeout(500);
  assert.equal(posts(), 2);
  assert.deepEqual(page.errors.concat(q.errors), []);
});
