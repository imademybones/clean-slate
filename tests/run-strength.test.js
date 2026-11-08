// v10: Run-Strength programme + 800 m comeback plan – the brief's acceptance
// criteria. Each test fixes the clock with Playwright's page.clock.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const h = require('./helpers');

let srv, browser;
before(async () => { srv = await h.startServer(); browser = await h.launch(); });
after(async () => { await browser.close(); srv.server.close(); });

const open = (time, opts = {}) => h.newPage(browser, srv.url, null, Object.assign({ programme: 'rs', time }, opts));
const goto = async (page, view) => { await page.evaluate((v) => nav(v), view); };
const runLog = (o) => Object.assign({ id: Date.parse(o.date), slot: 'run1', phase: 1, planWeek: 1, session: { type: 'intervals', jog: 60, walk: 60, reps: 12 },
  checkpoint: null, completed: 'yes', durationSec: 1440, distanceKm: null, effort: 4, calves: 'fine', notes: '' }, o);

test('v9 data survives the upgrade and RP Recomp is still there', async () => {
  const rpLog = { id: 1761000000000, date: '2026-10-20', program: 'rp-recomp-3day', block: 1, week: 2, session: 'A', startedAt: '2026-10-20T07:00:00Z', finishedAt: '2026-10-20T08:00:00Z',
    sets: [{ exercise: 'leg-press', weight: 140, reps: 10, rir: 2, done: true }, { exercise: 'leg-press', weight: 140, reps: 9, rir: 2, done: true }], skipped: [], feedback: null };
  const logsRaw = JSON.stringify([rpLog]);
  const page = await open('2026-10-25T09:00:00', { seed: {
    cleanslate_rp_state: JSON.stringify({ activeProgram: 'rp-recomp-3day', block: 1, week: 2, lastCompletedSession: 'A', lastSessionDate: '2026-10-20', bonusSets: {} }),
    cleanslate_rp_logs: logsRaw, cleanslate_rp_synced: '[1761000000000]', cs3_stats: '{"total":5,"week":1,"weekOf":"2026-10-20"}'
  } });
  const ls = await page.evaluate(() => Object.assign({}, localStorage));
  assert.equal(ls.cleanslate_schema, '2', 'v9 → v10 → v11 in one go');
  assert.ok(JSON.parse(ls.cleanslate_food_lib).meals.length, 'food library seeded');
  assert.equal(ls.cleanslate_rp_logs, logsRaw, 'RP logs untouched');
  assert.equal(ls.cleanslate_rp_synced, '[1761000000000]');
  assert.equal(JSON.parse(ls.cleanslate_premigration_v9).data.cleanslate_rp_logs, logsRaw, 'raw pre-migration copy kept');
  assert.equal(JSON.parse(ls.cleanslate_rp_state).activeProgram, 'run-strength');
  assert.match(await page.textContent('.home-title'), /RUN/);
  await goto(page, 'history');
  await page.waitForSelector('.hist-row');
  assert.match(await page.textContent('#app'), /RP · Week 2 · Day A/);
  await goto(page, 'manage');
  await page.click('text=RP Recomp – 3-Day Full Body');
  await goto(page, 'home');
  assert.match(await page.textContent('.today-card'), /Block 1 · Week 2 · Day B/, 'RP position kept');
  assert.deepEqual(page.errors, []);
});

test('Today: Mon 26 Oct is Gym A, Tue 27 Oct is Run 1 week 1 (1/1 × 12)', async () => {
  let page = await open('2026-10-26T07:00:00');
  let card = await page.textContent('.today-card');
  assert.match(card, /Gym A/);
  assert.match(card, /Lower strength/);
  page = await open('2026-10-27T07:00:00');
  card = await page.textContent('.today-card');
  assert.match(card, /Week 1 · Run 1/);
  assert.match(card, /1 min jog \/ 1 min walk × 12/);
  page = await open('2026-10-25T07:00:00');
  assert.match(await page.textContent('.today-card'), /Rest Day/);
  assert.deepEqual(page.errors, []);
});

const recordCues = () => {
  window.__vib = []; window.__osc = [];
  navigator.vibrate = (p) => { window.__vib.push(p); return true; };
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function () { window.__osc.push(this.frequency.value); return start.apply(this, arguments); };
};

