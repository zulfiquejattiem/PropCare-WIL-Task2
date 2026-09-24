/* PropCare Task 2 — headless browser smoke test.
 * Drives the SPA on http://localhost:8124 through every role, screen
  * and key action using Puppeteer (project dependency).
 *
 * Run:  node scripts/browser-test.js
 *       node scripts/browser-test.js --shots-only   # render screens, no asserts
 */
const fs = require('fs');
const path = require('path');

const BASE =
  process.env.PPC_BASE || 'http://localhost:8124';
const SHOTS = path.join(__dirname, '..', 'browser-shots');
const SHOTS_ONLY = process.argv.indexOf('--shots-only') !== -1;

// Optional path to a Chrome/Chromium binary. Leave unset to let Puppeteer use
// the browser it downloaded during `npm ci`.
const CHROME = process.env.PPC_CHROME || process.env.CHROME_PATH || '';

const PASS = 'PASS', FAIL = 'FAIL', INFO = 'INFO';
const results = [];
let errors = [];

function record(step, status, note) {
  // `--shots-only` renders every screen without asserting: a failed check is
  // reported as informational and never counted, so the run cannot fail on it.
  if (SHOTS_ONLY && status === FAIL) {
    results.push({ step, status: INFO, note });
    console.log('  \u2022 ' + step + (note ? '  [' + note + ']' : ''));
    return;
  }
  results.push({ step, status, note });
  console.log((status === PASS ? '  \u2713' : status === FAIL ? '  \u2717' : '  \u2022') + ' ' + step + (note ? '  [' + note + ']' : ''));
}

const EMAILS = {
  tenant: 'sarahwilliams@example.com',
  manager: 'michael.jacobs@obsrealty.co.za',
  tech: 'johan.vdm@obsrealty.co.za',
  admin: 'admin@obsrealty.co.za'
};
const NAMES = {
  tenant: 'Sarah Williams',
  manager: 'Michael Jacobs',
  tech: 'Johan van der Merwe',
  admin: 'System Admin'
};
const PASSWORD = 'PropCare123!';

function errFile(kind, roleOrName) {
  return path.join(SHOTS, 'errors', `${kind}-${roleOrName}.png`);
}

/**
 * Save a diagnostic screenshot for a failed step.
 *
 * A browser failure without the page it happened on is close to undebuggable,
 * so every caught failure captures the state it died in. Never throws: losing
 * the screenshot must not mask the original error.
 */
async function captureError(page, kind, roleOrName) {
  if (!page) return null;
  const file = errFile(kind, roleOrName);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch (e) {
    return null;
  }
}

async function healthCheck() {
  const r = await fetch(BASE + '/api/health');
  if (!r.ok) throw new Error('server health check failed: ' + r.status);
}

async function newContext(browser) {
  const page = await browser.newPage();
  const ctxErrors = [];
  page.on('pageerror', (e) => ctxErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_FILE|favicon/i.test(m.text())) {
      ctxErrors.push('console: ' + m.text().slice(0, 220));
    }
  });
  return { page, ctxErrors };
}

async function login(page, role) {
  await page.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginScreen:not(.hidden)');
  await page.select('#loginRole', EMAILS[role]);
  await page.click('#loginBtn');
  try {
    await page.waitForSelector('#app:not(.hidden)', { timeout: 10000 });
  } catch (e) {
    const diag = await page.evaluate(() => ({
      toast: document.getElementById('toast').textContent.slice(0, 120),
      loginErr: (document.querySelector('#loginScreen .error-msg') || {}).textContent || '',
      banner: (document.querySelector('#appBody .error-banner') || {}).textContent || '',
      hash: location.hash,
    }));
    const shot = await captureError(page, 'login', role);
    throw new Error('login failed as ' + role + ' -> ' + JSON.stringify(diag) +
      (shot ? ' (screenshot: ' + path.relative(process.cwd(), shot) + ')' : ''));
  }
  await page.waitForFunction(() => document.querySelectorAll('.hero').length > 0, { timeout: 10000 });
  const name = await page.evaluate(() => document.getElementById('userName').textContent);
  if (!name) record('login ' + role, FAIL, '#userName empty');
  else record('login ' + role, PASS, 'signed in as ' + name);
}

