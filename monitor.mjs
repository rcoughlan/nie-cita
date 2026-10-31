// Alert-only cita monitor. Walks the portal up to the office list and stops there:
// it never books, never solves captchas, and never reaches the phone/email step.
//
//   node monitor.mjs           one check
//   node monitor.mjs --loop    keep checking for LOOP_MINUTES (default 345; "forever" = no end)
//   node --env-file=.env monitor.mjs   local run with secrets in a gitignored .env
//
// Env: NIE_PASSPORT, NIE_NAME (required), NIE_COUNTRY (default IRLANDA),
//      NTFY_TOPIC (shared: slot alerts only), NTFY_ADMIN_TOPIC (Ryan only: blocks, errors),
//      DATA_DIR (where checks.csv lives; pushed with git when set), PROXY_URL (optional),
//      MONITOR_HOST (label in the log, e.g. pi),
//      HEADED (default on outside CI: a normal Chrome window, since the portal's firewall blocks
//      headless Chrome; HEADED=0 to run headless), MINIMISED (default on when headed: the
//      window is minimised straight after launch and reused, so nothing pops up between checks).
//
// Before each check the egress country is looked up; unless it's Spain the portal isn't touched
// and the check is logged as `no-vpn` (or `offline` if the lookup fails).
//
// Privacy: the passport and name are only ever typed into the portal form. Nothing derived
// from them is logged, written to checks.csv or sent to ntfy: errors are reduced to a fixed
// category, and anything printed is scrubbed of both values first. No screenshots or traces.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as cfg from './config.mjs';

const env = process.env;
const DATA_DIR = env.DATA_DIR || '.';
const LOG = path.join(DATA_DIR, 'checks.csv');
const RUNNER = (env.MONITOR_HOST || (env.RUNNER_NAME ? 'gha' : 'local')).replace(/[^\w-]/g, '');
const ERROR_STREAK_ALERT = 5;
const NO_VPN_ALERT_MIN = 60;
const flag = (v, dflt) => (v ? !/^(0|false|no)$/i.test(v) : dflt);
const HEADED = flag(env.HEADED, !env.CI);
const MINIMISED = HEADED && flag(env.MINIMISED, true);

// Every form of the personal values we might ever print: as given, upper/lower case,
// without spaces, and each word of the name.
const SECRETS = [env.NIE_PASSPORT, env.NIE_NAME]
  .filter(Boolean)
  .flatMap(v => [v, v.trim(), v.replace(/\s+/g, ''), ...v.split(/\s+/)])
  .filter(v => v && v.length >= 3)
  .flatMap(v => [v, v.toUpperCase(), v.toLowerCase()])
  .sort((a, b) => b.length - a.length);

function scrub(text) {
  let out = String(text);
  for (const s of SECRETS) out = out.split(s).join('[redacted]');
  return out;
}

