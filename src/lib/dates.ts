const MADRID_TZ = 'Europe/Madrid';

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const WEEKDAY_NAMES_UPPER = [
  'DOMINGO',
  'LUNES',
  'MARTES',
  'MIÉRCOLES',
  'JUEVES',
  'VIERNES',
  'SÁBADO',
];

/**
 * Devuelve la fecha actual en Europe/Madrid con formato YYYY-MM-DD.
 */
export function getMadridTodayISO(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MADRID_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/**
 * Parsea YYYY-MM-DD a una fecha UTC pura (mediodía) para operar días sin saltos DST.
 */
function parseISOToUTCNoon(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function formatUTCNoonToISO(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISO(isoDate: string, days: number): string {
  const dt = parseISOToUTCNoon(isoDate);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatUTCNoonToISO(dt);
}

/**
 * Devuelve el lunes de la semana correspondiente a la fecha dada (o el lunes siguiente si es fin de semana?
 * No: mantiene el lunes de la semana natural lun-dom, así sábado/domingo muestra la semana que termina
 * o permite avanzar fácilmente con un clic).
 */
export function getMondayOfWeekISO(isoDate: string): string {
  const dt = parseISOToUTCNoon(isoDate);
  const utcDay = dt.getUTCDay(); // 0=Dom, 1=Lun, ..., 6=Sab
  const diffToMonday = utcDay === 0 ? -6 : 1 - utcDay;
  dt.setUTCDate(dt.getUTCDate() + diffToMonday);
  return formatUTCNoonToISO(dt);
}

/**
 * Devuelve los 5 días laborables (lunes a viernes) de la semana de ese lunes.
 */
export function getWeekdaysFromMonday(mondayISO: string): string[] {
  return [0, 1, 2, 3, 4].map((offset) => addDaysISO(mondayISO, offset));
}

/**
 * Formato: "23 – 27 noviembre de 2026"
 */
export function formatWeekRangeLabel(mondayISO: string): string {
  const fridayISO = addDaysISO(mondayISO, 4);
  const mon = parseISOToUTCNoon(mondayISO);
  const fri = parseISOToUTCNoon(fridayISO);

  const d1 = mon.getUTCDate();
  const m1 = MONTH_NAMES[mon.getUTCMonth()];
  const y1 = mon.getUTCFullYear();

  const d2 = fri.getUTCDate();
  const m2 = MONTH_NAMES[fri.getUTCMonth()];
  const y2 = fri.getUTCFullYear();

  if (y1 === y2 && m1 === m2) {
    return `${d1} – ${d2} ${m1} de ${y1}`;
  }
  if (y1 === y2) {
    return `${d1} ${m1} – ${d2} ${m2} de ${y1}`;
  }
  return `${d1} ${m1} ${y1} – ${d2} ${m2} de ${y2}`;
}

/**
 * Formato: "LUNES · 23 DE NOVIEMBRE"
 */
export function formatDayHeading(isoDate: string): string {
  const dt = parseISOToUTCNoon(isoDate);
  const weekday = WEEKDAY_NAMES_UPPER[dt.getUTCDay()];
  const day = dt.getUTCDate();
  const month = MONTH_NAMES[dt.getUTCMonth()].toUpperCase();
  return `${weekday} · ${day} DE ${month}`;
}

/**
 * Formato amigable con año para "Mis inscripciones" y panel admin.
 */
export function formatFullDateSpanish(isoDate: string): string {
  const dt = parseISOToUTCNoon(isoDate);
  const weekday = WEEKDAY_NAMES_UPPER[dt.getUTCDay()];
  const weekdayCap = weekday.charAt(0) + weekday.slice(1).toLowerCase();
  const day = dt.getUTCDate();
  const month = MONTH_NAMES[dt.getUTCMonth()];
  const year = dt.getUTCFullYear();
  return `${weekdayCap}, ${day} de ${month} de ${year}`;
}

export function formatMadridTimestamp(isoTimestamp: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: MADRID_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoTimestamp));
}
