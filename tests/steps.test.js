// Manual daily steps: Home quick entry, Progress chart/average/list, and
// Airtable backup with the newer save winning across devices.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const NOW = '2026-11-11T19:00:00';
let srv, browser, worker, a;
before(async () => {
  srv = await h.startServer(); browser = await h.launch(); worker = h.fakeWorker();
  a = await h.newPage(browser, srv.url, worker, { programme: 'rs', time: NOW });
});
after(async () => { await browser.close(); srv.server.close(); });

const steps = (p) => p.evaluate(() => stepsLog().map((x) => ({ date: x.date, count: x.count })));
const body = () => { const r = worker.store.find((x) => /"body"/.test(x.fields.Log || '')); return r ? JSON.parse(r.fields.Log).body : null; };
const settle = (p) => p.waitForTimeout(500);

test('Home: enter today\'s steps, then update them', async () => {
  assert.match(await a.textContent('.steps-home'), /–\s*steps/);
  await a.fill('#st-today', 'abc'); await a.click('.steps-home >> text=Save');
  assert.deepEqual(await steps(a), [], 'not a number: nothing saved');
  await a.fill('#st-today', '8,421'); await a.click('.steps-home >> text=Save');
  assert.match(await a.textContent('#st-today-val'), /8,421/);
  await a.fill('#st-today', '10500'); await a.click('.steps-home >> text=Save');
  assert.deepEqual(await steps(a), [{ date: '2026-11-11', count: 10500 }]);
});

test('Progress: add a past day, see the chart and 7-day average, delete a day', async () => {
  await a.click('[data-nav=progress]'); await a.waitForSelector('#st-count');
  await a.fill('#st-date', '2026-11-10'); await a.fill('#st-count', '6500'); await a.click('button[onclick="stepsAdd()"]');
  await a.fill('#st-date', '2026-11-01'); await a.fill('#st-count', '3000'); await a.click('button[onclick="stepsAdd()"]');
  assert.equal(await a.locator('svg[aria-label="Steps, last 14 days"] rect').count(), 3);
  assert.match(await a.textContent('#app'), /Previous 7 days avg 6,500 \(1 day\)/);   // today is left out; 1 Nov is outside the 7 days
  await a.locator('.hlog-row', { hasText: 'Sun 1 Nov' }).locator('button').click();
  assert.equal((await steps(a)).length, 2);
  // Home shows the 7-day average of the days before today
  await a.click('[data-nav=home]');
  assert.match(await a.textContent('.steps-home'), /Previous 7 days avg 6,500/);
});

test('steps reach Airtable and come back on a cleared phone', async () => {
  await settle(a);
  assert.deepEqual(body().steps.map((x) => x.count), [6500, 10500]);
  const b = await h.newPage(browser, srv.url, worker, { programme: 'rs', time: NOW });
  await b.waitForFunction(() => stepsLog().length === 2, null, { timeout: 5000 });
  assert.match(await b.textContent('#st-today-val'), /10,500/);
  assert.deepEqual(b.errors, []);
  await b.context().close();
});

test('the newer save wins across devices; a deleted day stays deleted', async () => {
  const b = await h.newPage(browser, srv.url, worker, { programme: 'rs', time: NOW });
  await b.waitForFunction(() => stepsLog().length === 2, null, { timeout: 5000 });
  // later in the day, phone b has the bigger count (each test page runs its own
  // fake clock, so move b's on to make its save the later one, as on real phones)
  await b.clock.setSystemTime(new Date('2026-11-11T21:30:00'));
  await b.evaluate(() => { stepsSet('2026-11-11', 12000); });
  await settle(b);
  await a.evaluate(() => rpSync()); await settle(a);
  assert.equal(await a.evaluate(() => stepsOn('2026-11-11')), 12000);
  // delete 10 Nov on phone a; phone b doesn't bring it back
  await a.evaluate(() => stepsDelete('2026-11-10')); await settle(a);
  assert.ok(!body().steps.some((x) => x.date === '2026-11-10'));
  assert.equal(await a.evaluate(() => stepsOn('2026-11-10')), null);
  await b.evaluate(() => rpSync()); await settle(b);
  assert.equal(await b.evaluate(() => stepsOn('2026-11-10')), null, 'phone b drops it too');
  assert.ok(!body().steps.some((x) => x.date === '2026-11-10'), 'and does not re-upload it');
  assert.ok(body().deletedAt['s:2026-11-10'] > 0);
  // re-entering a deleted day works, and sticks on both phones
  await a.evaluate(() => stepsSet('2026-11-10', 7000)); await settle(a);
  await b.evaluate(() => rpSync()); await settle(b);
  assert.equal(await b.evaluate(() => stepsOn('2026-11-10')), 7000);
  assert.equal(await a.evaluate(() => stepsOn('2026-11-10')), 7000);
  assert.ok(!('s:2026-11-10' in body().deletedAt));
  assert.deepEqual(a.errors.concat(b.errors), []);
  await b.context().close();
});
