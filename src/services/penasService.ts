import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { log, warn } from '../utils/logger';

// Pedidos de peñas para las fiestas.
//
// A diferencia de los encargos, esto lo rellena la propia peña desde Telegram:
// el enlace se comparte por redes y entra directo al flujo. Por eso el nombre
// de la peña y el teléfono son obligatorios y todo lo demás va con botones.

export const DIAS_FIESTAS = [
  { fecha: '2026-09-19', etiqueta: 'sábado 19 de septiembre' },
  { fecha: '2026-09-26', etiqueta: 'sábado 26 de septiembre' },
  { fecha: '2026-09-28', etiqueta: 'lunes 28 de septiembre' },
  { fecha: '2026-09-29', etiqueta: 'martes 29 de septiembre' },
  { fecha: '2026-09-30', etiqueta: 'miércoles 30 de septiembre' },
];

// El regalo por pedir los cinco días. Se entrega el último.
export const DIA_REGALO = '2026-09-30';
export const REGALO = ['Super chapata', 'Super cookie'];

export interface LineaPena {
  producto: string;
  cantidad: number;
  regalo?: boolean;
}

export interface PedidoDia {
  fecha: string;
  lineas: LineaPena[];
}

export interface PedidoPena {
  numero: string;              // PÑ-0001
  pena: string;
  telefono: string;
  telegramId: string;
  dias: PedidoDia[];
  completo: boolean;           // pidió los cinco días → lleva regalo
  creadoEn: string;
  cancelado?: boolean;
}

const RUTA = process.env['PENAS_PATH'] ?? config.penasPath;

let cache: PedidoPena[] | null = null;

function cargar(): PedidoPena[] {
  if (cache) return cache;
  try {
    if (fs.existsSync(RUTA)) {
      cache = JSON.parse(fs.readFileSync(RUTA, 'utf-8')) as PedidoPena[];
      log('Penas', `Cargados ${cache.length} pedidos de peñas`);
      return cache;
    }
  } catch (err) {
    warn('Penas', `No se pudo leer ${RUTA}: ${(err as Error).message}`);
  }
  cache = [];
  return cache;
}

function guardar(): void {
  const p = cargar();
  fs.mkdirSync(path.dirname(RUTA), { recursive: true });
  fs.writeFileSync(RUTA, JSON.stringify(p, null, 2), 'utf-8');
}

// Un pedido cuenta como completo si lleva algo en LOS CINCO días. Pedir cuatro
// no da derecho al regalo, por mucho que se acerque.
export function esCompleto(dias: PedidoDia[]): boolean {
  const conAlgo = dias.filter(d => d.lineas.some(l => !l.regalo && l.cantidad > 0));
  return DIAS_FIESTAS.every(f => conAlgo.some(d => d.fecha === f.fecha));
}

export function crear(datos: {
  pena: string; telefono: string; telegramId: string; dias: PedidoDia[];
}): PedidoPena {
  const lista = cargar();
  const completo = esCompleto(datos.dias);

  // El regalo se añade como una línea más del último día, para que aparezca en
  // producción y nadie se olvide de prepararlo.
  const dias = datos.dias.map(d => ({ ...d, lineas: [...d.lineas] }));
  if (completo) {
    let ultimo = dias.find(d => d.fecha === DIA_REGALO);
    if (!ultimo) {
      ultimo = { fecha: DIA_REGALO, lineas: [] };
      dias.push(ultimo);
    }
    for (const r of REGALO) {
      if (!ultimo.lineas.some(l => l.producto === r)) {
        ultimo.lineas.push({ producto: r, cantidad: 1, regalo: true });
      }
    }
  }

  const pedido: PedidoPena = {
    numero: `PÑ-${String(lista.length + 1).padStart(4, '0')}`,
    pena: datos.pena,
    telefono: datos.telefono,
    telegramId: datos.telegramId,
    dias: dias.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    completo,
    creadoEn: new Date().toISOString(),
  };
  lista.push(pedido);
  guardar();
  log('Penas', `${pedido.numero}: ${pedido.pena}, ${dias.length} día(s)${completo ? ' (COMPLETO, con regalo)' : ''}`);
  return pedido;
}

export function todos(): PedidoPena[] {
  return cargar().filter(p => !p.cancelado);
}

export function dePena(telegramId: string): PedidoPena[] {
  return todos().filter(p => p.telegramId === telegramId);
}

export function buscar(numero: string): PedidoPena | undefined {
  return cargar().find(p => p.numero === numero);
}

export function cancelar(numero: string): PedidoPena | null {
  const p = buscar(numero);
  if (!p || p.cancelado) return null;
  p.cancelado = true;
  guardar();
  log('Penas', `${numero} cancelado`);
  return p;
}

// Totales de un día, para el obrador.
export function totalesDia(fecha: string): Array<{ producto: string; cantidad: number }> {
  const m = new Map<string, number>();
  for (const p of todos()) {
    for (const d of p.dias.filter(d => d.fecha === fecha)) {
      for (const l of d.lineas) {
        m.set(l.producto, (m.get(l.producto) ?? 0) + l.cantidad);
      }
    }
  }
  return [...m.entries()]
    .map(([producto, cantidad]) => ({ producto, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

export function textoPedido(p: PedidoPena): string {
  let t = `🎪 ${p.numero} — ${p.pena}\n📞 ${p.telefono}\n\n`;
  for (const d of p.dias) {
    const et = DIAS_FIESTAS.find(f => f.fecha === d.fecha)?.etiqueta ?? d.fecha;
    t += `${et}\n`;
    for (const l of d.lineas) {
      t += `   ${l.cantidad} × ${l.producto}${l.regalo ? '  🎁 regalo' : ''}\n`;
    }
  }
  if (p.completo) t += `\n🎁 Pedido completo: llevan Super chapata y Super cookie el día 30.`;
  return t;
}

// Resumen para el staff: qué hay que producir cada día de fiestas.
export function resumen(): string {
  const pedidos = todos();
  if (!pedidos.length) return 'Todavía no hay ningún pedido de peñas.';

  let t = `🎪 PEDIDOS DE PEÑAS — ${pedidos.length} peña(s)\n`;
  t += `${pedidos.filter(p => p.completo).length} con pedido completo (llevan regalo)\n\n`;
  for (const f of DIAS_FIESTAS) {
    const totales = totalesDia(f.fecha);
    t += `— ${f.etiqueta} —\n`;
    if (!totales.length) { t += '   nada\n\n'; continue; }
    for (const x of totales) t += `   ${x.cantidad} × ${x.producto}\n`;
    t += '\n';
  }
  t += 'Peñas: ' + pedidos.map(p => p.pena).join(', ');
  return t;
}

// Solo para tests.
export function _reset(): void { cache = null; }