// Reduce any exception to a fixed category, so raw messages never reach the public log.
function errorCategory(msg) {
  if (/page\.goto: Timeout|net::ERR_TIMED_OUT/i.test(msg)) return 'timeout';
  if (/net::/i.test(msg)) return 'network';
  if (/waitForSelector|Timeout \d+ms exceeded/i.test(msg)) return 'element-timeout';
  if (/Target .*closed|browser has been closed/i.test(msg)) return 'browser-closed';
  return 'other';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Sleep until a wall-clock time, in short steps. If the machine sleeps through it, this returns
// once on wake and the loop does a single check: no catch-up burst.
async function sleepUntil(t) {
  while (Date.now() < t) await sleep(Math.min(30000, t - Date.now()));
}
const pause = (min, max) => sleep(min + Math.random() * (max - min));

function madridNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, stamp: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` };
}

function isDaytime(hour) {
  return cfg.DAY_END_HOUR < cfg.DAY_START_HOUR
    ? hour >= cfg.DAY_START_HOUR || hour < cfg.DAY_END_HOUR
    : hour >= cfg.DAY_START_HOUR && hour < cfg.DAY_END_HOUR;
}

// ---- log (no personal data: timestamp, outcome, office names only) ----

function readLog() {
  if (!fs.existsSync(LOG)) return [];
  return fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(1).filter(Boolean).map(line => {
    const [ts_utc, ts_madrid, result, offices, runner] = line.split(',');
    return { ts_utc, ts_madrid, result, offices, runner };
  });
}

function appendLog(result, offices = []) {
  if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, 'ts_utc,ts_madrid,result,offices,runner\n');
  const clean = offices.map(o => scrub(o).replace(/[,\n]/g, ' ').trim()).join(' | ');
  fs.appendFileSync(LOG, [new Date().toISOString(), madridNow().stamp, result, clean, RUNNER].join(',') + '\n');
  console.log(`${madridNow().stamp} ${result}${clean ? ' ' + clean : ''}`);
}

function saveLog() {
  if (!env.DATA_DIR) return;
  try {
    execFileSync('/bin/bash', [path.resolve('scripts/save-log.sh'), DATA_DIR], { stdio: 'inherit' });
  } catch {
    console.log('save-log failed');
  }
}

// ---- notifications ----
// NTFY_TOPIC is shared with her and only ever gets slot alerts.
// NTFY_ADMIN_TOPIC is Ryan's alone and gets everything operational.

async function notify(topic, title, message, { priority = 'default', tags = '', click } = {}) {
  title = scrub(title);
  message = scrub(message);
  if (!topic) return console.log(`[no topic] ${title}: ${message}`);
  const headers = { Title: title, Priority: priority, Tags: tags };
  if (click) headers.Click = click;
  try {
    await fetch(`https://ntfy.sh/${topic}`, { method: 'POST', body: message, headers });
  } catch {
    console.log('ntfy failed');
  }
}
const notifyShared = (...a) => notify(env.NTFY_TOPIC, ...a);
const notifyAdmin = (...a) => notify(env.NTFY_ADMIN_TOPIC, ...a);

// ---- egress country: the portal only answers Spanish IPs, so don't touch it from anywhere else ----

async function egressCountry() {
  const lookups = [
    ['https://ipinfo.io/country', t => t.trim()],
    ['http://ip-api.com/line/?fields=countryCode', t => t.trim()],
  ];
  for (const [url, parse] of lookups) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const code = parse(await res.text());
        if (/^[A-Z]{2}$/.test(code)) return code;
      }
    } catch {}
  }
  return null;
}

// ---- browser: one normal window, reused across checks (no new window popping up every time) ----

let browser, page;

async function launch() {
  const opts = { headless: !HEADED };
  if (env.PROXY_URL) opts.proxy = { server: env.PROXY_URL };
  // A minimised window would otherwise get its timers throttled, which can stall page scripts.
  if (HEADED) opts.args = ['--window-size=1280,900', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
  // Prefer the installed Google Chrome; fall back to Playwright's bundled Chromium.
  try {
    const b = await chromium.launch({ ...opts, channel: 'chrome' });
    console.log(`browser: Google Chrome ${b.version()}${HEADED ? '' : ' (headless)'}`);
    return b;
  } catch {
    const b = await chromium.launch(opts);
    console.log(`browser: bundled Chromium ${b.version()}${HEADED ? '' : ' (headless)'}`);
    return b;
  }
}

async function getPage() {
  if (page && !page.isClosed() && browser?.isConnected()) return page;
  await browser?.close().catch(() => {});
  browser = await launch();
  const context = await browser.newContext({
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    viewport: HEADED ? null : { width: 1280, height: 900 },
  });
  page = await context.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));
  if (MINIMISED) await minimise(page);
  return page;
}

// Minimise the window via the DevTools protocol (works on macOS, where off-screen positions get
// clamped back on screen). It stays minimised: navigations don't restore or focus it.
async function minimise(p) {
  try {
    const cdp = await p.context().newCDPSession(p);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    await cdp.detach();
  } catch {
    console.log('could not minimise the window');
  }
}

// ---- one check ----

