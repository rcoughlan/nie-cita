# nie-cita

Alert-only monitor for Barcelona-province appointments for the **EU registration certificate**
(*POLICÍA-CERTIFICADO DE REGISTRO DE CIUDADANO DE LA U.E.*, which includes the NIE).

It walks the official portal up to the "choose an office" step, reads which offices have free
slots, and sends a push notification. It **never books**, never solves captchas and never
submits contact details: the booking itself is done by a person, on the official site, for free.

## Status

The portal only accepts connections from Spanish IPs. GitHub's runners (US, Azure) and UK home
connections time out or get reset. So the scheduled run is off by default, and it needs one of these:

1. **A machine on a Spanish home connection** (recommended): a Raspberry Pi or spare laptop at the
   flat in Barcelona (see "Running elsewhere").
2. **NordVPN Spain on GitHub Actions**: see "NordVPN" below.
3. **A Spanish proxy for GitHub Actions**: set a `PROXY_URL` secret (e.g. `http://user:pass@host:port`),
   then turn the schedule on with `gh variable set MONITOR_ENABLED --body true`.

If none of it works after a couple of weeks, see [ROUTES.md](ROUTES.md).

## Privacy

The passport number and name live only in Actions secrets (or a local, gitignored `.env`). They are
typed into the portal form and nowhere else: errors are reduced to a fixed category, anything
printed is scrubbed of both values (any case, any word of the name), and no screenshots or traces
are taken. The monitor stops at the office list, before the phone/email step, so no phone number
or email is ever entered. The public parts (code, `checks.csv`, Actions logs, ntfy messages) hold
only times, outcomes and office names.

## Notifications (ntfy)

Two topics on `ntfy.sh`. Anyone with a topic name can read it, so keep both private; neither ever
carries personal data.

- **Shared topic** (`NTFY_TOPIC`, both phones): only **NIE cita available - book now** (urgent),
  listing the accepted offices with slots. Daytime only (07:00–01:00 Madrid). Allow it to break
  through Do Not Disturb.
- **Admin topic** (`NTFY_ADMIN_TOPIC`, Ryan only): monitor blocked/recovered, 5 errors in a row,
  Actions run failed, and from the watchdog: no successful check for 6h (repeated daily while down),
  a daily health note only when something's wrong, and a two-week review with the stats.

The **watchdog** workflow runs every 3 hours on GitHub, reading `checks.csv` from the `data` branch,
so it notices if a Pi in Barcelona dies, as long as that Pi pushes its log (see below). It stays
quiet until the monitor has had its first successful check or `MONITOR_ENABLED` is on. The review
is sent 14 days after the first successful check (override with the `REVIEW_DATE` repo variable).

## Booking checklist (when the alert fires)

Slots go within minutes. Have this ready:

1. Open the alert, or go to https://icp.administracionelectronica.gob.es/icpplustieb/citar?p=8 (Barcelona).
2. Trámite: **POLICÍA-CERTIFICADO DE REGISTRO DE CIUDADANO DE LA U.E.** → Aceptar → Entrar.
3. Document: **Pasaporte**, passport number, full name exactly as in the passport → Aceptar → Solicitar Cita.
4. Choose the office from the alert → Siguiente.
5. Phone number and email → Siguiente.
6. Pick a date/time, solve the captcha if shown, then enter the **SMS code** sent to the phone.
7. Save the confirmation (*justificante*) as a PDF.

Accepted offices (edit `config.mjs` to change): Barcelona city (Rambla Guipúscoa 74, Mallorca 213,
Murcia 42, Passeig Sant Joan 189), Terrassa, Sabadell, Sant Cugat, Rubí, L'Hospitalet.

## What to bring to the appointment

Confirm with the university's international office (or the Policía Nacional site), as
requirements change. Typically, for an EU student:

- Form **EX-18**, filled in and signed (original + copy)
- Passport (original + copy)
- Proof of enrolment at the university
- Health insurance (public or private with full cover in Spain, e.g. a European Health Insurance Card valid for the stay)
- Signed declaration of sufficient funds
- *Empadronamiento* or rental contract
- Fee **Modelo 790 código 012** (option "Certificado de registro de residente comunitario"), paid at a bank before the appointment

## Check log

Every check is appended to `checks.csv` on the `data` branch (time, outcome, office names or an error
category; no personal data). Outcomes: `none`, `slots` (accepted office), `slots_other` (other offices
only), `blocked`, `captcha`, `error`. Use it to see when slots appear and tighten the schedule.

## Setup

Secrets (`gh secret set NAME`): `NIE_PASSPORT`, `NIE_NAME` (as in passport), `NIE_COUNTRY`
(optional, default `IRLANDA`), `NTFY_TOPIC`, `NTFY_ADMIN_TOPIC`, `PROXY_URL` / `NORD_USER` +
`NORD_PASS` (optional).

Manual single check: Actions → monitor → Run workflow (minutes `0`).
Admin alert test: Actions → watchdog → Run workflow (mode `test`).

Schedule: every 6 hours a run starts and loops for ~5h45m: every ~4 min (±1 min) from 07:00 to
01:00 Madrid time, every 15 min overnight (logged, no alerts). Timings live in `config.mjs`.

## NordVPN

NordVPN's SOCKS5 proxies don't have Spanish locations, so this uses OpenVPN to a Nord server in
Spain. It needs the **service credentials**, not the account login:

1. Log in at my.nordaccount.com → NordVPN → **Set up NordVPN manually** (verify the email code).
2. Copy the **Service credentials** username and password.
3. `gh secret set NORD_USER -R rcoughlan/nie-cita` and `gh secret set NORD_PASS -R rcoughlan/nie-cita`
   (paste each when prompted).
4. Test once: Actions → monitor → Run workflow. The "Connect NordVPN (Spain)" step logs the egress
   country, and the Check step shows `none` / `slots` if the portal let it through, or `blocked`.
5. If it works: `gh variable set MONITOR_ENABLED --body true -R rcoughlan/nie-cita`.

Nord's IPs are well known, so the portal may treat them like any datacenter. Only a test tells.
Even quicker test: connect the NordVPN Mac app to Spain and run `npm run check:local` (below).

## Running locally / elsewhere (Mac, Pi, laptop)

```
git clone https://github.com/rcoughlan/nie-cita && cd nie-cita
npm ci && npx playwright install --with-deps chromium
cp .env.example .env    # fill in the values; .env is gitignored
npm run check:local     # one check (add HEADED=1 to .env to watch the browser)
npm run watch:local     # keep checking for LOOP_MINUTES (default 345)
```

So the watchdog can see a Pi's log, give it push access to the `data` branch:

1. github.com → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** →
   Generate new token. Repository access: **Only select repositories** → `nie-cita`.
   Permissions: **Contents: Read and write**. Expiry: 90 days.
2. On the Pi, in the repo: `git clone -b data https://x-access-token:TOKEN@github.com/rcoughlan/nie-cita.git data`
   (replace TOKEN), then set `DATA_DIR=data` and `MONITOR_HOST=pi` in `.env`.

Run `watch:local` under systemd (or cron every 6 hours with `LOOP_MINUTES=345`) so it restarts after reboots.
