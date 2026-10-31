// Alert-only cita monitor. Walks the portal up to the office list and stops there:
// it never books, never solves captchas, and never submits contact details.
//
//   node monitor.mjs           one check
//   node monitor.mjs --loop    keep checking for LOOP_MINUTES (default 345)
//
// Env: NIE_PASSPORT, NIE_NAME (required), NIE_COUNTRY (default IRLANDA), NTFY_TOPIC,
//      DATA_DIR (where checks.csv lives; pushed with git when set), PROXY_URL (optional).

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as cfg from './config.mjs';

const env = process.env;
const DATA_DIR = env.DATA_DIR || '.';
const LOG = path.join(DATA_DIR, 'checks.csv');
const RUNNER = env.RUNNER_NAME ? 'gha' : (env.MONITOR_HOST || 'local');

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
  const clean = offices.map(o => o.replace(/[,\n]/g, ' ').trim()).join(' | ');
  fs.appendFileSync(LOG, [new Date().toISOString(), madridNow().stamp, result, clean, RUNNER].join(',') + '\n');
  console.log(`${madridNow().stamp} ${result}${clean ? ' ' + clean : ''}`);
}

function saveLog() {
  if (!env.DATA_DIR) return;
  try {
    execFileSync('/bin/bash', [path.resolve('scripts/save-log.sh'), DATA_DIR], { stdio: 'inherit' });
  } catch (e) {
    console.log('save-log failed:', e.message);
  }
}

// ---- notifications ----

async function notify(title, message, { priority = 'default', tags = '', click } = {}) {
  if (!env.NTFY_TOPIC) return console.log(`[no NTFY_TOPIC] ${title}: ${message}`);
  const headers = { Title: title, Priority: priority, Tags: tags };
  if (click) headers.Click = click;
  try {
    await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, { method: 'POST', body: message, headers });
  } catch (e) {
    console.log('ntfy failed:', e.message);
  }
}

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

  try {
    await page.goto(cfg.PROVINCE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(2500, 5000);
    await page.goto(cfg.TRAMITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pause(2000, 4000);

    let text = await body();
    if (looksBlocked(text)) return { result: 'blocked' };
    if (!/INTERNET CITA PREVIA/i.test(text)) return { result: 'error', note: 'landing page not recognised' };

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
    if (/net::|page\.goto: Timeout/i.test(msg)) return { result: 'blocked', note: msg.split('\n')[0] };
    return { result: 'error', note: msg.split('\n')[0] };
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
      await notify('NIE cita available - book now', `Offices with slots:\n${accepted.join('\n')}\n\nTrámite: ${cfg.TRAMITE_LABEL}\nTap to open the portal.`,
        { priority: 'urgent', tags: 'rotating_light', click: cfg.PROVINCE_URL });
    }
    return;
  }

  appendLog(outcome.result, outcome.note ? [outcome.note] : []);
  const bad = ['blocked', 'captcha'];
  if (bad.includes(outcome.result) && !bad.includes(prev)) {
    await notify('NIE monitor blocked', `The portal returned "${outcome.result}" from ${RUNNER}. Checks continue; you'll hear when it recovers.`, { priority: 'high', tags: 'warning' });
  } else if (!bad.includes(outcome.result) && outcome.result !== 'error' && bad.includes(prev)) {
    await notify('NIE monitor recovered', `Portal reachable again from ${RUNNER}.`, { tags: 'white_check_mark' });
  }
}

async function maybeHeartbeat() {
  const now = madridNow();
  if (now.hour !== cfg.HEARTBEAT_HOUR) return;
  const today = readLog().filter(r => r.ts_madrid?.startsWith(now.date));
  if (today.some(r => r.result === 'heartbeat')) return;
  const count = k => today.filter(r => r.result === k).length;
  const checks = today.filter(r => r.result !== 'heartbeat').length;
  await notify('NIE monitor: still running',
    `Today: ${checks} checks, ${count('slots')} with slots, ${count('none')} empty, ${count('blocked') + count('captcha')} blocked, ${count('error')} errors.`,
    { priority: 'low', tags: 'heartbeat' });
  appendLog('heartbeat');
}

// ---- main ----

if (!env.NIE_PASSPORT || !env.NIE_NAME) {
  console.error('NIE_PASSPORT and NIE_NAME must be set');
  process.exit(1);
}

const launchOpts = { headless: true };
if (env.PROXY_URL) launchOpts.proxy = { server: env.PROXY_URL };
const browser = await chromium.launch(launchOpts);
const loop = process.argv.includes('--loop');
const deadline = Date.now() + Number(env.LOOP_MINUTES || 345) * 60000;
let sinceSave = 0;

do {
  await handle(await check(browser));
  await maybeHeartbeat();
  if (++sinceSave >= 10 || !loop) { saveLog(); sinceSave = 0; }
  if (!loop) break;

  const interval = isDaytime(madridNow().hour) ? cfg.DAY_INTERVAL_MIN : cfg.NIGHT_INTERVAL_MIN;
  const wait = interval * 60000 + (Math.random() * 2 - 1) * cfg.JITTER_SEC * 1000;
  if (Date.now() + wait > deadline) break;
  await sleep(wait);
} while (true);

saveLog();
await browser.close();
