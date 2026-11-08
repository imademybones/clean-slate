// Food in Airtable: one record per day of food plus one for the library and
// targets; restore onto a cleared phone; deletions and edits reach other devices.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const NOW = '2026-11-09T08:00:00';
let srv, browser, worker, a;
before(async () => {
  srv = await h.startServer(); browser = await h.launch(); worker = h.fakeWorker();
  a = await h.newPage(browser, srv.url, worker, { programme: 'rs', time: NOW });
});
after(async () => { await browser.close(); srv.server.close(); });

const recs = (kind) => worker.store.map((r) => { try { return JSON.parse(r.fields.Log)[kind] ? JSON.parse(r.fields.Log)[kind] : null; } catch (e) { return null; } }).filter(Boolean);
const settle = (p) => p.waitForTimeout(500);
const open = () => h.newPage(browser, srv.url, worker, { programme: 'rs', time: NOW });
const log = (p) => p.evaluate(() => foodLog());

test('the untouched starting library is not uploaded', async () => {
  await settle(a);
  assert.equal(recs('foodlib').length, 0);
  assert.equal(recs('food').length, 0);
});

test('a day of food, a saved food and new targets reach Airtable', async () => {
  await a.click('[data-nav=food]'); await a.waitForSelector('.food-sum');
  await a.click('.meal-chip:has-text("Usual breakfast")');
  await a.fill('#tg-kcal', '2200'); await a.click('text=Save targets');
  await a.click('.fslot-btns >> nth=1 >> .add-btn');
  await a.fill('#qa-name', 'Chicken burrito bowl'); await a.fill('#qa-kcal', '640'); await a.fill('#qa-p', '45');
  await a.check('#qa-save'); await a.fill('#qa-serv', '1 bowl');
  await a.click('.save-btn');
  await a.click('text=Done');
  await settle(a);
  const days = recs('food');
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '2026-11-09');
  assert.equal(days[0].entries.length, 7);
  const lib = recs('foodlib');
  assert.equal(lib.length, 1);
  assert.equal(lib[0].targets.kcal, 2200);
  assert.ok(lib[0].foods.some((f) => f.name === 'Chicken burrito bowl'));
  // History doesn't list the food records
  await a.click('[data-nav=history]'); await a.waitForTimeout(300);
  assert.match(await a.textContent('#app'), /No sessions yet/);
});

test('a cleared phone gets its food, library and targets back', async () => {
  const b = await open();
  await b.waitForFunction(() => foodLog().length === 7, null, { timeout: 5000 });
  assert.equal(await b.evaluate(() => foodTargets().kcal), 2200);
  assert.ok(await b.evaluate(() => foodLib().foods.some((f) => f.name === 'Chicken burrito bowl')));
  await b.click('[data-nav=food]'); await b.waitForSelector('.food-sum');
  assert.equal(await b.textContent('.fs-big'), '1316');
  // and nothing is uploaded twice
  await settle(b);
  assert.equal(recs('food').length, 1); assert.equal(recs('foodlib').length, 1);
  assert.equal(recs('food')[0].entries.length, 7);
  assert.deepEqual(b.errors, []);
  await b.context().close();
});

test('a deletion on one device reaches the other and stays deleted', async () => {
  const b = await open();
  await b.waitForFunction(() => foodLog().length === 7, null, { timeout: 5000 });
  // delete the latte on phone a
  await a.click('[data-nav=food]'); await a.waitForSelector('.food-sum');
  await a.locator('.fe-row', { hasText: 'Iced Oat Latte' }).locator('.icon-btn').click();
  await settle(a);
  assert.equal(recs('food')[0].entries.length, 6);
  assert.equal(recs('food')[0].deleted.length, 1);
  // phone b still had it; after a sync it's gone there too, and isn't re-uploaded
  await b.evaluate(() => rpSync()); await settle(b);
  assert.equal((await log(b)).length, 6);
  assert.ok(!(await log(b)).some((e) => /Latte/.test(e.name)));
  assert.equal(recs('food')[0].entries.length, 6);
  await b.context().close();
});

test('library edits: the newer copy wins, deleted foods stay deleted everywhere', async () => {
  const b = await open();
  await b.waitForFunction(() => foodLog().length === 6, null, { timeout: 5000 });
  // edit on phone b, delete a food on phone a
  await b.evaluate(() => { const l = foodLib(); l.foods.find((f) => f.id === 'seed-oats').kcal = 200; foodLibSave(l); });
  await settle(b);
  await a.evaluate(() => { const l = foodLib(); l.foods = l.foods.filter((f) => f.id !== 'seed-maple'); foodLibSave(l); });
  await settle(a);
  await a.evaluate(() => rpSync()); await settle(a);
  await b.evaluate(() => rpSync()); await settle(b);
  for (const p of [a, b]) {
    const lib = await p.evaluate(() => foodLib());
    assert.equal(lib.foods.find((f) => f.id === 'seed-oats').kcal, 200);
    assert.ok(!lib.foods.some((f) => f.id === 'seed-maple'));
  }
  const remote = recs('foodlib')[0];
  assert.equal(remote.foods.find((f) => f.id === 'seed-oats').kcal, 200);
  assert.ok(remote.deleted.includes('ff:seed-maple'));
  assert.deepEqual(a.errors.concat(b.errors), []);
  await b.context().close();
});

test('food logged offline uploads when back online', async () => {
  worker.offline = true;
  await a.evaluate(() => { nav('food', { date: '2026-11-10' }); });
  await a.click('.meal-chip:has-text("Usual breakfast")');
  await settle(a);
  worker.offline = false;
  await a.evaluate(() => window.dispatchEvent(new Event('online')));
  await a.waitForTimeout(900);
  assert.ok(recs('food').some((d) => d.date === '2026-11-10' && d.entries.length === 5));
  assert.deepEqual(a.errors, []);
});
