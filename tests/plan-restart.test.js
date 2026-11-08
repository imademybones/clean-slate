// Manage: restart the run plan from a Monday, or undo a repeated week.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let srv, browser;
before(async () => { srv = await h.startServer(); browser = await h.launch(); });
after(async () => { await browser.close(); srv.server.close(); });

// the state on the phone that asked for this: plan from 26 Oct, week of 2 Nov repeated
const seed = { cleanslate_schema: '2', cleanslate_rp_state: JSON.stringify({ activeProgram: 'run-strength' }), cleanslate_run_state: JSON.stringify({ start: '2026-10-26', repeats: ['2026-11-02'], decisions: { '2026-11-02': 'repeat' }, swaps: {} }) };
const open = (time) => h.newPage(browser, srv.url, null, { programme: 'rs', time, seed });

test('restart from next Monday: week 1 starts then, repeat cleared', async () => {
  const p = await open('2026-11-08T09:00:00');
  await p.click('[data-nav=manage]');
  assert.match(await p.textContent('#plan-line'), /started Mon 26 Oct · 1 week repeated\. Today is plan week 1/);
  assert.equal(await p.inputValue('#plan-restart'), '2026-11-09');
  await p.click('text=Restart plan');
  const st = await p.evaluate(() => runState());
  assert.equal(st.start, '2026-11-09');
  assert.deepEqual(st.repeats, []);
  assert.deepEqual(st.decisions, {});
  assert.match(await p.textContent('#plan-line'), /starts Mon 9 Nov\. Today is plan week 0/);
  // Monday 9 Nov: Gym A, plan week 1, and no repeat prompt
  await p.clock.setSystemTime(new Date('2026-11-09T08:00:00'));
  await p.reload(); await p.waitForSelector('.today-card');
  assert.match(await p.textContent('.home-head + .pad'), /Week 1 of/);
  assert.doesNotMatch(await p.textContent('#app'), /Repeat/);
  await p.clock.setSystemTime(new Date('2026-11-10T08:00:00'));
  await p.reload(); await p.waitForSelector('.today-card');
  assert.match(await p.textContent('.today-card'), /Week 1 · Run 1/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('undo the repeated week: plan moves forward and the prompt stays away', async () => {
  const p = await open('2026-11-08T09:00:00');
  await p.click('[data-nav=manage]');
  await p.click('text=Undo repeated week');
  const st = await p.evaluate(() => runState());
  assert.deepEqual(st.repeats, []);
  assert.equal(st.decisions['2026-11-02'], 'carry');
  assert.match(await p.textContent('#plan-line'), /Today is plan week 2/);
  assert.equal(await p.locator('text=Undo repeated week').count(), 0);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
