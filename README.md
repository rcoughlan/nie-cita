# nie-cita

> **Status: dormant (paused 31 Oct 2026).** All workflows are disabled, all repo secrets and the local
> `.env` are deleted, and nothing is scheduled. To pick it up again, see **Resuming** below.
>
> Where it got to: the portal only accepts Spanish IPs (NordVPN Spain works); its FortiGate firewall
> blocks headless Chrome, so it must run headed; its F5 bot defence blocked the browser's cookies after
> ~5 sessions in 20 minutes (a fresh incognito session got through). The steps after "Entrar" haven't
> been confirmed live yet. No captcha appeared when booking by hand.
>
> **Resuming:** re-enable the `watchdog` workflow (and `monitor` only if running on Actions), re-add the
> `NTFY_TOPIC` / `NTFY_ADMIN_TOPIC` secrets (pick new random topics), recreate `.env` from `.env.example`,
> turn on Nord Spain, run one `npm run check:local`, then `scripts/mac-install.sh` if it reaches a result.

Alert-only monitor for Barcelona-province appointments for the **EU registration certificate**
(*POLICÍA-CERTIFICADO DE REGISTRO DE CIUDADANO DE LA U.E.*, which includes the NIE).

It walks the official portal the way a person does (province → "Cualquier oficina" → trámite →
Entrar → Presentación sin Cl@ve → passport details → Solicitar Cita), stops at the result, reads
which offices have free slots, and sends a push notification. It **never books**, never solves captchas and never
submits contact details: the booking itself is done by a person, on the official site, for free.

## Status