test('week 1 interval timer cues every switch; calves "tight" → repeat prompt; Repeat shifts checkpoints', async () => {
  const page = await open('2026-10-27T07:00:00', { init: recordCues });
  await goto(page, 'progress');
  assert.match(await page.textContent('#cp-dates'), /Sat 19 Dec.*Sat 16 Jan/);
  await goto(page, 'home');

  await page.click('.today-card');
  await page.click('button:has-text("Start")');
  assert.match(await page.textContent('#rt-kind'), /Jog/);
  await page.clock.runFor(61 * 1000);
  assert.match(await page.textContent('#rt-kind'), /Walk/);
  assert.match(await page.textContent('.rt-sub'), /Rep 1 of 12/);
  for (let i = 0; i < 23; i++) await page.clock.runFor(60 * 1000);
  assert.match(await page.textContent('#rt-kind'), /Done/);
  const vib = await page.evaluate(() => window.__vib);
  assert.equal(vib.length, 1 + 23 + 1, 'buzz at start, each of 23 switches and the end');
  const osc = await page.evaluate(() => window.__osc);
  assert.equal(osc.filter((f) => f === 660).length, 12, 'jog cue ×12');
  assert.equal(osc.filter((f) => f === 440).length, 12, 'walk cue ×12');
  assert.equal(osc.filter((f) => f === 523).length, 1, 'finish cue');

  await page.click('button:has-text("Finish")');
  await page.waitForSelector('#rl-dur');
  assert.match(await page.inputValue('#rl-dur'), /^24:0\d$/, 'duration from the timer');
  assert.match(await page.textContent('#app'), /Week 1 · Run 1/);
  await page.click('.effort-grid >> text=4');
  await page.click('button.fb-opt:has-text("Tight")');
  await page.click('text=Save Run');
  await page.waitForSelector('.today-card');
  const logs = await page.evaluate(() => JSON.parse(localStorage.cleanslate_run_logs));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].calves, 'tight');
  assert.equal(logs[0].completed, 'yes');
  assert.equal(await page.locator('#repeat-prompt').count(), 0, 'no prompt mid-week');

  // start of the next week
  await page.clock.setSystemTime(new Date('2026-11-02T07:00:00'));
  await goto(page, 'home');
  assert.match(await page.textContent('#repeat-prompt'), /Repeat last week\?.*calves logged tight or sore/s);
  await page.click('#repeat-prompt button:has-text("Repeat")');
  assert.equal(await page.locator('#repeat-prompt').count(), 0);
  await page.clock.setSystemTime(new Date('2026-11-03T07:00:00'));
  await goto(page, 'home');
  assert.match(await page.textContent('.today-card'), /Week 1 · Run 1/, 'week 1 again');
  await goto(page, 'progress');
  assert.match(await page.textContent('#cp-dates'), /Sat 26 Dec.*Sat 23 Jan/, 'both checkpoints moved a week');
  assert.deepEqual(page.errors, []);
});

test('Carry on keeps the schedule; two sore runs warn on the next run', async () => {
  const page = await open('2026-11-03T07:00:00', { seed: { cleanslate_run_logs: JSON.stringify([
    runLog({ date: '2026-10-27', calves: 'sore' }), runLog({ date: '2026-10-29', slot: 'run2', calves: 'sore' })]) } });
  assert.match(await page.textContent('#repeat-prompt'), /2 of 3 runs completed/);
  assert.equal(await page.locator('#sore-warning').count(), 1);
  await page.click('#repeat-prompt button:has-text("Carry on")');
  assert.match(await page.textContent('.today-card'), /Week 2 · Run 1/);
  assert.match(await page.textContent('.today-card'), /2 min jog \/ 1 min walk × 8/);
});

