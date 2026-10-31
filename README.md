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
   flat in Barcelona, running `node monitor.mjs --loop` (see "Running elsewhere").
2. **A Spanish proxy for GitHub Actions**: set a `PROXY_URL` secret (e.g. `http://user:pass@host:port`),
   then turn the schedule on with `gh variable set MONITOR_ENABLED --body true`.

## Notifications (ntfy)

1. Install the **ntfy** app (iOS/Android) on both phones.
2. Subscribe to the topic stored in the `NTFY_TOPIC` secret (server `ntfy.sh`). Anyone with the
   topic name can read the alerts, so keep it private. Alerts never contain personal data.
3. For the "cita available" alert, allow the app to break through Do Not Disturb.

Alerts you'll get:
- **NIE cita available - book now** (urgent): lists the accepted offices with slots. Daytime only (07:00–01:00 Madrid).
- **NIE monitor blocked / recovered**: sent once when the portal starts or stops blocking.
- **Still running** (low priority): daily at 21:00 with that day's counts.

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

Every check is appended to `checks.csv` on the `data` branch (time, outcome, office names; no personal
data). Outcomes: `none`, `slots` (accepted office), `slots_other` (other offices only), `blocked`,
`captcha`, `error`, `heartbeat`. After a week, use it to see when slots appear and tighten the schedule.

## Setup

Secrets (`gh secret set NAME`): `NIE_PASSPORT`, `NIE_NAME` (as in passport), `NIE_COUNTRY`
(optional, default `IRLANDA`), `NTFY_TOPIC`, `PROXY_URL` (optional).

Manual single check: Actions → monitor → Run workflow (minutes `0`).

Schedule: every 6 hours a run starts and loops for ~5h45m: every ~4 min (±1 min) from 07:00 to
01:00 Madrid time, every 15 min overnight (logged, no alerts). Timings live in `config.mjs`.

## Running elsewhere (Pi / laptop)

```
git clone https://github.com/rcoughlan/nie-cita && cd nie-cita
npm ci && npx playwright install --with-deps chromium
git worktree add data data
NIE_PASSPORT=... NIE_NAME="..." NTFY_TOPIC=... DATA_DIR=data MONITOR_HOST=pi node monitor.mjs --loop
```

Run it under systemd or cron with `LOOP_MINUTES` set, so it restarts after reboots.
