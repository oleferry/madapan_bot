import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { log, warn } from '../utils/logger';

// Lista de la compra: se van apuntando cosas según se acaban ("24 coca colas")
// y cada dos semanas se agrupan por proveedor en un borrador de pedido.
//
// Por qué el proveedor se guarda aquí y no en Holded: el campo de proveedor de
// la ficha de artículo NO se puede escribir por API. Holded responde "Updated"
// y lo ignora, igual que pasa con las tarifas de los contactos. Comprobado.
// Así que el mapa artículo→proveedor lo aprende el bot: pregunta una vez y se
// acuerda. Si algún día se rellena a mano en Holded, se lee de allí.

export interface Apunte {
  id: string;
  texto: string;              // lo que se escribió, tal cual
  producto: string;           // nombre final (de Holded o el texto libre)
  sku?: string;
  holdedId?: string;
  cantidad: number;
  proveedorId?: string;
  proveedorNombre?: string;
  nota?: string;
  apuntadoPor: string;
  creadoEn: string;
  estado: 'pendiente' | 'pedido' | 'cancelado';
  pedidoEn?: string;          // fecha del borrador en que salió
}

// Lo aprendido: para esta clave (SKU si lo hay, si no el nombre), este proveedor.
export interface Aprendido {
  clave: string;
  proveedorId: string;
  proveedorNombre: string;
  proveedorEmail?: string;
  veces: number;
}

interface Almacen {
  apuntes: Apunte[];
  aprendido: Aprendido[];
  ultimoBorrador?: string;    // AAAA-MM-DD
}

const RUTA = process.env['COMPRAS_PATH'] ?? config.comprasPath;

let cache: Almacen | null = null;

function cargar(): Almacen {
  if (cache) return cache;
  try {
    if (fs.existsSync(RUTA)) {
      cache = JSON.parse(fs.readFileSync(RUTA, 'utf-8')) as Almacen;
      log('Compras', `Cargados ${cache.apuntes.length} apuntes, ${cache.aprendido.length} proveedores aprendidos`);
      return cache;
    }
  } catch (err) {
    warn('Compras', `No se pudo leer ${RUTA}: ${(err as Error).message}`);
  }
  cache = { apuntes: [], aprendido: [] };
  return cache;
}

function guardar(): void {
  const a = cargar();
  fs.mkdirSync(path.dirname(RUTA), { recursive: true });
  fs.writeFileSync(RUTA, JSON.stringify(a, null, 2), 'utf-8');
}

export function clave(producto: string, sku?: string): string {
  return (sku || producto).toLowerCase().trim();
}

export function proveedorDe(producto: string, sku?: string): Aprendido | undefined {
  const k = clave(producto, sku);
  return cargar().aprendido.find(a => a.clave === k);
}

export function aprenderProveedor(
  producto: string, sku: string | undefined,
  proveedorId: string, proveedorNombre: string, proveedorEmail?: string
): void {
  const a = cargar();
  const k = clave(producto, sku);
  const ya = a.aprendido.find(x => x.clave === k);
  if (ya) {
    ya.proveedorId = proveedorId;
    ya.proveedorNombre = proveedorNombre;
    if (proveedorEmail) ya.proveedorEmail = proveedorEmail;
    ya.veces += 1;
  } else {
    a.aprendido.push({
      clave: k, proveedorId, proveedorNombre,
      ...(proveedorEmail ? { proveedorEmail } : {}), veces: 1,
    });
    log('Compras', `Aprendido: "${k}" → ${proveedorNombre}`);
  }
  guardar();
}

export interface NuevoApunte {
  texto: string;
  producto: string;
  cantidad: number;
  sku?: string;
  holdedId?: string;
  proveedorId?: string;
  proveedorNombre?: string;
  nota?: string;
  apuntadoPor: string;
}

export function apuntar(datos: NuevoApunte): Apunte {
  const a = cargar();
  const apunte: Apunte = {
    id: `C${Date.now().toString(36).toUpperCase()}`,
    texto: datos.texto,
    producto: datos.producto,
    cantidad: datos.cantidad,
    ...(datos.sku ? { sku: datos.sku } : {}),
    ...(datos.holdedId ? { holdedId: datos.holdedId } : {}),
    ...(datos.proveedorId ? { proveedorId: datos.proveedorId } : {}),
    ...(datos.proveedorNombre ? { proveedorNombre: datos.proveedorNombre } : {}),
    ...(datos.nota ? { nota: datos.nota } : {}),
    apuntadoPor: datos.apuntadoPor,
    creadoEn: new Date().toISOString(),
    estado: 'pendiente',
  };
  a.apuntes.push(apunte);
  guardar();
  log('Compras', `Apuntado ${apunte.id}: ${apunte.cantidad} × ${apunte.producto}`);
  return apunte;
}

