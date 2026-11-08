// Run-Strength data in Airtable: gym sessions, runs, weigh-ins, benchmarks and
// plan position back up, restore onto a phone that lost them, and deletions
// stick. Also: logging a missed day from the week view.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const NOW = '2026-11-08T09:00:00';   // Sunday; last week is Mon 26 Oct – Sun 1 Nov
let srv, browser, worker, page;
before(async () => {
  srv = await h.startServer(); browser = await h.launch(); worker = h.fakeWorker();
  page = await h.newPage(browser, srv.url, worker, { programme: 'rs', time: NOW });
});
after(async () => { await browser.close(); srv.server.close(); });

const remote = (kind) => worker.store.map((r) => { try { return JSON.parse(r.fields.Log)[kind] ? r : null; } catch (e) { return null; } }).filter(Boolean);
const settle = () => page.waitForTimeout(400);

async function lastWeek(p) {
  await p.click('[data-nav=week]'); await p.waitForSelector('.wk-row');
  await p.click('.top-bar .back-btn >> nth=0');
  await p.waitForSelector('text=Plan week 1');
}

test('a missed gym day last week can be logged, dated that day', async () => {
  await lastWeek(page);
  const mon = page.locator('.wk-row').nth(0);
  assert.match(await mon.textContent(), /\+ Log it/);
  await mon.locator('.wk-main').click();
  await page.waitForSelector('.ex-card');
  assert.match(await page.textContent('#app'), /Logging this session for Mon 26 Oct/);
  await page.evaluate(() => { Object.values(rsLive.ex).forEach((e) => e.sets.forEach((s) => { s.weight = s.weight || '20'; s.reps = '8'; s.rir = '2'; s.sec = s.sec || '30'; s.done = true; })); rsLiveSave(); render(); });
  await page.click('#fbtn');
  await page.waitForSelector('#modal.open');
  await page.click('.modal-btn');
  const logs = await page.evaluate(() => rsLogs());
  assert.equal(logs.length, 1);
  assert.equal(logs[0].date, '2026-10-26');
  assert.equal(logs[0].slot, 'gymA');
});

test('a missed run last week can be logged from the week view', async () => {
  await lastWeek(page);
  const tue = page.locator('.wk-row').nth(1);
  assert.match(await tue.textContent(), /\+ Log it/);
  await tue.locator('.wk-main').click();
  await page.waitForSelector('text=Save Run');
  await page.click('.effort-grid .fb-opt >> text=5');
  await page.click('.fb-opt >> text=Fine');
  await page.click('text=Save Run');
  const runs = await page.evaluate(() => runLogs());
  assert.equal(runs.length, 1);
  assert.equal(runs[0].date, '2026-10-27');
  assert.equal(runs[0].slot, 'run1');
  await lastWeek(page);
  assert.match(await page.locator('.wk-row').nth(0).textContent(), /Done/);
  assert.match(await page.locator('.wk-row').nth(1).textContent(), /Done/);
});

test('gym sessions, runs, weigh-ins and plan position reach Airtable once', async () => {
  await page.click('[data-nav=progress]');
  await page.fill('#wt-kg', '82.4'); await page.click('button[onclick="weightAdd()"]');
  await page.evaluate(() => { const st = runState(); st.repeats.push('2026-11-02'); st.decisions['2026-11-02'] = 'repeat'; runStateSave(st); bkSoon(); });
  await settle();
  assert.equal(remote('rs').length, 1);
  assert.equal(remote('run').length, 1);
  assert.equal(remote('body').length, 1);
  assert.equal(remote('rs')[0].fields.Kind, 'lift');
  assert.equal(remote('run')[0].fields.Kind, 'cardio');
  const body = JSON.parse(remote('body')[0].fields.Log).body;
  assert.equal(body.weights[0].kg, 82.4);
  assert.deepEqual(body.runState.repeats, ['2026-11-02']);
  // a reload doesn't upload anything twice
  await page.reload(); await page.waitForSelector('.today-card'); await settle();
  assert.equal(remote('rs').length, 1); assert.equal(remote('run').length, 1); assert.equal(remote('body').length, 1);
  // History lists each session once, not again from Airtable
  await page.click('[data-nav=history]'); await page.waitForSelector('.hist-row');
  assert.equal(await page.locator('.hist-row').count(), 2);
  await page.click('[data-nav=manage]');
  assert.match(await page.textContent('#bk-sync-status'), /2 gym sessions and runs on this phone · checked/);
});