async function check() {
  const page = await getPage();
  // Start each check with a fresh portal session.
  await page.context().clearCookies().catch(() => {});
  const body = async () => (await page.locator('body').innerText({ timeout: 15000 }).catch(() => '')) || '';
  const looksBlocked = t => /requested url was rejected|request rejected|access denied|support id|intrusion prevention/i.test(t);
  const blockNote = t => (/intrusion prevention/i.test(t) ? 'firewall' : 'rejected');
  let step = 'index';
  let typed = false; // once personal data is typed, no page text is ever printed

  // Diagnostics for unexpected pages. Only used before any personal data is typed, so the page
  // can't contain it; still scrubbed. Printed to the console only, never to checks.csv.
  const diagnose = async label => {
    if (typed) return console.log(`diagnostic (${label}): step=${step} (no page details after the form)`);
    const text = (await body()).replace(/\s+/g, ' ').trim();
    console.log(scrub(`diagnostic (${label}): step=${step} url=${page.url()} title="${await page.title().catch(() => '')}"`));
    console.log(scrub(`diagnostic text: ${text.slice(0, 300)}`));
  };

  // An interactive challenge (checkbox, image grid, picture captcha) means a human is needed: never
  // solved or bypassed here. Invisible/score-based protection that a normal browser passes is fine.
  const interactiveCaptcha = () => page.evaluate(() => {
    const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const challenge = [...document.querySelectorAll(
      'iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"], iframe[src*="hcaptcha"], #captcha, img.img-thumbnail, input[name*=captcha i]:not([type=hidden])')]
      .filter(vis);
    const checkbox = [...document.querySelectorAll('.g-recaptcha')]
      .filter(e => vis(e) && e.getAttribute('data-size') !== 'invisible');
    return challenge.length + checkbox.length > 0;
  }).catch(() => false);

  // Click and wait for the page it submits to (the portal posts forms rather than using links).
  const submit = async selector => {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}),
      page.click(selector),
    ]);
    await pause(2000, 4000);
  };

  // After each page: stop early on a block page.
  const blockedNow = async () => {
    const t = await body();
    return looksBlocked(t) ? { result: 'blocked', note: blockNote(t) } : null;
  };

  try {
    // 1. Province picker, as a person would start.
    await page.goto(cfg.INDEX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!(await page.waitForSelector('select#form', { timeout: 45000 }).catch(() => null))) {
      const b = await blockedNow();
      if (b) { await diagnose('blocked'); return b; }
      await diagnose('province picker');
      return { result: 'error', note: 'province picker not found' };
    }
    await pause(2000, 4000);
    await page.click('#cookie_action_close_header', { timeout: 3000 }).catch(() => {});
    const province = await page.locator('select#form option').evaluateAll(
      (opts, name) => opts.find(o => o.textContent.trim().toLowerCase() === name.toLowerCase())?.value, cfg.PROVINCE_NAME);
    if (!province) return { result: 'error', note: 'province not listed' };
    await page.selectOption('select#form', province);
    await pause(1000, 2000);
    await submit('#btnAceptar');

    // 2. Office + trámite. "Cualquier oficina" is the default; changing it reloads the page.
    step = 'office';
    if (!(await page.waitForSelector('#sede', { timeout: 30000 }).catch(() => null))) {
      const b = await blockedNow();
      if (b) { await diagnose('blocked'); return b; }
      await diagnose('office page');
      return { result: 'error', note: 'office page not reached' };
    }
    if ((await page.locator('#sede').inputValue()) !== cfg.OFFICE_ID) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}),
        page.selectOption('#sede', cfg.OFFICE_ID),
      ]);
      await pause(1500, 3000);
    }
    const tramite = page.locator('select[name="tramiteGrupo[0]"]');
    if (!(await tramite.locator(`option[value="${cfg.TRAMITE_ID}"]`).count())) {
      return { result: 'error', note: 'tramite not offered' };
    }
    await tramite.selectOption(cfg.TRAMITE_ID);
    await pause(1500, 3000);
    await submit('#btnAceptar');

    // 3. Information page → Entrar.
    step = 'info';
    if (!(await page.waitForSelector('#btnEntrar', { timeout: 30000 }).catch(() => null))) {
      const b = await blockedNow();
      if (b) { await diagnose('blocked'); return b; }
      await diagnose('info page');
      return { result: 'error', note: 'info page not reached' };
    }
    await pause(1500, 3000);
    await submit('#btnEntrar');

    // 4. "Presentación sin Cl@ve" (identify by passport instead of Cl@ve), when offered.
    step = 'access';
    const sinClave = page.locator('input[value*="sin Cl@ve" i], a:has-text("sin Cl@ve"), button:has-text("sin Cl@ve")').first();
    if (!(await page.locator('#txtIdCitado').count()) && await sinClave.count()) {
      await pause(1000, 2500);
      await sinClave.click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await pause(1500, 3000);
    }

    // 5. Her details. Nothing on screen is printed from here on.
    step = 'form';
    if (!(await page.waitForSelector('#txtIdCitado', { timeout: 30000 }).catch(() => null))) {
      const b = await blockedNow();
      if (b) { await diagnose('blocked'); return b; }
      await diagnose('details form');
      return { result: 'error', note: 'details form not reached' };
    }
    if (await interactiveCaptcha()) return { result: 'captcha', note: 'before form' };
    typed = true;
    await page.check('#rdbTipoDocPas').catch(() => {});
    await pause(500, 1200);
    await page.fill('#txtIdCitado', env.NIE_PASSPORT);
    await pause(600, 1500);
    await page.fill('#txtDesCitado', env.NIE_NAME);
    if (await page.locator('#txtPaisNac').count()) {
      const country = (env.NIE_COUNTRY || 'IRLANDA').toUpperCase();
      const value = await page.locator('#txtPaisNac option').evaluateAll(
        (opts, c) => opts.find(o => o.textContent.trim().toUpperCase() === c)?.value, country);
      if (value) await page.selectOption('#txtPaisNac', value);
    }
    await pause(1000, 2500);
    await submit('#btnEnviar');
    if (await interactiveCaptcha()) return { result: 'captcha', note: 'after form' };

    // 6. "Solicitar Cita".
    step = 'request';
    const b6 = await blockedNow();
    if (b6) return b6;
    if (!(await page.waitForSelector('#btnConsultar', { timeout: 30000 }).catch(() => null))) {
      await diagnose('request page');
      return { result: 'error', note: 'request page not reached' };
    }
    await pause(1000, 2500);
    await submit('#btnConsultar');

    // 7. Result. Stop here: never pick an office or slot.
    step = 'result';
    const text = await body();
    if (/no hay citas disponibles/i.test(text)) return { result: 'none' };
    if (await page.locator('#idSede').count()) {
      const offices = await page.locator('#idSede option').evaluateAll(
        opts => opts.filter(o => o.value).map(o => o.textContent.trim()));
      return { result: 'slots', offices };
    }
    if (looksBlocked(text)) return { result: 'blocked', note: blockNote(text) };
    if (await interactiveCaptcha()) return { result: 'captcha', note: 'at result' };
    await diagnose('result page');
    return { result: 'error', note: 'unexpected result page' };
  } catch (e) {
    const msg = String(e.message || e);
    if (!env.CI) console.log(`debug: step=${step}`, typed ? '' : scrub(msg.split('\n')[0]));
    const category = errorCategory(msg);
    return { result: ['timeout', 'network'].includes(category) ? 'blocked' : 'error', note: `${category} at ${step}` };
  } finally {
    // Leave the window on a blank page between checks, so nothing personal stays on screen.
    await page.goto('about:blank').catch(() => {});
  }
}

