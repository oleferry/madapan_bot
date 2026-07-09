"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTodayDate = getTodayDate;
exports.getTomorrowDate = getTomorrowDate;
exports.getRelevantProductionDate = getRelevantProductionDate;
exports.getDateForDayName = getDateForDayName;
exports.isAfterCutoff = isAfterCutoff;
exports.getDayOfWeek = getDayOfWeek;
exports.formatDateSpanish = formatDateSpanish;
exports.unixToDateStr = unixToDateStr;
exports.dateStrToUnix = dateStrToUnix;
exports.getCurrentWeekDates = getCurrentWeekDates;
const date_fns_1 = require("date-fns");
const date_fns_tz_1 = require("date-fns-tz");
const config_1 = require("../config");
const TZ = config_1.config.timezone;
const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAY_NAME_MAP = {
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
function getTodayDate() {
    const nowMadrid = (0, date_fns_tz_1.toZonedTime)(new Date(), TZ);
    return (0, date_fns_1.format)(nowMadrid, 'yyyy-MM-dd');
}
function getTomorrowDate() {
    const nowMadrid = (0, date_fns_tz_1.toZonedTime)(new Date(), TZ);
    return (0, date_fns_1.format)((0, date_fns_1.addDays)(nowMadrid, 1), 'yyyy-MM-dd');
}
// Fecha de producción relevante en cada momento:
// - De madrugada (antes de earlyCutoffHour, p.ej. panaderos entrando a la 1:00) ya se hornea
//   para el día en curso → se usa la fecha de hoy.
// - El resto del día (incluida la tarde/noche, cuando se cierra el pedido) se hornea
//   para el día siguiente → se usa mañana.
function getRelevantProductionDate(earlyCutoffHour = 6) {
    const nowMadrid = (0, date_fns_tz_1.toZonedTime)(new Date(), TZ);
    if (nowMadrid.getHours() < earlyCutoffHour) {
        return (0, date_fns_1.format)(nowMadrid, 'yyyy-MM-dd');
    }
    return (0, date_fns_1.format)((0, date_fns_1.addDays)(nowMadrid, 1), 'yyyy-MM-dd');
}
function getDateForDayName(dayName, now) {
    const normalized = dayName.toLowerCase().trim();
    const nowMadrid = (0, date_fns_tz_1.toZonedTime)(now ?? new Date(), TZ);
    const currentDay = nowMadrid.getDay();
    const targetDay = DAY_NAME_MAP[normalized];
    if (targetDay === undefined) {
        throw new Error(`Unknown day name: ${dayName}`);
    }
    let diff = targetDay - currentDay;
    if (diff <= 0)
        diff += 7;
    return (0, date_fns_1.format)((0, date_fns_1.addDays)(nowMadrid, diff), 'yyyy-MM-dd');
}
function isAfterCutoff(now) {
    const nowMadrid = (0, date_fns_tz_1.toZonedTime)(now ?? new Date(), TZ);
    return nowMadrid.getHours() >= config_1.config.autoCutoffHour;
}
// Día de la semana (0=domingo…6=sábado) para una fecha "YYYY-MM-DD", sin desfases de zona horaria
function getDayOfWeek(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day).getDay();
}
function formatDateSpanish(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dayName = DAY_NAMES_ES[date.getDay()];
    return `${dayName} ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
}
function unixToDateStr(unix) {
    const d = new Date(unix * 1000);
    return (0, date_fns_1.format)((0, date_fns_tz_1.toZonedTime)(d, TZ), 'yyyy-MM-dd');
}
function dateStrToUnix(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return Math.floor(new Date(year, month - 1, day).getTime() / 1000);
}
function getCurrentWeekDates() {
    const nowMadrid = (0, date_fns_tz_1.toZonedTime)(new Date(), TZ);
    const result = {};
    const dayNames = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    const currentDow = nowMadrid.getDay();
    const mondayOffset = currentDow === 0 ? -6 : 1 - currentDow;
    const monday = (0, date_fns_1.addDays)(nowMadrid, mondayOffset);
    for (let i = 0; i < 7; i++) {
        result[dayNames[i]] = (0, date_fns_1.format)((0, date_fns_1.addDays)(monday, i), 'yyyy-MM-dd');
    }
    return result;
}
//# sourceMappingURL=dates.js.map