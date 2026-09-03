import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { log, warn } from '../utils/logger';
import { nuevoId } from '../utils/ids';

// Encargos sueltos: los que hoy viven en el grupo de WhatsApp. Sustituyen a
// una lista escrita a mano y agrupada por día. Ver docs/encargos-sueltos.md.
//
// El cliente se identifica por MÓVIL, no por nombre: en el grupo conviven
// "Carlos Magdaleno padre" y "Carlos Magdaleno hijo", y apodos como "Zamora"
// o "Mavi" que no son nombres fiscales. El móvil es lo único estable.

export interface EncargoLinea {
  producto: string;
  cantidad: number;
  // "pocos hechos", "sin sal"... Llega al obrador tal cual.
  nota?: string;
}

// Datos fiscales. Solo se piden y se guardan cuando el cliente es empresa o
// autónomo y PIDE factura: para un particular que se lleva dos empanadas no
// hacen ninguna falta, y guardar datos que no necesitas es lo que no hay que
// hacer. El resto de encargos solo tienen nombre y móvil.
export interface DatosFactura {
  nif: string;
  razonSocial: string;
  email?: string;
}

export interface Encargo {
  id: string;
  fecha: string;              // AAAA-MM-DD, día de recogida
  telefono: string;           // clave del cliente
  nombre: string;
  lineas: EncargoLinea[];
  notaRecogida?: string;      // "lo recoge con las pizzas a las 21:00"
  factura?: DatosFactura;     // solo si pidió factura
  creadoPor: string;          // telegramId de quien lo apuntó
  creadoEn: string;           // ISO
  estado: 'pendiente' | 'confirmado' | 'cancelado';
}

export interface ClienteEncargo {
  telefono: string;
  nombre: string;
  // Preferencias que se repiten pedido tras pedido (Zamora: "pocos hechos").
  notaHabitual?: string;
  primerEncargo: string;
  ultimoEncargo: string;
  totalEncargos: number;
  // Se guardan en el cliente para no volver a pedirlos si repite.
  factura?: DatosFactura;
}

// Recurrente = ha encargado más de una vez. Los de una sola vez son los
// "de paso": puede que vuelvan o puede que no, y por eso van aparte.
export function esRecurrente(c: ClienteEncargo): boolean {
  return c.totalEncargos > 1;
}

interface Almacen {
  clientes: ClienteEncargo[];
  encargos: Encargo[];
}

const RUTA = process.env['ENCARGOS_PATH'] ?? config.encargosPath;

let cache: Almacen | null = null;

function cargar(): Almacen {
  if (cache) return cache;
  try {
    if (fs.existsSync(RUTA)) {
      cache = JSON.parse(fs.readFileSync(RUTA, 'utf-8')) as Almacen;
      log('Encargos', `Cargados ${cache.encargos.length} encargos, ${cache.clientes.length} clientes`);
      return cache;
    }
  } catch (err) {
    warn('Encargos', `No se pudo leer ${RUTA}: ${(err as Error).message}`);
  }
  cache = { clientes: [], encargos: [] };
  return cache;
}

function guardar(): void {
  const a = cargar();
  fs.mkdirSync(path.dirname(RUTA), { recursive: true });
  fs.writeFileSync(RUTA, JSON.stringify(a, null, 2), 'utf-8');
}

// Solo dígitos, para que "666 12 34 56" y "+34666123456" sean el mismo cliente.
export function normalizarTelefono(t: string): string {
  const d = t.replace(/\D/g, '');
  return d.startsWith('34') && d.length === 11 ? d.slice(2) : d;
}

export function buscarCliente(telefono: string): ClienteEncargo | undefined {
  const tel = normalizarTelefono(telefono);
  return cargar().clientes.find(c => c.telefono === tel);
}

export function buscarClientesPorNombre(texto: string): ClienteEncargo[] {
  const q = texto.trim().toLowerCase();
  if (!q) return [];
  return cargar().clientes.filter(c => c.nombre.toLowerCase().includes(q));
}

export function listarClientes(): ClienteEncargo[] {
  return [...cargar().clientes].sort((a, b) => b.totalEncargos - a.totalEncargos);
}

export function guardarNotaHabitual(telefono: string, nota: string): void {
  const c = buscarCliente(telefono);
  if (!c) return;
  c.notaHabitual = nota;
  guardar();
}

export interface NuevoEncargo {
  fecha: string;
  telefono: string;
  nombre: string;
  lineas: EncargoLinea[];
  notaRecogida?: string;
  factura?: DatosFactura;
  creadoPor: string;
}

export function crearEncargo(datos: NuevoEncargo): Encargo {
  const a = cargar();
  const tel = normalizarTelefono(datos.telefono);
  const ahora = new Date().toISOString();

  let cliente = a.clientes.find(c => c.telefono === tel);
  if (!cliente) {
    cliente = {
      telefono: tel, nombre: datos.nombre,
      primerEncargo: datos.fecha, ultimoEncargo: datos.fecha, totalEncargos: 0,
    };
    a.clientes.push(cliente);
    log('Encargos', `Cliente nuevo: ${datos.nombre} (${tel})`);
  }
  cliente.nombre = datos.nombre;   // por si lo han escrito mejor esta vez
  cliente.ultimoEncargo = datos.fecha > cliente.ultimoEncargo ? datos.fecha : cliente.ultimoEncargo;
  cliente.totalEncargos += 1;
  if (datos.factura) cliente.factura = datos.factura;

  const encargo: Encargo = {
    id: nuevoId('E'),
    fecha: datos.fecha,
    telefono: tel,
    nombre: datos.nombre,
    lineas: datos.lineas,
    ...(datos.notaRecogida ? { notaRecogida: datos.notaRecogida } : {}),
    ...(datos.factura ? { factura: datos.factura } : {}),
    creadoPor: datos.creadoPor,
    creadoEn: ahora,
    estado: 'pendiente',
  };
  a.encargos.push(encargo);
  guardar();
  log('Encargos', `Encargo ${encargo.id} para ${datos.fecha}: ${datos.nombre}, ${datos.lineas.length} líneas`);
  return encargo;
}

