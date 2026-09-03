import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { log, warn } from '../utils/logger';
import { nuevoId } from '../utils/ids';
import * as ps from './pedidosSemanaService';

// Cambios temporales pendientes de deshacer.
//
// La pestaña Pedidos_semana es la base recurrente: no sabe decir "solo esta
// semana". Así que un "Herbolario cierra la semana que viene" se queda puesto
// para siempre si nadie lo devuelve. Aquí se guarda el valor que tenía antes y
// se avisa antes de la siguiente carga semanal.

export interface Pendiente {
  id: string;
  descripcion: string;         // el trozo del mensaje original
  creadoEn: string;
  recordarEl: string;          // AAAA-MM-DD
  avisadoEn?: string;
  estado: 'pendiente' | 'revertido' | 'descartado';
  // Para deshacer: la misma celda, con el valor de antes.
  vuelta: ps.Cambio[];
}

interface Almacen { pendientes: Pendiente[] }

const RUTA = process.env['REVERTIR_PATH'] ?? config.revertirPath;

let cache: Almacen | null = null;

function cargar(): Almacen {
  if (cache) return cache;
  try {
    if (fs.existsSync(RUTA)) {
      cache = JSON.parse(fs.readFileSync(RUTA, 'utf-8')) as Almacen;
      return cache;
    }
  } catch (err) {
    warn('Revertir', `No se pudo leer ${RUTA}: ${(err as Error).message}`);
  }
  cache = { pendientes: [] };
  return cache;
}

function guardar(): void {
  const a = cargar();
  fs.mkdirSync(path.dirname(RUTA), { recursive: true });
  fs.writeFileSync(RUTA, JSON.stringify(a, null, 2), 'utf-8');
}

// El aviso va el día de la carga semanal, que es cuando de verdad importa:
// si nadie lo deshace antes, esos ceros se suben a Holded otra vez.
export function proximoDiaDeCarga(desde: string): string {
  const d = new Date(`${desde}T12:00:00Z`);
  const objetivo = config.weeklyOrdersDow;            // 5 = viernes
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() !== objetivo);
  return d.toISOString().slice(0, 10);
}

export function anotar(descripcion: string, aplicados: ps.Cambio[], hoy: string): Pendiente {
  // Se invierte el cambio: para deshacerlo hay que volver al valor de antes.
  const vuelta: ps.Cambio[] = aplicados.map(c => ({
    ...c, actual: c.nuevo, nuevo: c.actual, motivo: 'volver a lo de antes',
  }));
  const p: Pendiente = {
    id: nuevoId('R'),
    descripcion,
    creadoEn: new Date().toISOString(),
    recordarEl: proximoDiaDeCarga(hoy),
    estado: 'pendiente',
    vuelta,
  };
  cargar().pendientes.push(p);
  guardar();
  log('Revertir', `Anotado ${p.id}: ${vuelta.length} celdas, recordar el ${p.recordarEl}`);
  return p;
}

export function pendientes(): Pendiente[] {
  return cargar().pendientes.filter(p => p.estado === 'pendiente');
}

export function paraAvisar(hoy: string): Pendiente[] {
  return pendientes().filter(p => p.recordarEl <= hoy);
}

export function buscar(id: string): Pendiente | undefined {
  return cargar().pendientes.find(p => p.id === id);
}

export function marcarAvisado(id: string, hoy: string): void {
  const p = buscar(id);
  if (!p) return;
  p.avisadoEn = hoy;
  // Si no se hace nada hoy, se vuelve a avisar en la siguiente carga: no se
  // pierde por no haberlo atendido a la primera.
  p.recordarEl = proximoDiaDeCarga(hoy);
  guardar();
}

export function cerrar(id: string, estado: 'revertido' | 'descartado'): Pendiente | null {
  const p = buscar(id);
  if (!p || p.estado !== 'pendiente') return null;
  p.estado = estado;
  guardar();
  log('Revertir', `${id} → ${estado}`);
  return p;
}

export function texto(p: Pendiente): string {
  return `⏰ Cambio temporal sin deshacer\n\n"${p.descripcion}"\n\n` +
    `Se aplicó el ${p.creadoEn.slice(0, 10)} y sigue puesto. ` +
    `Si el cliente ya ha vuelto a abrir, hay que devolverlo antes de cargar la semana.\n\n` +
    ps.textoCambios(p.vuelta);
}

// Solo para tests.
export function _reset(): void { cache = null; }
