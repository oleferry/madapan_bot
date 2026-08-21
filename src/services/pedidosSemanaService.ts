import * as sheetsClient from './sheetsClient';
import { log } from '../utils/logger';

// Pestaña Pedidos_semana de la hoja maestra: es la base recurrente de la que
// sale todo lo demás (la pestaña "Holded modelo" la calcula el propio Excel a
// partir de aquí, y de ahí lee /cargar_semana).
//
// Formato: una fila por Día × Punto × Producto. Siete filas seguidas por cada
// combinación punto-producto, una por día de la semana.
//
// ⚠️ Es la base RECURRENTE, no la semana concreta. Cambiar una cantidad aquí
// vale para todas las semanas siguientes hasta que se vuelva a cambiar. La
// hoja no tiene forma de decir "solo esta semana".

export const RANGO = 'Pedidos_semana!A2:F2000';

export interface FilaPedido {
  fila: number;          // fila real en la hoja, para poder escribirla
  dia: string;           // tal y como está escrito en la hoja
  punto: string;
  producto: string;
  cantidad: number;
}

export const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// La hoja mezcla "Lunes" y "lunes", con y sin tilde. Todo se compara así.
export function normalizar(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Palabras significativas, en singular. Comparar cadenas enteras no vale:
// "panes integrales" no contiene "pan integral", y "Herbolario Rioseco" no es
// un trozo de "HERBOLARIO MEDINA DE RIOSECO (JAKELINE ...)". Lo que sí
// funciona es exigir que todas las palabras del texto buscado aparezcan.
const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'sl', 'slu', 'cb', 'sa', 'bar']);

export function palabras(s: string): string[] {
  return normalizar(s)
    .split(/[^a-z0-9]+/)
    .filter(p => p.length > 2 && !VACIAS.has(p))
    .map(singular);
}

function singular(p: string): string {
  if (p.endsWith('es') && p.length > 4) return p.slice(0, -2);
  if (p.endsWith('s') && p.length > 3) return p.slice(0, -1);
  return p;
}

// ¿Aparecen todas las palabras de "busca" en "texto"? La palabra buscada tiene
// que ser prefijo de la de la hoja, nunca al revés: si se admitiera lo
// segundo, "Villa de Celes" encajaría con "Villacarralón" porque "villa" es
// prefijo suyo, y acabaríamos cambiando el pedido del cliente equivocado.
function contieneTodas(texto: string, busca: string): boolean {
  const dentro = palabras(texto);
  const fuera = palabras(busca);
  if (!fuera.length) return false;
  return fuera.every(f => dentro.some(d => d.startsWith(f)));
}

export function esMismoDia(a: string, b: string): boolean {
  return normalizar(a) === normalizar(b);
}

export async function leer(): Promise<FilaPedido[]> {
  const filas = await sheetsClient.readRange(RANGO);
  const out: FilaPedido[] = [];
  for (let i = 0; i < filas.length; i++) {
    const r = filas[i]!;
    const punto = (r[1] ?? '').trim();
    const producto = (r[2] ?? '').trim();
    if (!punto || !producto) continue;
    out.push({
      fila: i + 2,
      dia: (r[0] ?? '').trim(),
      punto,
      producto,
      cantidad: Number(String(r[3] ?? '0').replace(',', '.')) || 0,
    });
  }
  log('PedidosSemana', `Leídas ${out.length} filas`);
  return out;
}

export function puntos(filas: FilaPedido[]): string[] {
  return [...new Set(filas.map(f => f.punto))];
}

// Busca el punto por un trozo del nombre ("Villacarralón" → "BAR VILLACARRALÓN
// (ABEL FERNÁNDEZ REDONDO)"). Devuelve todos los que encajan: si hay más de
// uno, quien decide es una persona, no el bot.
export function buscarPunto(filas: FilaPedido[], texto: string): string[] {
  const q = normalizar(texto);
  if (!q) return [];
  const todos = puntos(filas);
  const exacto = todos.filter(p => normalizar(p) === q);
  if (exacto.length) return exacto;
  return todos.filter(p => contieneTodas(p, texto));
}

// Igual con el producto, pero solo entre los que ese punto lleva de verdad.
export function buscarProducto(filas: FilaPedido[], punto: string, texto: string): string[] {
  const suyos = [...new Set(filas.filter(f => f.punto === punto).map(f => f.producto))];
  const q = normalizar(texto);
  if (!q) return [];
  const exacto = suyos.filter(p => normalizar(p) === q);
  if (exacto.length) return exacto;
  // "panes integrales" → "Pan integral". Se exige que todas las palabras del
  // texto estén en el producto; si encajan varios ("panes" con pan de cuadros
  // y pan pequeño), se devuelven todos para que el bot pregunte.
  return suyos.filter(p => contieneTodas(p, texto));
}

export interface Cambio {
  fila: number;
  punto: string;
  dia: string;
  producto: string;
  actual: number;
  nuevo: number;
  motivo: string;
}

export function aCeldas(cambios: Cambio[]): Array<{ range: string; value: string }> {
  return cambios.map(c => ({ range: `Pedidos_semana!D${c.fila}`, value: String(c.nuevo) }));
}

export async function aplicar(cambios: Cambio[]): Promise<void> {
  await sheetsClient.writeCells(aCeldas(cambios));
  log('PedidosSemana', `Aplicados ${cambios.length} cambios`);
}

export function textoCambios(cambios: Cambio[]): string {
  if (!cambios.length) return 'No hay ningún cambio que aplicar.';
  const porPunto = new Map<string, Cambio[]>();
  for (const c of cambios) {
    porPunto.set(c.punto, [...(porPunto.get(c.punto) ?? []), c]);
  }
  let txt = '';
  for (const [punto, lista] of porPunto) {
    txt += `— ${punto} —\n`;
    // Se agrupa por producto y cambio para no escupir 7 líneas iguales.
    const agrupado = new Map<string, { dias: string[]; c: Cambio }>();
    for (const c of lista) {
      const k = `${c.producto}|${c.actual}|${c.nuevo}|${c.motivo}`;
      const g = agrupado.get(k) ?? { dias: [], c };
      g.dias.push(c.dia.toLowerCase());
      agrupado.set(k, g);
    }
    for (const { dias, c } of agrupado.values()) {
      const cuando = dias.length === 7 ? 'todos los días' : dias.join(', ');
      txt += `   ${c.producto}: ${c.actual} → ${c.nuevo}  (${cuando})\n`;
    }
    txt += '\n';
  }
  return txt.trimEnd();
}
