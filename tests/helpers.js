// Shared helpers for the browser tests: a static server for the repo, a
// Chromium page at phone size, a fake Worker backed by an in-memory store,
// and a driver that logs a whole RP session.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port }));
  });
}

// Fake Worker. `store` holds Sessions records; `requests` records every call.
function fakeWorker() {
  const w = { store: [], requests: [], offline: false, status: 200 };
  w.route = async (route) => {
    const req = route.request(), u = new URL(req.url()), method = req.method();
    w.requests.push({ method, path: u.pathname + u.search, headers: req.headers(), body: req.postData() });
    if (w.offline) return route.abort();
    if (w.status !== 200) return route.fulfill({ status: w.status, body: 'Unauthorized' });
    if (u.pathname === '/sessions') {
      if (method === 'POST') {
        const recs = JSON.parse(req.postData()).records.map((x) => ({ id: 'rec' + Math.random().toString(36).slice(2, 10), fields: x.fields }));
        w.store.push(...recs);
        return route.fulfill({ json: { records: recs } });
      }
      if (method === 'PATCH') {
        for (const r of JSON.parse(req.postData()).records) {
          const rec = w.store.find((x) => x.id === r.id);
          if (rec) Object.assign(rec.fields, r.fields);
        }
        return route.fulfill({ json: { records: [] } });
      }
      if (method === 'DELETE') {
        const ids = u.searchParams.getAll('records[]');
        w.store = w.store.filter((x) => !ids.includes(x.id));
        return route.fulfill({ json: { records: ids.map((id) => ({ id, deleted: true })) } });
      }
      return route.fulfill({ json: { records: w.store } });
    }
    return route.fulfill({ json: { records: [] } });
  };
  return w;
}

async function launch() {
  // PW_CHROMIUM: use an already-installed Chromium instead of Playwright's own download
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  return browser;
}

// opts.programme: 'rp' (default – the RP Recomp tests predate v10, where
// Run-Strength became the default) or 'rs' for a plain fresh install.
// opts.time: fixes the page clock (Playwright clock) before load.
// opts.seed: { key: value } written to localStorage before the first load only.
async function newPage(browser, baseUrl, worker, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/workers\.dev/, worker ? worker.route : (r) => r.abort());
  const seed = Object.assign({}, opts.programme === 'rs' ? {} : {
    cleanslate_schema: '1', cleanslate_rp_state: JSON.stringify({ activeProgram: 'rp-recomp-3day' })
  }, opts.seed || {});
  await ctx.addInitScript((seed) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, seed);
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  if (opts.time) await page.clock.install({ time: new Date(opts.time) });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(baseUrl + '/index.html');
  await page.waitForURL(/clean-slate-v\d+\.html/);
  await page.waitForSelector('.today-card');
  return page;
}

// Start (or resume) the next session from Home, fill every unticked set and
// finish. Handles the feedback screen if it appears. Returns the done-sheet text.
async function doSession(page, reps, opts = {}) {
  if (!(await page.locator('.ex-card').count())) {
    await page.click('.today-card');
    await page.waitForSelector('.ex-card');
  }
  if (opts.before) await opts.before();
  const rows = await page.locator('.rp-set').all();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (await r.evaluate((e) => e.classList.contains('logged'))) continue;
    if (opts.skipLast && i === rows.length - 1) continue;
    const w = r.locator('input').nth(0);
    if (!(await w.inputValue())) await w.fill(String(opts.weight || 20));
    await r.locator('input').nth(1).fill(String(reps));
    await r.locator('.rp-tick').click();
  }
  await page.click('#fbtn');
  await page.waitForSelector('.fb-card, #modal.open');
  if (await page.locator('.fb-card').count()) {
    if (opts.onFeedback) await opts.onFeedback();
    await page.click('text=Save Feedback');
    await page.waitForSelector('#modal.open');
  }
  return page.textContent('#modal-inner');
}

async function closeDone(page) {
  await page.click('.modal-btn');
  await page.waitForSelector('.today-card');
}

const state = (page) => page.evaluate(() => JSON.parse(localStorage.cleanslate_rp_state));
const logs = (page) => page.evaluate(() => JSON.parse(localStorage.cleanslate_rp_logs || '[]'));

module.exports = { startServer, fakeWorker, launch, newPage, doSession, closeDone, state, logs };