test('Phase 2 stays locked until all three Phase 1 gate items are met', async () => {
  const page = await open('2027-01-20T07:00:00', { seed: { cleanslate_run_logs: JSON.stringify([
    runLog({ date: '2027-01-09', slot: 'run3', planWeek: 11, session: { type: 'continuous', min: [40, 40], strides: 6 }, durationSec: 2700 }),
    runLog({ date: '2027-01-14', slot: 'run2', planWeek: 12, session: { type: 'continuous', min: [30, 30], easy: true } })]) } });
  await goto(page, 'progress');
  assert.equal(await page.locator('.gate-item.ok').count(), 2);
  assert.match(await page.textContent('#phase-2'), /Locked/);
  assert.match(await page.textContent('#phase-2'), /parkrun under 21:00/);
  assert.match(await page.textContent('#phase-3'), /Locked.*2:10/s);
  assert.match(await page.textContent('#phase-4'), /Locked.*sub-2:00/s);

  // the parkrun checkpoint: log it with a 5 km time → baseline benchmark
  await page.evaluate(() => { runDraft = { date: '2027-01-16', slot: 'run3', planWeek: 12, session: { type: 'parkrun', distanceM: 5000 }, checkpoint: 'parkrun',
    completed: 'yes', duration: '', distance: '5', effort: null, calves: null, notes: '', benchTime: '' }; nav('runLog'); });
  await page.click('.effort-grid >> text=7');
  await page.click('button.fb-opt:has-text("Fine")');
  await page.click('text=Save Run');
  assert.equal(await page.locator('.today-card').count(), 0, 'blocked without a 5 km time');
  await page.fill('#rl-bench', '24:31');
  await page.click('text=Save Run');
  await page.waitForSelector('.today-card');
  await goto(page, 'progress');
  assert.equal(await page.locator('.gate-item.ok').count(), 3);
  assert.match(await page.textContent('#phase-2'), /Unlocked/);
  assert.match(await page.textContent('#bench-list'), /Sat 16 Jan.*parkrun baseline.*5 km.*24:31/s);

  // calf niggle in the last two weeks re-locks it
  await page.evaluate(() => { const l = JSON.parse(localStorage.cleanslate_run_logs); l[0].calves = 'tight'; l[0].date = '2027-01-12'; localStorage.cleanslate_run_logs = JSON.stringify(l); nav('progress'); });
  assert.match(await page.textContent('#phase-2'), /Locked/);
  assert.deepEqual(page.errors, []);
});

test('gym: lower-body loads need RIR 2+, calves prompt before skipping, swap moves a session', async () => {
  const set = (exercise, variant, weight, reps, rir) => ({ exercise, variant, weight, reps, sec: null, rir, done: true });
  const prior = { id: 1, date: '2026-10-19', program: 'run-strength', phase: 1, session: 'A', slot: 'gymA', skipped: [], sets: [
    set('rs-squat', 'back-squat', 100, 5, 2), set('rs-squat', 'back-squat', 100, 5, 3), set('rs-squat', 'back-squat', 100, 5, 2),
    set('rs-rdl', null, 80, 8, 1), set('rs-rdl', null, 80, 8, 2), set('rs-rdl', null, 80, 8, 2),
    { exercise: 'rs-side-plank', variant: null, weight: null, reps: null, sec: 30, rir: null, target: 30, done: true }] };
  const page = await open('2026-10-26T07:00:00', { seed: { cleanslate_rs_logs: JSON.stringify([prior]) } });
  const dialogs = [];
  page.on('dialog', (d) => dialogs.push(d.message()));
  await page.click('.today-card');
  await page.waitForSelector('#ec-rs-squat');
  assert.match(await page.textContent('#ec-rs-squat'), /Suggested: 102.5 kg.*every set hit 5 at RIR 2\+/s);
  assert.match(await page.textContent('#ec-rs-rdl'), /Suggested: 80 kg.*under RIR 2/s);
  assert.equal(await page.inputValue('#rsi-rs-side-plank-0-sec'), '35', 'side plank +5 s');
  assert.match(await page.textContent('#ec-rs-standing-calf'), /Non-negotiable/);

  // leg press is tracked separately
  await page.click('#ec-rs-squat >> text=Leg press');
  assert.match(await page.textContent('#ec-rs-squat'), /Find a weight/);
  await page.click('#ec-rs-squat >> text=Back squat');

  await page.fill('#rsi-rs-squat-0-reps', '5');
  await page.click('#rss-rs-squat-0 .rp-tick');
  assert.match(await page.textContent('#toast'), /Log RIR/);
  await page.fill('#rsi-rs-squat-0-rir', '2');
  await page.click('#rss-rs-squat-0 .rp-tick');
  assert.equal(await page.locator('#rss-rs-squat-0.logged').count(), 1);

  await page.click('#ec-rs-standing-calf >> text=Skip exercise');
  assert.match(dialogs.pop(), /non-negotiable/);
  await page.click('#ec-rs-standing-calf >> text=Undo skip');
  await page.click('#fbtn');
  assert.ok(dialogs.some((m) => /non-negotiable.*Unticked: Standing calf raise/s.test(m)), 'finish asks about calves');
  await page.waitForSelector('#modal.open');
  await page.click('.modal-btn');
  const logs = await page.evaluate(() => JSON.parse(localStorage.cleanslate_rs_logs));
  assert.equal(logs.length, 2);
  assert.equal(logs[1].slot, 'gymA');
  assert.equal(logs[1].sets.find((s) => s.exercise === 'rs-squat').variant, 'back-squat');

  await goto(page, 'week');
  assert.match(await page.locator('.wk-row').nth(0).textContent(), /Gym A.*✓ Done/s);
  // swap Tue run 1 with Wed gym B
  await page.locator('.wk-row').nth(1).locator('button').click();
  await page.locator('.wk-row').nth(2).locator('button').click();
  assert.match(await page.textContent('.wk-row >> nth=1'), /Gym B/);
  await page.clock.setSystemTime(new Date('2026-10-27T07:00:00'));
  await goto(page, 'home');
  assert.match(await page.textContent('.today-card'), /Gym B/);
  await page.clock.setSystemTime(new Date('2026-10-28T07:00:00'));
  await goto(page, 'home');
  assert.match(await page.textContent('.today-card'), /Week 1 · Run 1/);
  assert.deepEqual(page.errors, []);
});