export function encargosDelDia(fecha: string): Encargo[] {
  return cargar().encargos.filter(e => e.fecha === fecha && e.estado !== 'cancelado');
}

export function cancelarEncargo(id: string): Encargo | null {
  const e = cargar().encargos.find(x => x.id === id);
  if (!e || e.estado === 'cancelado') return null;
  e.estado = 'cancelado';
  guardar();
  log('Encargos', `Encargo ${id} cancelado`);
  return e;
}

export function buscarEncargo(id: string): Encargo | undefined {
  return cargar().encargos.find(e => e.id === id);
}

// Totales por producto de un día, para sumarlos a la producción. Las notas se
// conservan agrupadas: al obrador no le vale saber que hay 12 panes de
// cuadros si 6 van "poco hechos".
export interface TotalProducto {
  producto: string;
  cantidad: number;
  notas: string[];
}

export function totalesDelDia(fecha: string): TotalProducto[] {
  return totalesDe(encargosDelDia(fecha));
}

// Bloque de texto para el resumen de producción.
export function textoProduccion(fecha: string): string {
  const totales = totalesDelDia(fecha);
  if (totales.length === 0) return '';
  const encargos = encargosDelDia(fecha);
  let txt = `\n📋 *ENCARGOS* (${encargos.length})\n`;
  for (const t of totales) {
    txt += `  ${t.cantidad} × ${t.producto}\n`;
    for (const n of t.notas) txt += `      ⚠️ ${n}\n`;
  }
  const conRecogida = encargos.filter(e => e.notaRecogida);
  if (conRecogida.length) {
    txt += `\n  Recogidas:\n`;
    for (const e of conRecogida) txt += `    · ${e.nombre}: ${e.notaRecogida}\n`;
  }
  return txt;
}

// ── Resumen para la hoja ──────────────────────────────────────────────────────

// Encargos de un rango de fechas (ambas incluidas), sin los cancelados.
export function encargosEntre(desde: string, hasta: string): Encargo[] {
  return cargar().encargos
    .filter(e => e.estado !== 'cancelado' && e.fecha >= desde && e.fecha <= hasta)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function totalesDe(lista: Encargo[]): TotalProducto[] {
  const mapa = new Map<string, TotalProducto>();
  for (const e of lista) {
    for (const l of e.lineas) {
      const clave = l.producto.toLowerCase().trim();
      const t = mapa.get(clave) ?? { producto: l.producto, cantidad: 0, notas: [] };
      t.cantidad += l.cantidad;
      if (l.nota) t.notas.push(`${l.cantidad} ${l.nota} (${e.nombre})`);
      mapa.set(clave, t);
    }
  }
  return [...mapa.values()].sort((a, b) => b.cantidad - a.cantidad);
}

export interface ResumenEncargos {
  desde: string;
  hasta: string;
  recurrentes: { clientes: number; encargos: number; totales: TotalProducto[] };
  dePaso: { clientes: number; encargos: number; totales: TotalProducto[] };
  conFactura: Encargo[];
}

// Separa los encargos en dos bloques: clientes que repiten y clientes de una
// sola vez. Son dos cosas distintas para planificar: los recurrentes son
// previsibles y acabarán en la hoja; los de paso, no.
export function resumenEncargos(desde: string, hasta: string): ResumenEncargos {
  const lista = encargosEntre(desde, hasta);
  const recurrentes: Encargo[] = [];
  const dePaso: Encargo[] = [];
  for (const e of lista) {
    const c = buscarCliente(e.telefono);
    (c && esRecurrente(c) ? recurrentes : dePaso).push(e);
  }
  const distintos = (l: Encargo[]): number => new Set(l.map(e => e.telefono)).size;
  return {
    desde, hasta,
    recurrentes: { clientes: distintos(recurrentes), encargos: recurrentes.length, totales: totalesDe(recurrentes) },
    dePaso: { clientes: distintos(dePaso), encargos: dePaso.length, totales: totalesDe(dePaso) },
    conFactura: lista.filter(e => e.factura),
  };
}

// Texto del resumen. Las cantidades van separadas por tabulador para poder
// pegarlas en la hoja: al pegar, el tabulador reparte en columnas solo.
export function textoResumen(r: ResumenEncargos): string {
  const bloque = (titulo: string, b: ResumenEncargos['recurrentes']): string => {
    if (!b.encargos) return `${titulo}\n  (ninguno)\n`;
    let t = `${titulo}\n  ${b.encargos} encargo(s), ${b.clientes} cliente(s)\n`;
    for (const p of b.totales) t += `  ${p.producto}\t${p.cantidad}\n`;
    return t;
  };

  const mismo = r.desde === r.hasta;
  let txt = `📋 ENCARGOS ${mismo ? r.desde : `${r.desde} → ${r.hasta}`}\n\n`;
  txt += bloque('— CLIENTES RECURRENTES —', r.recurrentes);
  txt += '\n';
  txt += bloque('— CLIENTES DE PASO —', r.dePaso);

  if (r.conFactura.length) {
    txt += `\n— CON FACTURA (${r.conFactura.length}) —\n`;
    for (const e of r.conFactura) {
      txt += `  ${e.fecha} · ${e.factura!.razonSocial} · ${e.factura!.nif} · ${e.id}\n`;
    }
  }
  return txt;
}

// Solo para tests.
export function _reset(): void { cache = null; }