The portal only accepts connections from Spanish IPs, and its firewall (FortiGate "Intrusion
Prevention") blocks headless Chrome, on GitHub Actions and on the Mac alike (31 Oct 2026). A normal
headed Chrome gets through. We don't try to get around that firewall, so it runs on a real machine
in a normal Chrome window (minimised, so it doesn't get in the way):

1. **Ryan's Mac with the NordVPN app on a Spain server** (now): see "Run on Mac".
2. **A Raspberry Pi** (later): see "Move to Pi". Best of all at the flat in Barcelona, on its home connection.

The GitHub `monitor` workflow stays off (`MONITOR_ENABLED` unset); the `watchdog` workflow keeps
watching the log the Mac/Pi pushes.

If none of it works after a couple of weeks, see [ROUTES.md](ROUTES.md).

Once she's booked, or by 31 Jan 2027 at the latest, take it all down: see [TEARDOWN.md](TEARDOWN.md).

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

- **Shared topic** (`NTFY_TOPIC`, both phones): only **NIE cita available - book now**, listing
  the offices with slots, nearby ones starred (urgent if a nearby one has slots, high otherwise). Daytime only (07:00–01:00 Madrid). Allow it to break
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

1. Open the alert, or go to https://icp.administracionelectronica.gob.es/icpplus/index.html → **Barcelona** → Aceptar.
2. Office: **Cualquier oficina**. Trámite: **POLICÍA-CERTIFICADO DE REGISTRO DE CIUDADANO DE LA U.E.** → Aceptar → Entrar.
3. **Presentación sin Cl@ve** → **Pasaporte**, passport number, full name exactly as in the passport, **IRLANDA** → Aceptar → Solicitar Cita.
   Don't use the browser's back button; if it errors, start again from step 1.
4. Choose the office from the alert → Siguiente.
5. Phone number and email → Siguiente.
6. Pick a date/time, solve the captcha if shown, then enter the **SMS code** sent to the phone.
7. Save the confirmation (*justificante*) as a PDF.

It searches every office in the province ("Cualquier oficina"): any of them is valid. Nearby ones
are starred in the alert (`PREFERRED_OFFICES` in `config.mjs`): Barcelona city (Mallorca 213,
Passeig Sant Joan 189, Rambla Guipúscoa 74, Guadalajara 1), Terrassa, Sabadell, Sant Cugat, Rubí.

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
category; no personal data). Outcomes: `none`, `slots` (incl. a nearby office), `slots_other` (only
offices further away), `blocked` (incl. the FortiGate firewall page), `captcha`, `error`, and `no-vpn` / `offline`
when the machine wasn't on a Spanish IP (or had no internet), so the portal wasn't touched. Use it to see when slots appear and tighten the schedule.

## Setup

Secrets (`gh secret set NAME`): `NIE_PASSPORT`, `NIE_NAME` (as in passport), `NIE_COUNTRY`
(optional, default `IRLANDA`), `NTFY_TOPIC`, `NTFY_ADMIN_TOPIC`, `PROXY_URL` / `NORD_USER` +
`NORD_PASS` (optional).

Manual single check: Actions → monitor → Run workflow (minutes `0`).
Admin alert test: Actions → watchdog → Run workflow (mode `test`).

Schedule (all runners): every ~10 min (±2 min) from 07:00 to 01:00 Madrid time, every ~20 min
overnight (logged, no alerts), and 60 min after any block or captcha. The portal's F5 bot defence
started rejecting a normal headed Chrome after ~5 full sessions in ~20 minutes, so don't go faster.
On Actions a run starts every 6 hours and loops for ~5h45m. Timings live in `config.mjs`.

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

**Result (31 Oct 2026):** Nord connected (egress ES), but the portal's FortiGate firewall returned
403 "Intrusion Prevention" for the headless browser on Actions (run 41198512967). The same happens
headless on the Mac through the Nord app, while headed Chrome gets through, so it's headless
detection, not the IP. We don't work around that, so this path is parked; see "Run on Mac".

## How it behaves on a Mac or Pi

- A normal **headed Chrome window** (installed Google Chrome; Playwright's Chromium if Chrome
  isn't there), **minimised** right after launch (`MINIMISED=0` to watch it). One window, reused for
  every check and left on a blank page in between, so nothing pops up between checks; Chrome may
  take focus once when the monitor starts. No user agent spoofing or anti-detection tricks.
- Captchas: none seen on the way to the form (31 Oct 2026); the portal uses invisible F5 bot
  checks a normal browser passes. If an interactive challenge (checkbox, image grid, picture
  captcha) ever shows, the check stops, logs `captcha` and alerts the admin topic. It's never solved.
- Before each check it looks up the machine's public country (ipinfo.io, then ip-api.com). Not
  Spain: it logs `no-vpn` and doesn't touch the portal. Still not Spain after an hour in the daytime:
  one alert to the admin topic, and another when it's back.
- After sleep it simply resumes: one check on wake, then the normal schedule. No catch-up burst.
- After `TEARDOWN_DATE` it exits cleanly and stays stopped.

## Run on Mac

```
cd ~/development/nie-cita
cp .env.example .env    # fill in passport, name, both ntfy topics; MONITOR_HOST=mac
npm run check:local     # one check (minimised Chrome window; NordVPN on a Spain server first)
```

When that single check reports `none` or `slots`, install it as a LaunchAgent so it runs all the
time and restarts after crashes and reboots:

```
/bin/bash scripts/mac-install.sh      # installs + starts; log in ~/Library/Logs/nie-cita.log
/bin/bash scripts/mac-uninstall.sh    # stops + removes
```

The installer clones the `data` branch into `data/` and points that checkout at the gh CLI's
GitHub login (`scripts/mac-data-auth.sh`, local to that checkout), so the log is pushed and the
GitHub watchdog sees it. No token needed on the Mac.

**Keeping the Mac awake.** The LaunchAgent runs under `caffeinate -s`, which keeps the Mac awake
while it's on **mains power** (the display can still sleep). On battery, or with the lid closed and
no external display, macOS sleeps anyway and checks pause until it wakes. Alternatives:
`sudo pmset -c sleep 0` (never sleep on charger, system-wide; undo with `sudo pmset -c sleep 1`), or
just leave it plugged in with the lid open.

**NordVPN.** Keep the app connected to a Spain server (Barcelona or Madrid). Everything on the Mac
goes through Spain while it's on. If you turn it off the monitor just pauses (`no-vpn`). Nord's
split tunnelling, if your app version has it, can't help here: it's Chrome that needs the Spanish IP.

## Move to Pi

1. Raspberry Pi OS **with desktop** (the browser needs a screen session; a monitor isn't needed
   once it's set to log in automatically: `sudo raspi-config` → System → Boot / Auto login → Desktop autologin).
2. `sudo apt install -y git chromium` and Node 22 (e.g. via fnm or NodeSource).
3. `git clone https://github.com/rcoughlan/nie-cita && cd nie-cita && npm ci && npx playwright install chromium`
   (on ARM, Google Chrome isn't available; it falls back to Chromium).
4. `cp .env.example .env`, fill it in, set `MONITOR_HOST=pi` and `DATA_DIR=data`.
5. Push access to the `data` branch for the watchdog: github.com → Settings → Developer settings →
   **Fine-grained tokens** → only the `nie-cita` repo, **Contents: Read and write**, 90-day expiry.
   Then `git clone -b data https://x-access-token:TOKEN@github.com/rcoughlan/nie-cita.git data`.
6. Network: at the Barcelona flat its home connection is already Spanish, nothing else needed.
   Anywhere else, install the NordVPN Linux app and `nordvpn connect Spain`, with `nordvpn set autoconnect on Spain`.
7. A systemd user service, `~/.config/systemd/user/nie-cita.service`:

   ```
   [Unit]
   Description=nie-cita monitor
   After=graphical-session.target network-online.target

   [Service]
   WorkingDirectory=%h/nie-cita
   Environment=LOOP_MINUTES=forever DISPLAY=:0
   ExecStart=/usr/bin/env node --env-file=.env monitor.mjs --loop
   Restart=on-failure
   RestartSec=60

   [Install]
   WantedBy=default.target
   ```

   Then `systemctl --user enable --now nie-cita` and `sudo loginctl enable-linger $USER`.
   `Restart=on-failure` keeps it stopped after the teardown date (a clean exit).
8. Uninstall the Mac LaunchAgent once the Pi is running, so both don't check at once.
