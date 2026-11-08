// v11 Food tab: seeded breakfast, one-tap meal logging, portions, quick add,
// targets, save-as-meal, library edits that leave past days alone.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let srv, browser, page;
before(async () => {
  srv = await h.startServer(); browser = await h.launch();
  page = await h.newPage(browser, srv.url, null, { programme: 'rs', time: '2026-11-09T08:00:00' });
});
after(async () => { await browser.close(); srv.server.close(); });

const log = () => page.evaluate(() => JSON.parse(localStorage.cleanslate_food_log || '[]'));
const lib = () => page.evaluate(() => JSON.parse(localStorage.cleanslate_food_lib));

test('fresh install: schema 2, breakfast seeded, Home shows the food card', async () => {
  assert.equal(await page.evaluate(() => localStorage.cleanslate_schema), '2');
  const l = await lib();
  assert.equal(l.foods.length, 6);
  assert.equal(l.meals[0].name, 'Usual breakfast');
  assert.match(await page.textContent('.food-home'), /0 kcal/);
});

test('an existing v10 phone keeps its data and gets the seed once', async () => {
  const q = await h.newPage(browser, srv.url, null, { programme: 'rs', seed: {
    cleanslate_schema: '1', cleanslate_weights: JSON.stringify([{ date: '2026-11-01', kg: 80 }])
  } });
  assert.equal(await q.evaluate(() => localStorage.cleanslate_schema), '2');
  assert.equal(await q.evaluate(() => JSON.parse(localStorage.cleanslate_weights)[0].kg), 80);
  await q.evaluate(() => { const l = JSON.parse(localStorage.cleanslate_food_lib); l.foods = []; localStorage.cleanslate_food_lib = JSON.stringify(l); });
  await q.reload(); await q.waitForSelector('.today-card');
  assert.equal(await q.evaluate(() => JSON.parse(localStorage.cleanslate_food_lib).foods.length), 0, 'not re-seeded');
  assert.deepEqual(q.errors, []);
  await q.context().close();
});

test('one tap logs the usual breakfast as six items, 676 kcal / 50 g protein', async () => {
  await page.click('[data-nav=food]'); await page.waitForSelector('.food-sum');
  await page.click('.meal-chip:has-text("Usual breakfast")');
  const l = await log();
  assert.equal(l.length, 6);
  assert.ok(l.every((e) => e.slot === 'breakfast' && e.date === '2026-11-09'));
  assert.equal(await page.textContent('.fs-big'), '676');
  assert.match(await page.textContent('.fs-macros'), /50 g/);
});

test('remove an item, then add it back at half a portion from the add screen', async () => {
  const latte = page.locator('.fe-row', { hasText: 'Iced Oat Latte' });
  await latte.locator('.icon-btn').click();
  assert.equal(await page.textContent('.fs-big'), '526');
  await page.click('.fslot-btns >> nth=0 >> .add-btn');
  await page.waitForSelector('#food-pick');
  await page.click('.fb-opt:has-text("½")');
  await page.fill('#food-q', 'latte');
  assert.equal(await page.locator('#food-pick .pick-row').count(), 1);
  await page.click('#food-pick .pick-row');
  const e = (await log()).find((x) => /Latte/.test(x.name));
  assert.equal(e.qty, 0.5); assert.equal(e.kcal, 75);
  await page.click('text=Done');
  assert.equal(await page.textContent('.fs-big'), '601');
});

test('quick add, saved to My foods, then reusable', async () => {
  await page.click('.fslot-btns >> nth=1 >> .add-btn');   // lunch
  await page.fill('#qa-name', 'Chicken burrito bowl');
  await page.fill('#qa-kcal', '640'); await page.fill('#qa-p', '45');
  await page.check('#qa-save'); await page.fill('#qa-serv', '1 bowl');
  await page.click('.save-btn');
  const l = await lib();
  const bowl = l.foods.find((f) => f.name === 'Chicken burrito bowl');
  assert.equal(bowl.serving, '1 bowl');
  assert.equal((await log()).filter((e) => e.slot === 'lunch').length, 1);
  await page.fill('#food-q', 'burrito');
  assert.equal(await page.locator('#food-pick .pick-row').count(), 1);
  await page.click('text=Done');
  assert.equal(await page.textContent('.fs-big'), '1241');
});

test('targets drive the remaining figure and the Home card', async () => {
  await page.fill('#tg-kcal', '2200'); await page.fill('#tg-p', '160');
  await page.click('text=Save targets');
  assert.match(await page.textContent('.food-sum'), /959\s*kcal left/);
  await page.click('[data-nav=home]');
  assert.match(await page.textContent('.food-home'), /1241 \/ 2200 kcal/);
  assert.match(await page.textContent('.food-home'), /94 \/ 160 g protein/);
});

test('save a slot as a meal; editing a food leaves past days alone', async () => {
  await page.click('[data-nav=food]');
  await page.evaluate(() => { window.prompt = (msg, def) => def; });   // take the suggested name
  await page.click('.fslot-btns >> nth=0 >> text=Save as meal');
  const l = await lib();
  assert.equal(l.meals.length, 2);
  assert.equal(l.meals[1].name, 'Usual breakfast');
  assert.equal(l.meals[1].items.find((it) => it.food === 'seed-latte').qty, 0.5);

  await page.click('text=My foods'); await page.waitForSelector('.mrow');
  await page.click('.mrow:has-text("Rolled Oats")');
  await page.fill('#fd-kcal', '200');
  await page.click('text=Save food');
  assert.equal((await log()).find((e) => /Oats/.test(e.name)).kcal, 190);
  assert.equal((await lib()).foods.find((f) => f.id === 'seed-oats').kcal, 200);
});

test('meal editor: change servings and remove a food', async () => {
  await page.click('.mrow:has-text("Usual breakfast") >> nth=0');
  await page.waitForSelector('#ml-name');
  await page.locator('.mrow:has-text("Maple") .icon-btn').click();
  await page.locator('.mrow:has-text("Protein Powder") input').fill('2');
  await page.locator('.mrow:has-text("Protein Powder") input').dispatchEvent('change');
  await page.click('text=Save meal');
  const m = (await lib()).meals[0];
  assert.equal(m.items.length, 5);
  assert.equal(m.items.find((it) => it.food === 'seed-protein').qty, 2);
});

test('previous days, 7-day average and the JSON export include food', async () => {
  await page.click('[data-nav=food]');
  await page.click('[aria-label="Previous day"]');
  assert.match(await page.textContent('.fd-label'), /Yesterday/);
  assert.equal(await page.textContent('.fs-big'), '0');
  await page.click('.meal-chip:has-text("Usual breakfast") >> nth=0');
  await page.click('[aria-label="Next day"]');
  assert.match(await page.textContent('.pad'), /Previous 7 days: \d+ kcal/);
  const keys = await page.evaluate(() => exportKeys());
  for (const k of ['cleanslate_food_lib', 'cleanslate_food_log', 'cleanslate_food_targets']) assert.ok(keys.includes(k), k);
  assert.deepEqual(page.errors, []);
});
