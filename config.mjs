// What to watch for. Personal data never lives here: it comes from env vars (Actions secrets).

export const PORTAL = process.env.PORTAL_BASE || 'https://icp.administracionelectronica.gob.es';

// Barcelona province uses the "icpplustieb" app; p=8 is Barcelona.
export const PROVINCE_URL = `${PORTAL}/icpplustieb/citar?p=8`;

// 4038 = "POLICÍA-CERTIFICADO DE REGISTRO DE CIUDADANO DE LA U.E." (EU registration certificate, includes the NIE).
export const TRAMITE_URL = `${PORTAL}/icpplustieb/acInfo?tramiteGrupo[0]=4038`;
export const TRAMITE_LABEL = 'POLICÍA-CERTIFICADO DE REGISTRO DE CIUDADANO DE LA U.E.';

// Offices she'd accept (Eixample home, uni in Terrassa). Matched against the office dropdown text,
// which is more stable than the numeric ids. Any other office with slots is logged but not pushed.
export const ACCEPTED_OFFICES = [
  /GUIPUSCOA/i,            // Barcelona, Rambla Guipúscoa 74
  /MALLORCA/i,             // Barcelona, Mallorca 213 (Eixample)
  /MURCIA/i,               // Barcelona, Murcia 42
  /SANT JOAN|SAN JUAN/i,   // Barcelona, Passeig Sant Joan 189
  /COMISARIA TERRASSA/i,   // Terrassa, Baldrich 13
  /SABADELL/i,
  /SANT CUGAT/i,
  /RUBI/i,
  /HOSPITALET/i,
];

// Madrid-time hours when alerts go out. Outside this window we check less often and only log.
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 1; // 01:00 next day

// After this date (Madrid) the monitor and watchdog stop without touching the portal.
// Tear down sooner once she's booked: see TEARDOWN.md. Env TEARDOWN_DATE overrides.
export const TEARDOWN_DATE = process.env.TEARDOWN_DATE || '2027-01-31';

export const DAY_INTERVAL_MIN = 4;
export const NIGHT_INTERVAL_MIN = 15;
export const JITTER_SEC = 60;