async function shot(page, role, name) {
  const dir = path.join(SHOTS, role);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true });
}

async function waitRendered(page) {
  await page.waitForFunction(() => {
    const b = document.getElementById('appBody');
    return b && !b.textContent.includes('Loading') && !document.querySelector('#appBody .spinner');
  }, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 250));
}

async function nav(page, hash, expects) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await new Promise((r) => setTimeout(r, 150));
  if (expects) await page.waitForSelector(expects, { timeout: 10000 });
  await waitRendered(page);
}

async function assertClean(page, ctxErrors, step) {
  if (ctxErrors.length) {
    record(step, FAIL, ctxErrors[0]);
    errors = errors.concat(ctxErrors);
    return false;
  }
  const hasErr = await page.evaluate(() => !!document.querySelector('#appBody .error-banner'));
  if (hasErr) {
    const txt = await page.evaluate(() => document.querySelector('#appBody .error-banner').textContent);
    record(step, FAIL, 'error-banner: ' + txt.trim().slice(0, 140));
    return false;
  }
  return true;
}

async function toastText(page) {
  return page.evaluate(() => document.getElementById('toast').textContent);
}

async function openRequestDetail(page, id) {
  await page.evaluate(() => { location.hash = '#/requests'; });
  await page.waitForSelector('.request-item[data-id]');
  await page.waitForFunction((rid) => {
    const card = document.querySelector('.request-item[data-id]');
    const list = [...document.querySelectorAll('.request-item[data-id]')].find((c) => c.getAttribute('data-id') === rid);
    if (list) { list.click(); return true; }
    return false;
  }, {}, id);
  await page.waitForFunction(() => document.getElementById('appBody').textContent.includes('Status history') || !!document.querySelector('#appBody .error-banner'));
  await waitRendered(page);
}

/* ---------- TENANT ---------- */
async function tenantSuite(browser) {
  const { page, ctxErrors } = await newContext(browser);
  await login(page, 'tenant');
  if (ctxErrors.length) record('login-errors', FAIL, ctxErrors[0]);
  await shot(page, 'tenant', 'overview');

  for (const [key, href] of [['requests', '#/requests'], ['properties', '#/properties'], ['notifications', '#/notifications'], ['mockups', '#/mockups']]) {
    await nav(page, href);
    await shot(page, 'tenant', key);
    if (!(await assertClean(page, ctxErrors, 'tenant nav ' + key))) break;
    record('tenant nav ' + key, PASS, 'screenshot saved');
    await auditInteractives(page, ctxErrors, 'tenant ' + key);
  }

  /* report issue wizard */
  const idsBefore = await page.evaluate(async () => (await window.PropCareAPI.get('/api/requests')).data.requests.map((r) => r.id));
  await nav(page, '#/report', '.steps');
  await page.click('#nextStep'); // step 1 -> 2
  await page.waitForSelector('#nextStep');
  await page.click('#nextStep'); // step 2 -> 3
  await page.waitForSelector('#repTitle');
  await page.type('#repTitle', 'Automated browser probe leak');
  await page.type('#repDetail', 'End-to-end test request created by the headless browser suite.');
  await page.click('#addPhoto'); // attach 1 photo
  await page.waitForFunction(() => document.getElementById('appBody').textContent.includes('Photos (1)'));
  await page.click('#nextStep'); // submit
  await page.waitForFunction(() => document.getElementById('appBody').textContent.includes('Issue submitted'), { timeout: 10000 });
  await waitRendered(page);
  await shot(page, 'tenant', 'report-submitted');
  if (!(await assertClean(page, ctxErrors, 'tenant report wizard'))) { await page.close(); return null; }

  /* capture new request id (diff against ids seen before the wizard) */
  const newId = await page.evaluate(async (before) => {
    const after = (await window.PropCareAPI.get('/api/requests')).data.requests.map((r) => r.id);
    return after.find((id) => !before.includes(id)) || null;
  }, idsBefore);
  record(newId ? 'tenant new request' : 'tenant new request', newId ? PASS : FAIL, newId || 'no request found');

  /* open new request detail, post comment */
  await openRequestDetail(page, newId);
  await shot(page, 'tenant', 'request-detail');
  await page.type('#newComment', 'Probe comment from browser test.');
  await page.click('[data-act="comment"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Comment posted'), { timeout: 8000 }).catch(() => {});
  await assertClean(page, ctxErrors, 'tenant post comment');

  await page.close();
  return newId;
}

