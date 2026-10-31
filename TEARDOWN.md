# Teardown

This repo holds secrets for one appointment. Take it down **as soon as she's booked**, or on
**31 Jan 2027** at the latest, whichever comes first.

## Triggers

- **Booked:** Ryan tells Claude "booked". Claude walks through the checklist below, with
  Ryan's go-ahead at that time.
- **Deadline:** `TEARDOWN_DATE` in `config.mjs` (default `2027-01-31`). From that date the monitor
  and watchdog exit without touching the portal. The watchdog sends Ryan's admin topic one
  reminder 7 days before and one on the day.

## Checklist

1. Stop the schedule: `gh variable set MONITOR_ENABLED --body false -R rcoughlan/nie-cita`
2. Disable both workflows: `gh workflow disable monitor.yml -R rcoughlan/nie-cita` and
   `gh workflow disable watchdog.yml -R rcoughlan/nie-cita`
3. Delete every repo secret: `NIE_PASSPORT`, `NIE_NAME`, `NORD_USER`, `NORD_PASS`, `NTFY_TOPIC`,
   `NTFY_ADMIN_TOPIC`, and `PROXY_URL` if set (`gh secret delete <NAME> -R rcoughlan/nie-cita`).
4. Make the repo private, or archive it (Settings → General → Danger Zone).
5. Revoke the fine-grained PAT if one was created for a Pi/laptop (GitHub → Settings →
   Developer settings → Fine-grained tokens).
6. Reset the Nord service credentials (my.nordaccount.com → NordVPN → Set up NordVPN manually).
7. Delete the local `.env` on every machine that ran the monitor (Mac, Pi, her laptop).
8. Unsubscribe both ntfy topics on both phones. ntfy.sh topics can't be deleted; messages expire
   on their own.