// ---- handle outcome: alerts on change only, so nothing spams ----

async function handle(outcome) {
  const now = madridNow();
  const day = isDaytime(now.hour);
  const prev = readLog().filter(r => !['heartbeat', 'no-vpn', 'offline'].includes(r.result)).at(-1)?.result;

  if (outcome.result === 'slots') {
    // Searched with "Cualquier oficina", so any office listed is valid; nearby ones are flagged.
    const preferred = outcome.offices.filter(o => cfg.PREFERRED_OFFICES.some(re => re.test(o)));
    const others = outcome.offices.filter(o => !preferred.includes(o));
    appendLog(preferred.length ? 'slots' : 'slots_other', outcome.offices);
    if (day) {
      const lines = [...preferred.map(o => `★ ${o}`), ...others];
      await notifyShared(preferred.length ? 'NIE cita available nearby - book now' : 'NIE cita available (further away) - book now',
        `Offices with slots:\n${lines.join('\n') || '(office names not shown)'}\n\nPick "Cualquier oficina" and trámite: ${cfg.TRAMITE_LABEL}\nTap to open the portal.`,
        { priority: preferred.length ? 'urgent' : 'high', tags: 'rotating_light', click: cfg.PROVINCE_URL });
    }
    return;
  }

  appendLog(outcome.result, outcome.note ? [outcome.note] : []);
  const bad = ['blocked', 'captcha'];
  if (bad.includes(outcome.result) && !bad.includes(prev)) {
    await notifyAdmin('NIE monitor blocked', `The portal returned "${outcome.result}" (${outcome.note || 'no detail'}) from ${RUNNER}. Checks continue; you'll hear when it recovers.`, { priority: 'high', tags: 'warning' });
  } else if (!bad.includes(outcome.result) && outcome.result !== 'error' && bad.includes(prev)) {
    await notifyAdmin('NIE monitor recovered', `Portal reachable again from ${RUNNER}.`, { tags: 'white_check_mark' });
  }

  if (outcome.result === 'error') {
    const checked = readLog().filter(r => !['heartbeat', 'no-vpn', 'offline'].includes(r.result));
    const recent = checked.slice(-ERROR_STREAK_ALERT);
    if (recent.length === ERROR_STREAK_ALERT && recent.every(r => r.result === 'error')
      && checked.at(-ERROR_STREAK_ALERT - 1)?.result !== 'error') {
      await notifyAdmin('NIE monitor erroring', `${ERROR_STREAK_ALERT} checks in a row failed on ${RUNNER} (latest: ${outcome.note}). The portal may have changed; the script probably needs a fix.`, { priority: 'high', tags: 'warning' });
    }
  }
}