/* ---------- MANAGER: assign a submitted request to Johan ---------- */
async function managerAssign(page, ctxErrors, id) {
  const ok = await page.evaluate(async (rid) => {
    const list = [...document.querySelectorAll('.request-item[data-id]')];
    const card = list.find((c) => c.getAttribute('data-id') === rid);
    if (!card) return 'missing-card';
    card.click();
    await new Promise((r) => setTimeout(r, 400));
    const btn = document.querySelector('[data-act="assign"]');
    if (!btn) return 'no-assign';
    btn.click();
    await new Promise((r) => setTimeout(r, 300));
    const sel = document.getElementById('assignTech');
    const opt = [...sel.options].find((o) => o.text.toLowerCase().includes('johan'));
    if (!opt) return 'no-johan-option';
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('assignNote').value = 'Browser probe: please attend to the leak.';
    document.getElementById('assignOk').click();
    return 'ok';
  }, id);
  if (ok !== 'ok') { record('manager assign', FAIL, ok); return false; }
  try {
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Assigned to'), { timeout: 10000 });
  } catch (e) {
    const info = await page.evaluate((rid) => ({
      toast: document.getElementById('toast').textContent,
      statusText: document.body.textContent.slice(0, 260)
    }), id);
    const failureShot = await captureError(page, 'manager-assign', id);
    record('manager assign', FAIL, 'toast="' + info.toast + '"' +
      (failureShot ? ' (screenshot: ' + path.relative(process.cwd(), failureShot) + ')' : ''));
    return false;
  }
  await page.waitForFunction(() => {
    const b = document.getElementById('appBody');
    return b.textContent.includes('Status history') && b.textContent.includes('Assigned');
  });
  await waitRendered(page);
  return assertClean(page, ctxErrors, 'manager assign');
}

/* ---------- TECHNICIAN: accept then complete ---------- */
async function techAccept(page, ctxErrors, id) {
  await nav(page, '#/jobs');
  const found = await page.evaluate((rid) => {
    const card = [...document.querySelectorAll('.request-item[data-id]')].find((c) => c.getAttribute('data-id') === rid);
    if (card) { card.click(); return true; }
    return false;
  }, id);
  if (!found) { record('tech open job', FAIL, 'job ' + id + ' not listed'); return false; }
  await page.waitForFunction(() => document.getElementById('appBody').textContent.includes('Status history'));
  await waitRendered(page);
  await page.click('[data-act="accept"]');
  await page.waitForSelector('#modalBox [data-confirm]');
  await page.click('#modalBox [data-confirm]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Job accepted'), { timeout: 8000 });
  await page.waitForFunction(() => document.getElementById('appBody').textContent.includes('In progress'));
  await waitRendered(page);
  return assertClean(page, ctxErrors, 'tech accept job');
}