test('export → clear storage → import restores everything', async () => {
  const page = await open('2026-11-05T07:00:00', { seed: {
    cleanslate_run_logs: JSON.stringify([runLog({ date: '2026-10-27' })]),
    cleanslate_weights: JSON.stringify([{ date: '2026-10-26', kg: 82.4 }, { date: '2026-11-02', kg: 81.9 }]),
    cleanslate_benchmarks: JSON.stringify([{ id: 5, date: '2026-10-01', kind: 'manual', label: 'Old 5k', distanceM: 5000, timeSec: 1600 }]),
    cleanslate_rp_logs: JSON.stringify([{ id: 9, date: '2026-09-01', block: 1, week: 1, session: 'A', sets: [], skipped: [] }]),
    cleanslate_sync_key: 'secret-key'
  } });
  const snap = () => page.evaluate(() => { const o = {}; Object.keys(localStorage).filter((k) => /^(cleanslate_|cs3_)/.test(k) && k !== 'cleanslate_sync_key' && k !== 'cleanslate_premigration_v9').sort().forEach((k) => { o[k] = localStorage[k]; }); return o; });
  const before = await snap();
  await goto(page, 'manage');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export all data')]);
  const file = await dl.path();
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(json.app, 'clean-slate');
  assert.equal(json.data.cleanslate_sync_key, undefined, 'sync key not exported');

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.today-card');
  assert.notDeepEqual(await snap(), before);
  await goto(page, 'manage');
  await Promise.all([page.waitForEvent('load'), page.setInputFiles('#import-file', file)]);
  await page.waitForSelector('.today-card');
  assert.deepEqual(await snap(), before);
  await goto(page, 'progress');
  assert.match(await page.textContent('#app'), /81.9 kg/);
  assert.match(await page.textContent('#bench-list'), /Old 5k/);
});

test('phone width: no horizontal scroll on any screen', async () => {
  const page = await open('2026-12-19T07:00:00', { seed: {
    cleanslate_run_logs: JSON.stringify([runLog({ date: '2026-12-15', planWeek: 8, notes: 'A long note about the run that should wrap nicely on a narrow phone screen' })]),
    cleanslate_weights: JSON.stringify([{ date: '2026-11-01', kg: 82 }, { date: '2026-11-08', kg: 81.5 }, { date: '2026-11-15', kg: 81.7 }]) } });
  const check = async (label) => {
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert.ok(w.sw <= w.cw, label + ': ' + w.sw + ' > ' + w.cw);
  };
  assert.match(await page.textContent('.today-card'), /Checkpoint/, 'week 8 Saturday is highlighted');
  await check('today');
  for (const v of ['week', 'progress', 'manage']) { await goto(page, v); await check(v); }
  await goto(page, 'history'); await page.waitForSelector('.hist-row'); await check('history');
  await goto(page, 'home'); await page.click('.today-card'); await check('run ready');
  await page.click('button:has-text("Start")'); await check('run timer');
  await page.click('text=Discard run');
  await page.evaluate(() => { nav('runTimer', { slot: 'run3' }); runLogWithoutTimer(); }); await check('run log');
  await page.evaluate(() => rsStart('C', 'gymC')); await check('gym C');
  assert.deepEqual(page.errors, []);
});
