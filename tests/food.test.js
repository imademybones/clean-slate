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
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.cleanslate_food_targets)), { kcal: 2100, protein: 160, carbs: 230, fat: 60 });
  assert.match(await page.textContent('.food-home'), /0 \/ 2100 kcal/);
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
  assert.match(await page.textContent('.fs-macros'), /50 \/ 160 g/);
  assert.match(await page.textContent('.fs-macros'), /78 \/ 230 g/);
  assert.match(await page.textContent('.fs-macros'), /17 \/ 60 g/);
});

test('remove an item, then add it back as an exact amount from the add screen', async () => {
  const latte = page.locator('.fe-row', { hasText: 'Iced Oat Latte' });
  await latte.locator('.icon-btn').click();
  assert.equal(await page.textContent('.fs-big'), '526');
  await page.click('.fslot-btns >> nth=0 >> .add-btn');
  await page.waitForSelector('#food-pick');
  await page.fill('#food-q', 'latte');
  assert.equal(await page.locator('#food-pick .pick-row').count(), 1);
  assert.match(await page.textContent('#food-pick .pick-row'), /473 ml/);
  await page.click('#food-pick .pick-row');
  // the amount box opens with one serving (473 ml); half of it is 236.5 ml
  assert.equal(await page.inputValue('#amt-in-pick-seed-latte'), '473');
  await page.fill('#amt-in-pick-seed-latte', '236.5');
  assert.match(await page.textContent('#amt-prev-pick-seed-latte'), /= 75 kcal/);
  await page.click('#amt-pick-seed-latte >> text=Add');
  const e = (await log()).find((x) => /Latte/.test(x.name));
  assert.equal(e.qty, 0.5); assert.equal(e.kcal, 75); assert.equal(e.amt, 236.5); assert.equal(e.unit, 'ml');
  await page.click('text=Done');
  assert.equal(await page.textContent('.fs-big'), '601');
});

test('quick add, saved to My foods, then reusable', async () => {
  await page.click('.fslot-btns >> nth=1 >> .add-btn');   // lunch
  await page.fill('#qa-name', 'Chicken burrito bowl');
  await page.fill('#qa-kcal', '640'); await page.fill('#qa-p', '45');
  await page.check('#qa-save');
  await page.click('.save-btn');
  const l = await lib();
  const bowl = l.foods.find((f) => f.name === 'Chicken burrito bowl');
  assert.equal(bowl.serving, '1 serving'); assert.equal(bowl.amt, 1); assert.equal(bowl.unit, 'serving');
  assert.equal((await log()).filter((e) => e.slot === 'lunch').length, 1);
  await page.fill('#food-q', 'burrito');
  assert.equal(await page.locator('#food-pick .pick-row').count(), 1);
  await page.click('text=Done');
  assert.equal(await page.textContent('.fs-big'), '1241');
});