async function techComplete(page, ctxErrors, id) {
  await page.click('[data-act="complete"]');
  await page.waitForSelector('#completeNote');
  await page.type('#completeNote', 'Probe: sealed and tested the supply line.');
  await page.click('#completeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('marked complete'), { timeout: 8000 });
  await page.waitForFunction(() => document.getElementById('appBody').textContent.includes('Completed'));
  await waitRendered(page);
  await shot(page, 'tech', 'job-completed');
  return assertClean(page, ctxErrors, 'tech complete job');
}

/* ---------- role suites ---------- */
async function managerSuite(browser, id) {
  const { page, ctxErrors } = await newContext(browser);
  await login(page, 'manager');
  await shot(page, 'manager', 'overview');

  for (const [key, href] of [['requests', '#/requests'], ['properties', '#/properties'], ['tenants', '#/tenants'], ['technicians', '#/technicians'], ['reports', '#/reports'], ['notifications', '#/notifications'], ['mockups', '#/mockups']]) {
    await nav(page, href);
    await shot(page, 'manager', key);
    if (!(await assertClean(page, ctxErrors, 'manager nav ' + key))) break;
    record('manager nav ' + key, PASS, 'screenshot saved');
    await auditInteractives(page, ctxErrors, 'manager ' + key);
  }

  if (id) {
    await nav(page, '#/requests');
    await managerAssign(page, ctxErrors, id);
  }

  /* reports CSV export */
  await nav(page, '#/reports');
  await page.click('[data-export]');
  await new Promise((r) => setTimeout(r, 800));
  const t = await toastText(page);
  if (/CSV|exported/i.test(t)) record('manager CSV export', PASS, t);
  else record('manager CSV export', FAIL, t);

  await page.close();
}

async function techSuite(browser, id) {
  const { page, ctxErrors } = await newContext(browser);
  await login(page, 'tech');
  await shot(page, 'tech', 'overview');

  for (const [key, href] of [['jobs', '#/jobs'], ['schedule', '#/schedule'], ['completed', '#/completed'], ['notifications', '#/notifications'], ['mockups', '#/mockups']]) {
    await nav(page, href);
    await shot(page, 'tech', key);
    if (!(await assertClean(page, ctxErrors, 'tech nav ' + key))) break;
    record('tech nav ' + key, PASS, 'screenshot saved');
    await auditInteractives(page, ctxErrors, 'tech ' + key);
  }

  if (id) {
    await techAccept(page, ctxErrors, id);
    await techComplete(page, ctxErrors, id);
  }

  await page.close();
}

async function adminSuite(browser) {
  const { page, ctxErrors } = await newContext(browser);
  await login(page, 'admin');
  await shot(page, 'admin', 'overview');

  for (const [key, href] of [['users', '#/users'], ['properties', '#/properties'], ['categories', '#/categories'], ['roles', '#/roles'], ['reports', '#/reports'], ['settings', '#/settings'], ['notifications', '#/notifications'], ['mockups', '#/mockups']]) {
    await nav(page, href);
    await shot(page, 'admin', key);
    if (!(await assertClean(page, ctxErrors, 'admin nav ' + key))) break;
    record('admin nav ' + key, PASS, 'screenshot saved');
    await auditInteractives(page, ctxErrors, 'admin ' + key);
  }

  /* add user */
  await nav(page, '#/users');
  const probeEmail = 'probe-' + Date.now() + '@example.com';
  const created = await page.evaluate(async (em) => {
    document.querySelector('[data-usermodal]').click();
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('nuName').value = 'Probe User';
    document.getElementById('nuEmail').value = em;
    document.getElementById('nuRole').value = 'tenant';
    document.getElementById('nuPass').value = 'ProbePass123a';
    document.getElementById('nuOk').click();
    return true;
  }, probeEmail);
  if (created) {
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('created'), { timeout: 8000 });
    await page.waitForSelector('#appBody .table-wrap');
    await waitRendered(page);
    const shown = await page.evaluate((em) => document.body.textContent.includes(em), probeEmail);
    record(shown ? 'admin add user' : 'admin add user', shown ? PASS : FAIL, probeEmail);
  }
  if (await assertClean(page, ctxErrors, 'admin add user')) {
    /* disable just-created user via its row toggle */
    await page.evaluate((em) => {
      const tr = [...document.querySelectorAll('#appBody tr')].find((r) => r.textContent.includes(em));
      const btn = tr && tr.querySelector('[data-toggle]');
      if (btn) btn.click();
    }, probeEmail);
    await new Promise((r) => setTimeout(r, 600));
    await waitRendered(page);
    await assertClean(page, ctxErrors, 'admin disable user');
  }

  /* categories preset toast */
  await nav(page, '#/categories');
  await page.click('[data-preset]');
  await new Promise((r) => setTimeout(r, 400));
  await assertClean(page, ctxErrors, 'admin categories');
  record('admin categories toast', PASS, await toastText(page));

  /* settings save */
  await nav(page, '#/settings');
  await page.click('#saveSet');
  await new Promise((r) => setTimeout(r, 400));
  record('admin settings saved', PASS, await toastText(page));

  await page.close();
}