test('a phone whose data was cleared gets everything back from Airtable', async () => {
  const q = await h.newPage(browser, srv.url, worker, { programme: 'rs', time: NOW });
  await q.waitForFunction(() => rsLogs().length === 1 && runLogs().length === 1, null, { timeout: 5000 });
  await q.waitForTimeout(300);
  assert.equal(await q.evaluate(() => weighIns()[0].kg), 82.4);
  assert.deepEqual(await q.evaluate(() => runState().repeats), ['2026-11-02']);
  assert.equal(await q.evaluate(() => rsLogs()[0].date), '2026-10-26');
  await q.click('[data-nav=history]'); await q.waitForSelector('.hist-row');
  assert.equal(await q.locator('.hist-row').count(), 2);
  // and it doesn't upload copies of what it restored
  assert.equal(remote('rs').length, 1); assert.equal(remote('run').length, 1); assert.equal(remote('body').length, 1);
  assert.deepEqual(q.errors, []);
  await q.context().close();
});

test('deleting a run or weigh-in removes it from Airtable and it stays gone', async () => {
  const id = await page.evaluate(() => runLogs()[0].id);
  await page.evaluate((id) => runDeleteLog(id), id);
  await page.evaluate(() => weightDelete(weighIns()[0].date));
  await settle();
  assert.equal(remote('run').length, 0);
  assert.equal(JSON.parse(remote('body')[0].fields.Log).body.weights.length, 0);
  await page.reload(); await page.waitForSelector('.today-card'); await settle();
  assert.equal(await page.evaluate(() => runLogs().length), 0);
  assert.equal(await page.evaluate(() => weighIns().length), 0);
});

test('an edited run is pushed to Airtable', async () => {
  await lastWeek(page);
  await page.locator('.wk-row').nth(1).locator('.wk-main').click();
  await page.click('.effort-grid .fb-opt >> text=4'); await page.click('.fb-opt >> text=Fine');
  await page.click('text=Save Run'); await settle();
  const id = await page.evaluate(() => runLogs()[0].id);
  await page.evaluate((id) => { runEditLog(id); runDraft.effort = 7; runSaveLog(); }, id);
  await settle();
  assert.equal(remote('run').length, 1);
  assert.equal(JSON.parse(remote('run')[0].fields.Log).run.effort, 7);
});

test('offline: saves queue and upload when back online; app asked to keep its data', async () => {
  worker.offline = true;
  await page.click('[data-nav=progress]');
  await page.fill('#wt-kg', '81.9'); await page.click('button[onclick="weightAdd()"]');
  await settle();
  worker.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(800);
  assert.equal(JSON.parse(remote('body')[0].fields.Log).body.weights[0].kg, 81.9);
  assert.equal(await page.evaluate(() => typeof storagePersisted), 'boolean');
  assert.deepEqual(page.errors, []);
});

test('a gym session finished the next day keeps the day it was started', async () => {
  const p = await h.newPage(browser, srv.url, null, { programme: 'rs', time: '2026-11-09T18:00:00' });
  await p.click('.today-card'); await p.waitForSelector('.ex-card');
  await p.evaluate(() => { const e = Object.values(rsLive.ex)[0]; e.sets[0].weight = '40'; e.sets[0].reps = '8'; e.sets[0].rir = '2'; e.sets[0].done = true; rsLiveSave(); });
  await p.clock.setSystemTime(new Date('2026-11-10T07:00:00'));
  await p.reload(); await p.waitForSelector('.today-card');
  await p.click('.today-card'); await p.waitForSelector('.ex-card');
  await p.click('#fbtn'); await p.waitForSelector('#modal.open');
  assert.equal(await p.evaluate(() => rsLogs()[0].date), '2026-11-09');
  await p.context().close();
});