test('targets drive the remaining figure and the Home card', async () => {
  await page.fill('#tg-kcal', '2200'); await page.fill('#tg-p', '160'); await page.fill('#tg-f', '');
  await page.click('text=Save targets');
  const saved = await page.evaluate(() => JSON.parse(localStorage.cleanslate_food_targets));
  assert.ok(saved.at > 0, 'stamped for sync');
  delete saved.at;
  assert.deepEqual(saved, { kcal: 2200, protein: 160, carbs: 230 });
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

test('meal editor: change amounts and remove a food', async () => {
  await page.click('.mrow:has-text("Usual breakfast") >> nth=0');
  await page.waitForSelector('#ml-name');
  await page.locator('.mrow:has-text("Maple") .icon-btn').click();
  assert.equal(await page.locator('.mrow:has-text("Protein Powder") input').inputValue(), '30');   // grams now
  await page.locator('.mrow:has-text("Protein Powder") input').fill('60');
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

test('future days: plan tomorrow, then come back to today', async () => {
  await page.click('[data-nav=food]');
  assert.equal(await page.locator('.fd-today').count(), 0);
  await page.click('[aria-label="Next day"]');
  assert.match(await page.textContent('.fd-label'), /Tomorrow/);
  await page.click('.meal-chip:has-text("Usual breakfast") >> nth=0');
  assert.ok((await log()).some((e) => e.date === '2026-11-10'), 'logged on tomorrow');
  await page.click('[aria-label="Next day"]');
  assert.match(await page.textContent('.fd-label'), /Wed 11 Nov/);
  await page.click('.fd-today');
  assert.match(await page.textContent('.fd-label'), /^Today/);
  assert.match(await page.textContent('.food-home, .fs-big'), /1241/, 'today unchanged');
  assert.deepEqual(page.errors, []);
});

test('a food with a serving size: log any amount, then change a logged amount', async () => {
  // the example: oat milk, 250 ml = 96 kcal, but 306 ml was had
  await page.click('[data-nav=food]');
  await page.click('text=My foods'); await page.click('text=+ New food');
  await page.fill('#fd-name', 'So Good Oat Milk'); await page.fill('#fd-amt', '250'); await page.selectOption('#fd-unit', 'ml');
  await page.fill('#fd-kcal', '96'); await page.fill('#fd-p', '1');
  await page.click('text=Save food');
  const f = (await lib()).foods.find((x) => x.name === 'So Good Oat Milk');
  assert.deepEqual([f.amt, f.unit, f.serving], [250, 'ml', '250 ml']);
  await page.click('.back-btn');   // back to Food
  await page.click('.fslot-btns >> nth=3 >> .add-btn');   // snacks
  await page.fill('#food-q', 'so good');   // also matches the seeded Sanitarium oat milk
  await page.locator('#food-pick .pick-row').filter({ hasNotText: 'Sanitarium' }).click();
  await page.fill('#amt-in-pick-' + f.id, '306');
  assert.match(await page.textContent('#amt-prev-pick-' + f.id), /= 118 kcal/);
  await page.click('#amt-pick-' + f.id + ' >> text=Add');
  let e = (await log()).find((x) => x.name === 'So Good Oat Milk');
  assert.equal(e.kcal, 117.5); assert.equal(e.amt, 306);
  await page.click('text=Done');
  // change it: tap the item, enter 150 ml
  const row = page.locator('.fe-row', { hasText: 'So Good Oat Milk' }).filter({ hasNotText: 'Sanitarium' });
  assert.match(await row.textContent(), /306 ml/);
  await row.locator('.fe-main').click();
  await page.fill('#amt-in-ent-' + e.id, '150');
  assert.match(await page.textContent('#amt-prev-ent-' + e.id), /= 58 kcal/);
  await page.click('#amt-ent-' + e.id + ' >> text=Save');
  e = (await log()).find((x) => x.id === e.id);
  assert.equal(e.kcal, 57.6); assert.equal(e.amt, 150);
  assert.match(await row.textContent(), /150 ml/);
  assert.deepEqual(page.errors, []);
});

test('items logged before amounts existed can still be changed', async () => {
  // an old-style entry: 1.5 × "50 g" of oats, no amount stored
  await page.evaluate(() => {
    const l = foodLog();
    l.push({ id: 'eold1', date: todayKey(), slot: 'breakfast', food: 'seed-oats', name: 'Old oats', serving: '50 g', qty: 1.5, kcal: 285, p: 10.5, c: 42, f: 6 });
    localStorage.cleanslate_food_log = JSON.stringify(l); render();
  });
  const row = page.locator('.fe-row', { hasText: 'Old oats' });
  assert.match(await row.textContent(), /75 g/);
  await row.locator('.fe-main').click();
  await page.fill('#amt-in-ent-eold1', '100');
  await page.click('#amt-ent-eold1 >> text=Save');
  const e = (await log()).find((x) => x.id === 'eold1');
  assert.equal(e.kcal, 380); assert.equal(e.qty, 2);
});
