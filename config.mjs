// What to watch for. Personal data never lives here: it comes from env vars (Actions secrets).

export const PORTAL = process.env.PORTAL_BASE || 'https://icp.administracionelectronica.gob.es';

// The flow starts where a person starts: the province picker. Barcelona uses the "icpplustieb" app.
export const INDEX_URL = `${PORTAL}/icpplus/index.html`;
export const PROVINCE_NAME = 'Barcelona';
// Link in the slot alert: straight to the Barcelona office/trámite page.
export const PROVINCE_URL = `${PORTAL}/icpplustieb/citar?p=8&locale=es`;

// 4038 = "POLICIA-CERTIFICADO DE REGISTRO DE CIUDADANO DE LA U.E." (EU registration certificate, includes the NIE).
export const TRAMITE_ID = '4038';
export const TRAMITE_LABEL = 'POLICÍA-CERTIFICADO DE REGISTRO DE CIUDADANO DE LA U.E.';
// 99 = "Cualquier oficina": one search across every office in the province.
export const OFFICE_ID = '99';

// Offices she'd rather go to (Eixample home, uni in Terrassa), matched against the office names the
// live portal lists (31 Oct 2026). Slots at any office are alerted; these are flagged as preferred.
export const PREFERRED_OFFICES = [
  /MALLORCA/i,             // Barcelona, Mallorca 213 (Eixample)
  /PASSEIG SANT JOAN|PSJ/i, // Barcelona, Passeig Sant Joan 189
  /GUIPUSCOA/i,            // Barcelona, Rambla Guipúscoa 74
  /GUADALAJARA/i,          // Barcelona, c/ Guadalajara 1
  /COMISARIA TERRASSA/i,   // Terrassa, Baldrich 13
  /SABADELL/i,
  /SANT CUGAT/i,
  /COMISARIA RUBI/i,
];

// Madrid-time hours when alerts go out. Outside this window we check less often and only log.
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 1; // 01:00 next day

// After this date (Madrid) the monitor and watchdog stop without touching the portal.
// Tear down sooner once she's booked: see TEARDOWN.md. Env TEARDOWN_DATE overrides.
export const TEARDOWN_DATE = process.env.TEARDOWN_DATE || '2027-01-31';

// The portal's bot defence (F5) started rejecting a normal headed Chrome after ~5 full sessions in
// ~20 minutes (31 Oct 2026), so checks are spaced well apart and back off hard after a block.
export const DAY_INTERVAL_MIN = 10;
export const NIGHT_INTERVAL_MIN = 20;
export const JITTER_SEC = 120;
export const BLOCKED_BACKOFF_MIN = 60;
