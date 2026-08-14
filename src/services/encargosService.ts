import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { log, warn } from '../utils/logger';

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

export interface Encargo {
  id: string;
  fecha: string;              // AAAA-MM-DD, día de recogida
  telefono: string;           // clave del cliente
  nombre: string;
  lineas: EncargoLinea[];
  notaRecogida?: string;      // "lo recoge con las pizzas a las 21:00"
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

  const encargo: Encargo = {
    id: `E${Date.now().toString(36).toUpperCase()}`,
    fecha: datos.fecha,
    telefono: tel,
    nombre: datos.nombre,
    lineas: datos.lineas,
    ...(datos.notaRecogida ? { notaRecogida: datos.notaRecogida } : {}),
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
  const mapa = new Map<string, TotalProducto>();
  for (const e of encargosDelDia(fecha)) {
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

// Solo para tests.
export function _reset(): void { cache = null; }
