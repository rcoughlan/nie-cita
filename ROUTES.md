# Fallback routes

If the monitor hasn't produced a bookable slot after about two weeks, work through these.
Roughly in order of effort. Nothing here involves paying a reseller.

## Getting the monitor a Spanish connection

The portal only answers Spanish IPs, so this comes first.

| Route | Cost | Pros | Cons |
|---|---|---|---|
| **Device at the Barcelona flat** (Pi, old laptop) running `npm run watch:local` | Free / ~£50 | Residential Spanish IP, least likely to be blocked | Needs a device left on there; log push needs a PAT (see README) |
| **Her laptop, on demand** (`npm run check:local`) | Free | Quickest real test of the full flow | Only covers hours it's open |
| **NordVPN Spain on GitHub Actions** (`NORD_USER`/`NORD_PASS` secrets) | Already paid | No hardware, runs 24/7 | VPN IPs are well known and may be blocked as bots; untested |
| **NordVPN app on the Mac → Spain**, run locally | Already paid | Tests whether Nord IPs get through, in 2 minutes | Mac has to be awake; same blocking risk |
| **Spanish VPS** (e.g. a Madrid VPS) as `PROXY_URL` | ~€5/month | Fixed Spanish IP, 24/7 | Datacenter IP; may be blocked |
| **Residential proxy** with Spanish exit | ~€5–15/month (per GB) | Looks like a home connection | Grey-market supply chains; pick a reputable provider or skip |

## Better odds of a slot

- **Whole province: done.** The monitor searches "Cualquier oficina" and alerts on any office
  (Badalona, Granollers, Mataró, Cornellà, Vilanova i la Geltrú, Igualada, Manresa, Vic...), starring
  the nearby ones (`PREFERRED_OFFICES` in `config.mjs`). This is what the UPC guidance recommends:
  any office in the province is valid, and a train ride beats weeks of waiting.
- **Check harder at the measured peak times.** After a week or two, `checks.csv` shows the hours
  slots appear; drop the interval to 1–2 min in those windows only.
- **Book a later date.** The slot she books can be weeks out; what matters is getting one.

## People who can help

- **Her university's international office.** UPC's Students Mobility Office (OMI, Campus Nord) and
  the ESEIAAT international office in Terrassa publish step-by-step instructions for exactly this
  certificate and answer questions. Ask whether they have any police slots or a group session
  for students. Unknown whether they do this year; it's one email.
- **Gestoría or immigration lawyer.** Legit and inexpensive for the paperwork. They can't create
  slots, but some book on clients' behalf all day. Avoid anyone selling a specific slot.
- **060 / in person.** The general government line and the offices themselves rarely give EU
  certificate appointments outside the web system, but it costs a phone call to ask.

## Escalation

- **Email the Subdelegación del Gobierno en Barcelona** (Oficina de Extranjería) explaining that no
  slots have been available for weeks for the EU registration certificate. Keep the screenshots.
- **Complaint to the Síndic de Greuges / Defensor del Pueblo.** Both have taken up the cita previa
  problem before; a complaint occasionally gets an individual appointment and adds pressure.
- **Automatic-appointment pilots.** The Barcelona pilots (L'Hospitalet Jan 2026, fingerprinting from
  Oct 2026) only cover the **TIE for non-EU** residents, not the EU certificate. Worth watching in
  case they're extended, but they don't help her today.

## Other provinces

The certificate is only issued in the province where she lives, so booking in Tarragona or Girona
isn't an option for this one (it was for a plain NIE assignment for non-residents).
