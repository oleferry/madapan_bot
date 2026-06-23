import { ParsedChange } from '../types';
import { getTomorrowDate, getTodayDate, getDateForDayName, getCurrentWeekDates } from '../utils/dates';

// ── Unsupported patterns ──────────────────────────────────────────────────────

const UNSUPPORTED_PATTERNS = [
  /lo de siempre/i,
  /como la semana pasada/i,
  /bastante m[aá]s/i,
  /un poco m[aá]s/i,
  /un poco menos/i,
  /audio/i,
];

// ── Product alias map ─────────────────────────────────────────────────────────

const PRODUCT_ALIASES: Record<string, string[]> = {
  'barra': ['barra', 'barras', 'pan'],
  'chapata': ['chapata', 'chapatas'],
  'cuadros': ['cuadros', 'pan de cuadros', 'candeal'],
  'hogaza': ['hogaza', 'hogazas'],
  'centeno': ['centeno', 'hogaza centeno', 'mm centeno'],
  'semillas': ['semillas', 'hogaza semillas', 'mm semillas'],
  'barra pequeña': ['barra pequeña', 'barrita', 'barritas'],
  'pan pequeño': ['pan pequeño', 'panecillo', 'panecillos'],
  'torta aceite': ['torta de aceite', 'torta aceite', 'tortas aceite'],
  'torta azucar': ['torta de azúcar', 'torta azúcar', 'tortas azúcar', 'torta de azucar', 'torta azucar'],
  'magdalenas': ['magdalenas', 'magdalena'],
  'pastas': ['pastas', 'pastas de lola', 'pasta'],
  'rosquillas': ['rosquillas', 'rosquilla'],
  'bizcocho': ['bizcocho', 'bizcochos', 'bizcocho normal', 'bizcocho nueces', 'bizcocho chocolate'],
  'integral': ['integral', 'pan integral'],
  'canteros': ['canteros', 'pan de canteros'],
  'pasas nueces': ['pasas y nueces', 'pan de pasas', 'pasas nueces'],
};

// ── Regex patterns ────────────────────────────────────────────────────────────

const INCREMENT_PATTERNS = [
  /\+\s*(\d+)\s+(.+)/i,
  /(\d+)\s+(.+?)\s+m[aá]s/i,
  /a[ñn]ad[ae]\s+(\d+)\s+(.+)/i,
  /agrega\s+(\d+)\s+(.+)/i,
  /suma\s+(\d+)\s+(.+)/i,
  /pon\s+(\d+)\s+m[aá]s\s+(?:de\s+)?(.+)/i,
];

const DECREMENT_PATTERNS = [
  /-\s*(\d+)\s+(.+)/i,
  /quita\s+(\d+)\s+(.+)/i,
  /quitar\s+(\d+)\s+(.+)/i,
  /menos\s+(\d+)\s+(?:de\s+)?(.+)/i,
  /(\d+)\s+(.+?)\s+menos/i,
  /elimina\s+(\d+)\s+(.+)/i,
  /borra\s+(\d+)\s+(.+)/i,
];

const SET_PATTERNS = [
  /d[eé]jal[oa]?\s+en\s+(\d+)\s+(.+)/i,
  /pon\s+(\d+)\s+(.+)/i,
  /exactamente\s+(\d+)\s+(.+)/i,
  /que\s+sean?\s+(\d+)\s+(.+)/i,
  /necesito\s+(\d+)\s+(.+)/i,
  /quiero\s+(\d+)\s+(.+)/i,
  /(\d+)\s+(.+?)\s+en\s+total/i,
  /total\s+(\d+)\s+(.+)/i,
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveProductAlias(text: string): string | null {
  const lower = text.toLowerCase().trim();
  // Sort aliases longest first to avoid prefix clashes
  const entries = Object.entries(PRODUCT_ALIASES).sort(
    ([, a], [, b]) => Math.max(...b.map((s) => s.length)) - Math.max(...a.map((s) => s.length))
  );
  for (const [key, aliases] of entries) {
    for (const alias of aliases) {
      if (lower.includes(alias)) {
        return key;
      }
    }
  }
  return null;
}

function extractDate(message: string, now: Date): string | null {
  const lower = message.toLowerCase();

  // "para el lunes", "para el martes", etc.
  const paraElMatch = lower.match(
    /para\s+(?:el\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)/i
  );
  if (paraElMatch) {
    try {
      return getDateForDayName(paraElMatch[1]!, now);
    } catch {
      return null;
    }
  }

  if (/ma[ñn]ana/.test(lower)) {
    return getTomorrowDate();
  }

  if (lower.includes('hoy')) {
    return getTodayDate();
  }

  // Check week day names
  const weekDates = getCurrentWeekDates();
  for (const [dayName, date] of Object.entries(weekDates)) {
    if (lower.includes(dayName)) {
      return date;
    }
  }

  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function parseCustomerMessage(message: string, now?: Date): ParsedChange {
  const trimmed = message.trim();
  const refDate = now ?? new Date();

  for (const pattern of UNSUPPORTED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        status: 'unsupported',
        deliveryDate: null,
        actions: [],
        reason: 'Tipo de solicitud no soportado. Por favor indica producto y cantidad exacta.',
      };
    }
  }

  const deliveryDate = extractDate(trimmed, refDate);
  const actions: ParsedChange['actions'] = [];

  // Try increment
  for (const pattern of INCREMENT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const qty = parseInt(match[1]!, 10);
      const alias = resolveProductAlias(match[2]!.trim());
      if (alias && !isNaN(qty) && qty > 0) {
        actions.push({ productAlias: alias, type: 'increment', quantity: qty });
        break;
      }
    }
  }

  // Try decrement
  if (actions.length === 0) {
    for (const pattern of DECREMENT_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        const qty = parseInt(match[1]!, 10);
        const alias = resolveProductAlias(match[2]!.trim());
        if (alias && !isNaN(qty) && qty > 0) {
          actions.push({ productAlias: alias, type: 'decrement', quantity: qty });
          break;
        }
      }
    }
  }

  // Try set quantity
  if (actions.length === 0) {
    for (const pattern of SET_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        const qty = parseInt(match[1]!, 10);
        const alias = resolveProductAlias(match[2]!.trim());
        if (alias && !isNaN(qty) && qty >= 0) {
          actions.push({ productAlias: alias, type: 'set_quantity', quantity: qty });
          break;
        }
      }
    }
  }

  if (actions.length === 0) {
    return {
      status: 'ambiguous',
      deliveryDate,
      actions: [],
      reason: 'No he podido entender qué producto o cantidad quieres cambiar.',
    };
  }

  if (!deliveryDate) {
    return {
      status: 'ambiguous',
      deliveryDate: null,
      actions,
      reason: '¿Para qué día es el cambio? (ej: "mañana", "el lunes")',
    };
  }

  return { status: 'ok', deliveryDate, actions };
}