export function pendientes(): Apunte[] {
  return cargar().apuntes.filter(a => a.estado === 'pendiente');
}

export function cancelarApunte(id: string): Apunte | null {
  const a = cargar().apuntes.find(x => x.id === id && x.estado === 'pendiente');
  if (!a) return null;
  a.estado = 'cancelado';
  guardar();
  return a;
}

export function buscarApunte(id: string): Apunte | undefined {
  return cargar().apuntes.find(a => a.id === id);
}

// ── Agrupación por proveedor ──────────────────────────────────────────────────

export interface GrupoProveedor {
  proveedorId?: string;
  proveedorNombre: string;
  proveedorEmail?: string;
  lineas: Array<{ producto: string; sku?: string; cantidad: number; notas: string[]; ids: string[] }>;
}

// Junta lo pendiente por proveedor y suma las cantidades del mismo artículo:
// si tres personas apuntan coca-colas en dos semanas, va una sola línea.
export function agruparPorProveedor(): GrupoProveedor[] {
  const grupos = new Map<string, GrupoProveedor>();

  for (const a of pendientes()) {
    const aprendido = a.proveedorId ? undefined : proveedorDe(a.producto, a.sku);
    const id = a.proveedorId ?? aprendido?.proveedorId;
    const nombre = a.proveedorNombre ?? aprendido?.proveedorNombre ?? 'Sin proveedor';
    const email = aprendido?.proveedorEmail;

    const g = grupos.get(nombre) ?? {
      ...(id ? { proveedorId: id } : {}),
      proveedorNombre: nombre,
      ...(email ? { proveedorEmail: email } : {}),
      lineas: [],
    };
    const k = clave(a.producto, a.sku);
    const linea = g.lineas.find(l => clave(l.producto, l.sku) === k);
    if (linea) {
      linea.cantidad += a.cantidad;
      if (a.nota) linea.notas.push(a.nota);
      linea.ids.push(a.id);
    } else {
      g.lineas.push({
        producto: a.producto, ...(a.sku ? { sku: a.sku } : {}),
        cantidad: a.cantidad, notas: a.nota ? [a.nota] : [], ids: [a.id],
      });
    }
    grupos.set(nombre, g);
  }

  // "Sin proveedor" al final: es lo que hay que resolver a mano.
  return [...grupos.values()].sort((a, b) =>
    a.proveedorNombre === 'Sin proveedor' ? 1
      : b.proveedorNombre === 'Sin proveedor' ? -1
        : a.proveedorNombre.localeCompare(b.proveedorNombre));
}

export function textoBorrador(grupos: GrupoProveedor[]): string {
  if (!grupos.length) return 'No hay nada apuntado para pedir.';
  let txt = '🛒 *BORRADOR DE PEDIDOS*\n\n';
  for (const g of grupos) {
    txt += `— ${g.proveedorNombre} —`;
    if (!g.proveedorEmail && g.proveedorNombre !== 'Sin proveedor') txt += ' ⚠️ sin email';
    txt += '\n';
    for (const l of g.lineas) {
      txt += `  ${l.cantidad} × ${l.producto}\n`;
      for (const n of l.notas) txt += `      · ${n}\n`;
    }
    txt += '\n';
  }
  return txt.trimEnd();
}

// Marca como pedido lo que ha salido en un envío.
export function marcarPedidos(ids: string[], fecha: string): void {
  const a = cargar();
  for (const ap of a.apuntes) {
    if (ids.includes(ap.id) && ap.estado === 'pendiente') {
      ap.estado = 'pedido';
      ap.pedidoEn = fecha;
    }
  }
  guardar();
}

// ── Cada dos semanas ──────────────────────────────────────────────────────────

export function ultimoBorrador(): string | undefined {
  return cargar().ultimoBorrador;
}

export function anotarBorrador(fecha: string): void {
  cargar().ultimoBorrador = fecha;
  guardar();
}

// El job corre todos los miércoles, pero el borrador es quincenal: solo toca
// si han pasado al menos 13 días desde el último. Contar semanas pares del
// calendario fallaría al reiniciar o si un miércoles se salta.
export function tocaBorrador(hoy: string): boolean {
  const ultimo = ultimoBorrador();
  if (!ultimo) return true;
  const dias = (Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${ultimo}T00:00:00Z`)) / 86400000;
  return dias >= 13;
}

// Solo para tests.
export function _reset(): void { cache = null; }
