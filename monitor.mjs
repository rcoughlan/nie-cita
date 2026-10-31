// Alert-only cita monitor. Walks the portal up to the office list and stops there:
// it never books, never solves captchas, and never reaches the phone/email step.
//
//   node monitor.mjs           one check
//   node monitor.mjs --loop    keep checking for LOOP_MINUTES (default 345)
//   node --env-file=.env monitor.mjs   local run with secrets in a gitignored .env
//
// Env: NIE_PASSPORT, NIE_NAME (required), NIE_COUNTRY (default IRLANDA),
//      NTFY_TOPIC (shared: slot alerts only), NTFY_ADMIN_TOPIC (Ryan only: blocks, errors),
//      DATA_DIR (where checks.csv lives; pushed with git when set), PROXY_URL (optional),
//      MONITOR_HOST (label in the log, e.g. pi), HEADED=1 (show the browser locally).
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

// ---- one check ----

async function check(browser) {
  const context = await browser.newContext({
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));
  const body = async () => (await page.locator('body').innerText({ timeout: 15000 }).catch(() => '')) || '';
  const looksBlocked = t => /requested url was rejected|request rejected|access denied|support id/i.test(t);

  // Landing-page diagnostics. Only ever called before any personal data is typed, so the
  // page can't contain it; still scrubbed. Printed to the console only, never to checks.csv.
  const diagnose = async (label, response) => {
    const text = (await body()).replace(/\s+/g, ' ').trim();
    const html = await page.content().catch(() => '');
    const markers = {
      waf: looksBlocked(text),
      captcha: /captcha|recaptcha|hcaptcha/i.test(html),
      cookieBanner: /cookie/i.test(text),
    };
    console.log(scrub(`diagnostic (${label}): status=${response?.status() ?? 'n/a'} url=${page.url()} `
      + `title="${await page.title().catch(() => '')}" markers=${JSON.stringify(markers)}`));
    console.log(scrub(`diagnostic text: ${text.slice(0, 300)}`));
  };

  try {
    const provinceRes = await page.goto(cfg.PROVINCE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(2500, 5000);
    const tramiteRes = await page.goto(cfg.TRAMITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(2000, 4000);

    let text = await body();
    if (looksBlocked(text)) { await diagnose('landing blocked', tramiteRes); return { result: 'blocked' }; }
    if (!/INTERNET CITA PREVIA/i.test(text)) {
      await diagnose('landing', tramiteRes);
      console.log(`diagnostic province page status=${provinceRes?.status() ?? 'n/a'}`);
      return { result: 'error', note: 'landing page not recognised' };
    }

    await page.click('#btnEntrar');
    await page.waitForSelector('#txtIdCitado', { timeout: 30000 });
    await pause(1500, 3000);

    await page.check('#rdbTipoDocPas').catch(() => {});
    await page.fill('#txtIdCitado', env.NIE_PASSPORT);
    await pause(400, 1200);
    await page.fill('#txtDesCitado', env.NIE_NAME);
    if (await page.locator('#txtPaisNac').count()) {
      const country = (env.NIE_COUNTRY || 'IRLANDA').toUpperCase();
      const value = await page.locator('#txtPaisNac option').evaluateAll(
        (opts, c) => opts.find(o => o.textContent.trim().toUpperCase() === c)?.value, country);
      if (value) await page.selectOption('#txtPaisNac', value);
    }
    if (await page.locator('img.img-thumbnail, #captcha').count()) return { result: 'captcha' };
    await pause(1000, 2500);

    await page.click('#btnEnviar');
    await page.waitForSelector('#btnConsultar', { timeout: 30000 }).catch(() => {});
    text = await body();
    if (looksBlocked(text)) return { result: 'blocked' };
    if (!(await page.locator('#btnConsultar').count())) return { result: 'error', note: 'request page not reached' };
    await pause(1000, 2500);

    await page.click('#btnConsultar');
    await page.waitForLoadState('domcontentloaded');
    await pause(1500, 3000);
    text = await body();

    if (/no hay citas disponibles/i.test(text)) return { result: 'none' };
    if (/Seleccione la oficina/i.test(text)) {
      // Stop here. Offices listed in this dropdown are the ones with free slots right now.
      const offices = await page.locator('#idSede option').evaluateAll(
        opts => opts.filter(o => o.value).map(o => o.textContent.trim()));
      return { result: 'slots', offices };
    }
    if (looksBlocked(text)) return { result: 'blocked' };
    if (/captcha/i.test(text)) return { result: 'captcha' };
    return { result: 'error', note: 'unexpected page after Solicitar Cita' };
  } catch (e) {
    const msg = String(e.message || e);
    if (!env.CI) console.log('debug:', scrub(msg.split('\n')[0]));
    const category = errorCategory(msg);
    return { result: ['timeout', 'network'].includes(category) ? 'blocked' : 'error', note: category };
  } finally {
    await context.close().catch(() => {});
  }
}

// ---- handle outcome: alerts on change only, so nothing spams ----

async function handle(outcome) {
  const now = madridNow();
  const day = isDaytime(now.hour);
  const prev = readLog().filter(r => r.result !== 'heartbeat').at(-1)?.result;

  if (outcome.result === 'slots') {
    const accepted = outcome.offices.filter(o => cfg.ACCEPTED_OFFICES.some(re => re.test(o)));
    appendLog(accepted.length ? 'slots' : 'slots_other', outcome.offices);
    if (accepted.length && day) {
      await notifyShared('NIE cita available - book now', `Offices with slots:\n${accepted.join('\n')}\n\nTrámite: ${cfg.TRAMITE_LABEL}\nTap to open the portal.`,
        { priority: 'urgent', tags: 'rotating_light', click: cfg.PROVINCE_URL });
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
    const recent = readLog().slice(-ERROR_STREAK_ALERT);
    if (recent.length === ERROR_STREAK_ALERT && recent.every(r => r.result === 'error')
      && readLog().at(-ERROR_STREAK_ALERT - 1)?.result !== 'error') {
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

const launchOpts = { headless: !env.HEADED };
if (env.PROXY_URL) launchOpts.proxy = { server: env.PROXY_URL };
const browser = await chromium.launch(launchOpts);
const loop = process.argv.includes('--loop');
const deadline = Date.now() + Number(env.LOOP_MINUTES || 345) * 60000;
let sinceSave = 0;

do {
  await handle(await check(browser));
  if (++sinceSave >= 10 || !loop) { saveLog(); sinceSave = 0; }
  if (!loop || pastTeardown()) break;

  const interval = isDaytime(madridNow().hour) ? cfg.DAY_INTERVAL_MIN : cfg.NIGHT_INTERVAL_MIN;
  const wait = interval * 60000 + (Math.random() * 2 - 1) * cfg.JITTER_SEC * 1000;
  if (Date.now() + wait > deadline) break;
  await sleep(wait);
} while (true);

saveLog();
await browser.close();
