import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { log } from '../utils/logger';

// Estado de pago de las reservas de pizza.
//
// Va en su propio fichero y NO dentro del log de pedidos a propósito: ese log
// es append-only y el número de pedido se calcula contando sus líneas
// (PZ-0007 = séptima línea). Reescribir o volver a añadir una línea para
// marcar un pago desplazaría la numeración de todos los pedidos siguientes.

export type MetodoPago = 'local' | 'online';

export interface Pago {
  orderNumber: string;
  metodo: MetodoPago;
  estado: 'pendiente' | 'pagado';
  importe: number;
  chargeId?: string;        // id del cargo que devuelve Telegram/Stripe
  sessionId?: string;       // sesión de Stripe, para poder consultarla
  url?: string;             // enlace de pago que se le mandó al cliente
  creadoEn: string;
  pagadoEn?: string;
}

const RUTA = process.env['PAGOS_PATH'] ?? config.pagosPath;

let cache: Record<string, Pago> | null = null;

function cargar(): Record<string, Pago> {
  if (cache) return cache;
  try {
    if (fs.existsSync(RUTA)) {
      cache = JSON.parse(fs.readFileSync(RUTA, 'utf-8')) as Record<string, Pago>;
      return cache;
    }
  } catch {
    // Un fichero corrupto no puede tumbar las reservas: se empieza de cero.
  }
  cache = {};
  return cache;
}

function guardar(): void {
  fs.mkdirSync(path.dirname(RUTA), { recursive: true });
  fs.writeFileSync(RUTA, JSON.stringify(cargar(), null, 2), 'utf-8');
}

export function registrar(orderNumber: string, metodo: MetodoPago, importe: number): Pago {
  const p: Pago = {
    orderNumber, metodo, importe,
    estado: metodo === 'online' ? 'pendiente' : 'pendiente',
    creadoEn: new Date().toISOString(),
  };
  cargar()[orderNumber] = p;
  guardar();
  log('Pagos', `${orderNumber}: ${metodo}, ${importe.toFixed(2)} €`);
  return p;
}

export function guardarEnlace(orderNumber: string, sessionId: string, url: string): void {
  const p = cargar()[orderNumber];
  if (!p) return;
  p.sessionId = sessionId;
  p.url = url;
  guardar();
}

// Los que se fueron a pagar por enlace y siguen sin confirmarse. Son los que
// hay que preguntarle a Stripe.
export function pendientesOnline(): Pago[] {
  return Object.values(cargar()).filter(p => p.estado === 'pendiente' && p.sessionId);
}

export function marcarPagado(orderNumber: string, chargeId?: string): Pago | null {
  const p = cargar()[orderNumber];
  if (!p) return null;
  p.estado = 'pagado';
  p.pagadoEn = new Date().toISOString();
  if (chargeId) p.chargeId = chargeId;
  guardar();
  log('Pagos', `${orderNumber} PAGADO${chargeId ? ` (${chargeId})` : ''}`);
  return p;
}

export function de(orderNumber: string): Pago | undefined {
  return cargar()[orderNumber];
}

// Texto corto para el resumen del staff: lo que hay que saber al entregar.
export function etiqueta(orderNumber: string): string {
  const p = de(orderNumber);
  if (!p) return '💶 Cobrar en el local';
  if (p.estado === 'pagado') return `✅ PAGADO (${p.importe.toFixed(2)} €)`;
  return p.metodo === 'online'
    ? `⏳ Pago online sin completar — cobrar ${p.importe.toFixed(2)} € en el local`
    : `💶 Cobrar ${p.importe.toFixed(2)} € en el local`;
}

export function pendientesDeCobro(): Pago[] {
  return Object.values(cargar()).filter(p => p.estado === 'pendiente');
}

// Solo para tests.
export function _reset(): void { cache = null; }