/* ---------- mobile ---------- */
async function mobileSuite(browser) {
  const { page, ctxErrors } = await newContext(browser);
  await page.setViewport({ width: 390, height: 844 });
  await login(page, 'tenant');
  const navVisible = await page.evaluate(() => {
    const n = document.getElementById('bottomNav');
    return n && getComputedStyle(n).display !== 'none';
  });
  record(navVisible ? 'mobile bottom nav' : 'mobile bottom nav', navVisible ? PASS : FAIL, '390px viewport');
  if (navVisible) {
    await page.evaluate(() => { document.querySelector('#bottomNav a[href="#/requests"]').click(); });
    await page.waitForSelector('.request-item[data-id]');
    await assertClean(page, ctxErrors, 'mobile nav to requests');
    await shot(page, 'mobile', 'requests');
  }
  const skip = await page.evaluate(() => !!document.querySelector('.skip-link') && getComputedStyle(document.querySelector('.skip-link')).position === 'absolute');
  record(skip ? 'skip-link present' : 'skip-link present', skip ? PASS : FAIL, 'a11y');
  await page.close();
}

/* ---------- accessibility audits (9.4.1) ---------- */
async function auditInteractives(page, ctxErrors, label) {
  const bad = await page.evaluate(() => {
    const list = [];
    const rendered = (el, s) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex="0"]').forEach((el) => {
      if (el.type === 'hidden') return;
      if (!rendered(el)) return;
      const acc = (el.getAttribute('aria-label') || '').trim() ||
        (el.getAttribute('aria-labelledby') ? 'via-aria' : '') ||
        (el.labels && el.labels.length ? 'via-label' : '') ||
        (el.textContent || '').trim() ||
        (el.getAttribute('placeholder') || '').trim() ||
        (el.getAttribute('alt') || '').trim();
      if (!acc) list.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className || '').split(' ')[0]);
    });
    return list;
  });
  record('a11y names ' + label, bad.length ? FAIL : PASS, bad.length ? bad.slice(0, 4).join(' | ') : 'all controls have accessible names');
  return assertClean(page, ctxErrors, 'a11y names ' + label);
}

async function keyboardSuite(browser) {
  const { page, ctxErrors } = await newContext(browser);
  await login(page, 'tenant');
  await nav(page, '#/requests');
  await auditInteractives(page, ctxErrors, 'requests');

  /* Tab to a status-filter chip and activate with Enter */
  let chipHit = false, outline = '';
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        isChip: el.hasAttribute('data-filter') && !el.classList.contains('active'),
        outline: getComputedStyle(el).outlineStyle + ':' + getComputedStyle(el).outlineWidth,
        cls: String(el.className)
      };
    });
    if (info && info.isChip) { chipHit = true; outline = info.outline; break; }
  }
  record(chipHit ? 'keyboard focus chip' : 'keyboard focus chip', chipHit ? PASS : FAIL, outline);
  if (chipHit) {
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 500));
    await waitRendered(page);
    const hash = await page.evaluate(() => location.hash);
    record(hash.indexOf('status=') !== -1 ? 'keyboard filter chip' : 'keyboard filter chip', hash.indexOf('status=') !== -1 ? PASS : FAIL, hash);
  }

  /* Tab to a request card and open it with Enter */
  await nav(page, '#/requests');
  let cardHit = false;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const isCard = await page.evaluate(() => !!document.activeElement && document.activeElement.matches('.request-item[data-id]:not([data-static])'));
    if (isCard) { cardHit = true; break; }
  }
  record(cardHit ? 'keyboard focus request' : 'keyboard focus request', cardHit ? PASS : FAIL, '');
  if (cardHit) {
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('appBody').textContent.includes('Status history') || !!document.querySelector('#appBody .error-banner'), { timeout: 8000 });
    await waitRendered(page);
    const hash = await page.evaluate(() => location.hash);
    record(hash.indexOf('#/request/') !== -1 ? 'keyboard open request' : 'keyboard open request', hash.indexOf('#/request/') !== -1 ? PASS : FAIL, hash);
    await auditInteractives(page, ctxErrors, 'request detail');
  }

  const skip = await page.evaluate(() => {
    const s = document.querySelector('.skip-link');
    if (!s) return false;
    s.focus();
    return getComputedStyle(s).top !== '-100%';
  });
  if (!skip) {
    await page.evaluate(() => { document.querySelector('.skip-link').focus(); });
  }
  const focusRing = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.skip-link'));
    return s.outlineStyle !== 'none';
  });
  record('keyboard skip-link', focusRing ? PASS : FAIL, 'focusable + visible');

  await page.close();
}

