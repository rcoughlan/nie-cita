// Watchdog: reads checks.csv from the data branch and pings Ryan's admin topic when things
// go wrong. Runs on GitHub Actions, so it works wherever the monitor itself runs (as long as
// that machine pushes its log). No Playwright, no personal data.
//
//   node watchdog.mjs data/checks.csv
//
// Env: NTFY_ADMIN_TOPIC, MONITOR_ENABLED, MODE (auto | daily | review | test),
//      REVIEW_DATE (YYYY-MM-DD; default 14 days after the first successful check).

import fs from 'node:fs';
import { TEARDOWN_DATE } from './config.mjs';

const env = process.env;
const file = process.argv[2] || 'data/checks.csv';
const MODE = env.MODE || 'auto';
const STALE_HOURS = 6;
const DAILY_UTC_HOUR = 9;
const OK = ['none', 'slots', 'slots_other'];

const rows = fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').trim().split('\n').slice(1).filter(Boolean).map(line => {
      const [ts_utc, ts_madrid, result, offices, runner] = line.split(',');
      return { t: new Date(ts_utc), ts_madrid, result, offices, runner };
    }).filter(r => r.result !== 'heartbeat' && !isNaN(r.t))
  : [];

const now = new Date();
const hoursAgo = d => (now - d) / 3600000;
const count = (list, ...k) => list.filter(r => k.includes(r.result)).length;

async function notify(title, message, priority = 'default') {
  console.log(`${title}: ${message}`);
  if (!env.NTFY_ADMIN_TOPIC) return;
  await fetch(`https://ntfy.sh/${env.NTFY_ADMIN_TOPIC}`, {
    method: 'POST', body: message, headers: { Title: title, Priority: priority, Tags: 'robot' },
  });
}

if (MODE === 'test') {
  await notify('NIE watchdog test', 'Admin alerts reach this phone. Only you get these; slot alerts go to the shared topic.');
  process.exit(0);
}

// Teardown: one reminder 7 days before, one on the day (both at the daily hour), then silence.
const today = now.toISOString().slice(0, 10);
const weekBefore = new Date(Date.parse(TEARDOWN_DATE) - 7 * 86400000).toISOString().slice(0, 10);
const atDailyHour = now.getUTCHours() === DAILY_UTC_HOUR;
if (today === weekBefore && atDailyHour) {
  await notify('NIE monitor: teardown in 7 days', `The monitor stops on ${TEARDOWN_DATE}. If she's booked already, tell Claude "booked" to tear it down now. See TEARDOWN.md.`);
}
if (today >= TEARDOWN_DATE) {
  if (today === TEARDOWN_DATE && atDailyHour) {
    await notify('NIE monitor: deadline reached - run teardown', 'The monitor has stopped. Tell Claude to run the TEARDOWN.md checklist (delete secrets, make the repo private, reset Nord credentials).', 'high');
  }
  console.log(`Teardown date ${TEARDOWN_DATE} reached: watchdog idle.`);
  process.exit(0);
}

const successes = rows.filter(r => OK.includes(r.result));
const firstSuccess = successes[0]?.t;
const lastSuccess = successes.at(-1)?.t;
const active = env.MONITOR_ENABLED === 'true' || Boolean(firstSuccess);
if (!active && MODE === 'auto') {
  console.log('Monitor not running yet (no successful check, MONITOR_ENABLED off): nothing to watch.');
  process.exit(0);
}

const dailyRun = MODE === 'daily' || now.getUTCHours() === DAILY_UTC_HOUR;
const reviewDate = env.REVIEW_DATE
  || (firstSuccess ? new Date(firstSuccess.getTime() + 14 * 86400000).toISOString().slice(0, 10) : '');
const reviewRun = MODE === 'review' || (dailyRun && now.toISOString().slice(0, 10) === reviewDate);

// 1. Dead man: no successful check for a while. Alert when it first crosses the threshold
//    (this job runs every 3h), then once a day while it stays down.
const gap = lastSuccess ? hoursAgo(lastSuccess) : Infinity;
if (gap >= STALE_HOURS && (gap < STALE_HOURS + 3 || dailyRun)) {
  const last = rows.at(-1);
  const detail = last ? `Last log entry ${Math.round(hoursAgo(last.t))}h ago: ${last.result} from ${last.runner}.` : 'The log is empty.';
  await notify('NIE monitor: no successful checks',
    `${lastSuccess ? `Last successful check ${Math.round(gap)}h ago.` : 'No successful check yet.'} ${detail}\n`
    + 'If the last entry is old, the machine running it has stopped or can\'t push its log.', 'high');
}

// 2. Daily health, only when something is wrong.
if (dailyRun && !reviewRun) {
  const day = rows.filter(r => hoursAgo(r.t) <= 24);
  const blocked = count(day, 'blocked', 'captcha');
  const errors = count(day, 'error');
  const problems = [];
  if (day.length && blocked / day.length > 0.5) problems.push(`${blocked} of ${day.length} checks blocked`);
  if (errors >= 10) problems.push(`${errors} errors`);
  if (problems.length) {
    await notify('NIE monitor: daily health', `Last 24h: ${day.length} checks, ${count(day, ...OK)} OK, ${problems.join(', ')}.`);
  }
}

// 3. Two-week review.
if (reviewRun) {
  const since = firstSuccess || rows[0]?.t || now;
  const period = rows.filter(r => r.t >= since);
  const slotRows = period.filter(r => r.result === 'slots');
  const hours = {};
  for (const r of slotRows) { const h = (r.ts_madrid || '').slice(11, 13); hours[h] = (hours[h] || 0) + 1; }
  const peak = Object.entries(hours).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h, n]) => `${h}:00 (${n})`).join(', ');
  const blocked = count(period, 'blocked', 'captcha');
  const working = slotRows.length > 0 && blocked / Math.max(period.length, 1) < 0.5;
  await notify('NIE monitor: 2-week review',
    `${period.length} checks since ${since.toISOString().slice(0, 10)}: ${slotRows.length} saw slots at accepted offices, `
    + `${count(period, 'slots_other')} only elsewhere, ${count(period, 'none')} empty, ${blocked} blocked, ${count(period, 'error')} errors.`
    + (peak ? `\nSlots seen most at (Madrid): ${peak}.` : '')
    + (working ? '' : '\nNot working well enough: see ROUTES.md in the repo for the fallback options.'),
    working ? 'default' : 'high');
}
