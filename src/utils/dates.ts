import { format, addDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { config } from '../config';

const TZ = config.timezone;

const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const DAY_NAME_MAP: Record<string, number> = {
  lunes: 1,
  martes: 2,
  'miércoles': 3,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  'sábado': 6,
  sabado: 6,
  domingo: 0,
};

export function getTodayDate(): string {
  const nowMadrid = toZonedTime(new Date(), TZ);
  return format(nowMadrid, 'yyyy-MM-dd');
}

export function getTomorrowDate(): string {
  const nowMadrid = toZonedTime(new Date(), TZ);
  return format(addDays(nowMadrid, 1), 'yyyy-MM-dd');
}

// Fecha de producción relevante en cada momento:
// - De madrugada (antes de earlyCutoffHour, p.ej. panaderos entrando a la 1:00) ya se hornea
//   para el día en curso → se usa la fecha de hoy.
// - El resto del día (incluida la tarde/noche, cuando se cierra el pedido) se hornea
//   para el día siguiente → se usa mañana.
export function getRelevantProductionDate(earlyCutoffHour = 6): string {
  const nowMadrid = toZonedTime(new Date(), TZ);
  if (nowMadrid.getHours() < earlyCutoffHour) {
    return format(nowMadrid, 'yyyy-MM-dd');
  }
  return format(addDays(nowMadrid, 1), 'yyyy-MM-dd');
}

export function getDateForDayName(dayName: string, now?: Date): string {
  const normalized = dayName.toLowerCase().trim();
  const nowMadrid = toZonedTime(now ?? new Date(), TZ);
  const currentDay = nowMadrid.getDay();
  const targetDay = DAY_NAME_MAP[normalized];

  if (targetDay === undefined) {
    throw new Error(`Unknown day name: ${dayName}`);
  }

  let diff = targetDay - currentDay;
  if (diff <= 0) diff += 7;

  return format(addDays(nowMadrid, diff), 'yyyy-MM-dd');
}

export function isAfterCutoff(now?: Date): boolean {
  const nowMadrid = toZonedTime(now ?? new Date(), TZ);
  return nowMadrid.getHours() >= config.autoCutoffHour;
}

// Día de la semana (0=domingo…6=sábado) para una fecha "YYYY-MM-DD", sin desfases de zona horaria
export function getDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year!, month! - 1, day!).getDay();
}

export function formatDateSpanish(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year!, month! - 1, day!);
  const dayName = DAY_NAMES_ES[date.getDay()];
  return `${dayName} ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
}

export function unixToDateStr(unix: number): string {
  const d = new Date(unix * 1000);
  return format(toZonedTime(d, TZ), 'yyyy-MM-dd');
}

export function dateStrToUnix(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return Math.floor(new Date(year!, month! - 1, day!).getTime() / 1000);
}

export function getCurrentWeekDates(): Record<string, string> {
  const nowMadrid = toZonedTime(new Date(), TZ);
  const result: Record<string, string> = {};
  const dayNames = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const currentDow = nowMadrid.getDay();
  const mondayOffset = currentDow === 0 ? -6 : 1 - currentDow;
  const monday = addDays(nowMadrid, mondayOffset);
  for (let i = 0; i < 7; i++) {
    result[dayNames[i]!] = format(addDays(monday, i), 'yyyy-MM-dd');
  }
  return result;
}