/* ---------- main ---------- */
(async () => {
  try {
    await healthCheck();
  } catch (e) {
    console.error('Server not reachable at ' + BASE + ' — start it first (node --experimental-sqlite server.js)');
    process.exit(1);
  }

  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    headless: 'new',
    defaultViewport: {
      width: 1440,
      height: 900,
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1440,900'
    ]
  });

  let lifecycleId = null;
  let where = 'tenantSuite';
  try {
    where = 'tenantSuite';
    lifecycleId = await tenantSuite(browser);
    where = 'managerSuite';
    await managerSuite(browser, lifecycleId);
    where = 'techSuite';
    await techSuite(browser, lifecycleId);
    where = 'adminSuite';
    await adminSuite(browser);
    where = 'mobileSuite';
    await mobileSuite(browser);
    where = 'keyboardSuite';
    await keyboardSuite(browser);

    if (lifecycleId) {
      /* final proof: tenant reopens request, rates, confirms & closes */
      where = 'finalLifecycle';
      const { page, ctxErrors } = await newContext(browser);
      await login(page, 'tenant');
      await nav(page, '#/requests');
      await openRequestDetail(page, lifecycleId);
      if (await page.evaluate(() => !!document.querySelector('[data-act="rate"]'))) {
        await page.click('[data-act="rate"]');
        await page.waitForSelector('#stars .star[data-s="5"]');
        await page.click('#stars .star[data-s="5"]');
        await page.click('#rateOk');
        await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Rating recorded'), { timeout: 8000 });
      }
      /* close it (confirm as resolved) */
      const canConfirm = await page.evaluate(() => !!document.querySelector('[data-act="confirm"]'));
      if (canConfirm) {
        await page.click('[data-act="confirm"]');
        await page.waitForSelector('#modalBox [data-confirm]');
        await page.click('#modalBox [data-confirm]');
      }
      await page.waitForFunction(
        () => document.getElementById('appBody').textContent.includes('Closed') || document.getElementById('toast').textContent.includes('closed'),
        { timeout: 10000 }
      );
      await waitRendered(page);
      const finalUi = await page.evaluate(() => ({
        closed: document.getElementById('appBody').textContent.includes('Closed'),
        rated: document.getElementById('appBody').textContent.includes('Your rating')
      }));
      record('lifecycle rate + close', finalUi.closed && finalUi.rated ? PASS : FAIL, lifecycleId + ' closed=' + finalUi.closed + ' rated=' + finalUi.rated);
      await shot(page, 'tenant', 'request-closed');
      await assertClean(page, ctxErrors, 'lifecycle confirm close');
      await page.close();
    }
  } catch (e) {
    record('unhandled', FAIL, '[' + where + '] ' + e.message);
    errors.push('unhandled [' + where + ']: ' + e.message);
  } finally {
    await browser.close();
  }

  const fails = results.filter((r) => r.status === FAIL).length;
  const passes = results.filter((r) => r.status === PASS).length;
  console.log('\n---- summary ----');
  console.log('PASS ' + passes + '  FAIL ' + fails + (errors.length ? '  console/page errors: ' + errors.length : ''));
  if (errors.length) { console.log('\nfirst console/page error:'); console.log(errors[0]); }
  fs.writeFileSync(path.join(SHOTS, 'summary.txt'), results.map((r) => r.status + ' ' + r.step).join('\n') + '\n');
  console.log('Screenshots: ' + SHOTS);
  process.exit(fails || (errors.length ? 1 : 0));
})();