// ---- main ----

const pastTeardown = () => madridNow().date >= cfg.TEARDOWN_DATE;
if (pastTeardown()) {
  console.log(`Teardown date ${cfg.TEARDOWN_DATE} reached: not checking. See TEARDOWN.md.`);
  process.exit(0);
}

if (!env.NIE_PASSPORT || !env.NIE_NAME) {
  console.error('NIE_PASSPORT and NIE_NAME must be set');
  process.exit(1);
}

const loop = process.argv.includes('--loop');
const deadline = env.LOOP_MINUTES === 'forever' ? Infinity : Date.now() + Number(env.LOOP_MINUTES || 345) * 60000;
let sinceSave = 0;
let noVpnSince = null;
let noVpnAlerted = false;

// Gate on the egress country. Returns true when it's safe to check the portal.
async function egressOk() {
  if (env.PROXY_URL) return true; // the proxy decides the egress, not this machine
  if (env.EGRESS_CHECK === '0') return true; // tests against a local fake portal only
  const country = await egressCountry();
  if (country === 'ES') {
    if (noVpnAlerted) await notifyAdmin('NIE monitor back on a Spanish IP', `Checks resumed on ${RUNNER}.`, { tags: 'white_check_mark' });
    noVpnSince = null;
    noVpnAlerted = false;
    return true;
  }
  // The country stays out of the public log; only the outcome is recorded.
  appendLog(country ? 'no-vpn' : 'offline');
  if (country) {
    noVpnSince ??= Date.now();
    if (!noVpnAlerted && isDaytime(madridNow().hour) && Date.now() - noVpnSince > NO_VPN_ALERT_MIN * 60000) {
      noVpnAlerted = true;
      await notifyAdmin('NIE monitor paused: not on a Spanish IP',
        `${RUNNER} has been on a ${country} IP for over ${NO_VPN_ALERT_MIN} min, so it isn't checking. Connect NordVPN to a Spain server.`,
        { priority: 'high', tags: 'warning' });
    }
  }
  return false;
}

do {
  let last = null;
  if (await egressOk()) await handle(last = await check());
  if (++sinceSave >= 10 || !loop) { saveLog(); sinceSave = 0; }
  if (!loop || pastTeardown()) break;

  // After a block, leave the portal alone for a good while: hammering it only extends the block.
  const interval = ['blocked', 'captcha'].includes(last?.result) ? cfg.BLOCKED_BACKOFF_MIN
    : isDaytime(madridNow().hour) ? cfg.DAY_INTERVAL_MIN : cfg.NIGHT_INTERVAL_MIN;
  const wait = interval * 60000 + (Math.random() * 2 - 1) * cfg.JITTER_SEC * 1000;
  if (Date.now() + wait > deadline) break;
  await sleepUntil(Date.now() + wait);
} while (true);

saveLog();
await browser?.close().catch(() => {});
