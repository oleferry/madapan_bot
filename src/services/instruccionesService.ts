import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { log } from '../utils/logger';
import * as ps from './pedidosSemanaService';
import * as historico from './historicoVentas';

// Interpreta un mensaje suelto del tipo "reducir Villacarralón a 4 panes y 12
// barras, y no abren los lunes" y lo convierte en cambios concretos sobre la
// pestaña Pedidos_semana.
//
// El modelo SOLO interpreta: no toca nada. Devuelve operaciones, se calculan
// los cambios contra lo que hay hoy en la hoja, y se enseñan para que una
// persona los apruebe. Todo lo que no se entienda con seguridad sale marcado
// como duda en vez de resolverse a ojo.

const MODELO = 'claude-sonnet-5';

export type TipoOperacion = 'fijar' | 'quitar' | 'cerrar' | 'media_historica';

export interface Operacion {
  punto: string;
  tipo: TipoOperacion;
  producto?: string;
  cantidad?: number;
  dias?: string[];              // vacío = todos los días
  temporal?: boolean;           // "solo la semana que viene"
  literal: string;              // el trozo del mensaje del que sale
}

const ESQUEMA: Anthropic.Tool = {
  name: 'instrucciones',
  description: 'Operaciones sobre los pedidos semanales que pide el mensaje',
  input_schema: {
    type: 'object',
    properties: {
      operaciones: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            punto: { type: 'string', description: 'Nombre del punto de entrega tal y como aparece en el mensaje' },
            tipo: {
              type: 'string',
              enum: ['fijar', 'quitar', 'cerrar', 'media_historica'],
              description: 'fijar: poner una cantidad concreta. quitar: dejar de llevar ese producto. ' +
                'cerrar: no se sirve nada esos días. media_historica: usar la media de lo que se llevaba antes.',
            },
            producto: { type: 'string', description: 'Producto, tal y como lo dice el mensaje. Vacío si aplica a todo.' },
            cantidad: { type: 'number' },
            dias: {
              type: 'array',
              items: { type: 'string' },
              description: 'Días afectados en minúsculas (lunes, martes...). Vacío = todos los días.',
            },
            temporal: { type: 'boolean', description: 'true si el mensaje dice que es solo para una semana concreta' },
            literal: { type: 'string', description: 'Trozo literal del mensaje del que sale esta operación' },
          },
          required: ['punto', 'tipo', 'literal'],
        },
      },
    },
    required: ['operaciones'],
  },
};

const INSTRUCCIONES = `Eres el ayudante de una panadería. Te llega un mensaje con cambios para los
pedidos de la semana. Conviértelo en operaciones.

Reglas:
- Una operación por cada cosa que pida el mensaje.
- "no abren los lunes" o "seguirá cerrado" → tipo "cerrar", con los días.
  Si no dice días, es toda la semana.
- "quitar los panes integrales" → tipo "quitar" con el producto.
- "reducir a 4 panes, 12 barras" → una operación "fijar" por cada producto.
- "la cantidad media que les llevábamos antes de agosto" → "media_historica".
- Copia el producto TAL CUAL lo dice el mensaje, sin traducirlo ni
  completarlo. Si dice "panes", pon "panes".
- Marca temporal=true solo si el mensaje dice explícitamente que es para una
  semana concreta ("la semana que viene", "esta semana").
- No inventes operaciones que el mensaje no pida.`;

let cliente: Anthropic | null = null;
function getCliente(): Anthropic {
  if (!config.anthropicApiKey) throw new Error('Falta ANTHROPIC_API_KEY');
  cliente ??= new Anthropic({ apiKey: config.anthropicApiKey });
  return cliente;
}

export async function interpretar(mensaje: string): Promise<Operacion[]> {
  const r = await getCliente().messages.create({
    model: MODELO,
    max_tokens: 2000,
    tools: [ESQUEMA],
    tool_choice: { type: 'tool', name: 'instrucciones' },
    messages: [{ role: 'user', content: `${INSTRUCCIONES}\n\nMensaje:\n${mensaje}` }],
  });
  const uso = r.content.find(b => b.type === 'tool_use');
  if (!uso || uso.type !== 'tool_use') throw new Error('No he podido interpretar el mensaje');
  const ops = (uso.input as { operaciones?: Operacion[] }).operaciones ?? [];
  log('Instrucciones', `${ops.length} operaciones interpretadas`);
  return ops;
}

export interface Plan {
  cambios: ps.Cambio[];
  dudas: string[];
  avisos: string[];
}

// Convierte las operaciones en cambios concretos. Nada que no se pueda resolver
// con certeza se convierte en duda: es preferible que una persona lo mire a
// que el bot escriba un número inventado en la hoja de producción.
export async function construirPlan(ops: Operacion[], filas: ps.FilaPedido[]): Promise<Plan> {
  const cambios: ps.Cambio[] = [];
  const dudas: string[] = [];
  const avisos: string[] = [];

  for (const op of ops) {
    const puntos = ps.buscarPunto(filas, op.punto);
    if (puntos.length === 0) {
      dudas.push(`No encuentro ningún punto que se llame "${op.punto}" (${op.literal})`);
      continue;
    }
    if (puntos.length > 1) {
      dudas.push(`"${op.punto}" encaja con varios puntos: ${puntos.join(', ')} (${op.literal})`);
      continue;
    }
    const punto = puntos[0]!;
    const suyas = filas.filter(f => f.punto === punto);
    const dias = (op.dias ?? []).filter(Boolean);
    const enDia = (f: ps.FilaPedido): boolean =>
      dias.length === 0 || dias.some(d => ps.esMismoDia(d, f.dia));

    if (op.temporal) {
      avisos.push(
        `"${op.literal}" es un cambio temporal, pero la hoja solo tiene la base ` +
        'recurrente: quedará puesto para todas las semanas hasta que se revierta.'
      );
    }

    if (op.tipo === 'cerrar') {
      for (const f of suyas.filter(enDia)) {
        if (f.cantidad === 0) continue;
        cambios.push({ ...f, actual: f.cantidad, nuevo: 0, motivo: 'cerrado' });
      }
      continue;
    }

    // A partir de aquí hace falta saber de qué producto se habla.
    const candidatos = op.producto ? ps.buscarProducto(filas, punto, op.producto) : [];
    if (op.tipo === 'quitar' || op.tipo === 'fijar') {
      if (!op.producto) {
        dudas.push(`No sé a qué producto se refiere "${op.literal}" en ${punto}`);
        continue;
      }
      if (candidatos.length === 0) {
        dudas.push(`${punto} no lleva nada que se parezca a "${op.producto}" (${op.literal})`);
        continue;
      }
      if (candidatos.length > 1) {
        // "4 panes" cuando llevan pan de cuadros Y pan pequeño: no se adivina.
        dudas.push(
          `"${op.producto}" en ${punto} puede ser: ${candidatos.join(' o ')} (${op.literal})`
        );
        continue;
      }
      const producto = candidatos[0]!;
      const objetivo = op.tipo === 'quitar' ? 0 : op.cantidad;
      if (objetivo === undefined || objetivo === null || isNaN(objetivo)) {
        dudas.push(`No entiendo qué cantidad poner en "${op.literal}"`);
        continue;
      }
      const afectadas = suyas.filter(f => f.producto === producto && enDia(f));
      const aCambiar = afectadas.filter(f => f.cantidad !== objetivo);
      for (const f of aCambiar) {
        cambios.push({
          ...f, actual: f.cantidad, nuevo: objetivo,
          motivo: op.tipo === 'quitar' ? 'ya no lo llevan' : 'cantidad nueva',
        });
      }
      // Que no salga en la lista de cambios no significa que se haya ignorado:
      // puede que ya estuviera así. Mejor decirlo que dejar la duda.
      if (afectadas.length && !aCambiar.length) {
        avisos.push(`${punto}: ${producto} ya estaba en ${objetivo}, no hace falta tocarlo.`);
      }
      continue;
    }

    if (op.tipo === 'media_historica') {
      const entregas = await historico.cargar();
      const nombreHistorico = emparejarConHistorico(punto, entregas);
      if (!nombreHistorico) {
        dudas.push(`No encuentro histórico de entregas de ${punto} (${op.literal})`);
        continue;
      }
      // "antes de agosto": se usa lo servido hasta el 31 de julio.
      const hasta = '2026-08-01';
      const objetivoDias = dias.length ? dias : ps.DIAS;
      let algo = false;
      for (const d of objetivoDias) {
        const dow = ps.DIAS.findIndex(x => ps.esMismoDia(x, d));
        if (dow < 0) continue;
        const medias = historico.mediaPorDia(
          entregas.filter(e => e.fecha < hasta), nombreHistorico, dow
        );
        for (const f of suyas.filter(f => ps.esMismoDia(f.dia, d))) {
          const m = medias.find(x => ps.normalizar(x.producto) === ps.normalizar(f.producto));
          if (!m) continue;
          const nuevo = Math.max(0, Math.round(m.media));
          if (nuevo === f.cantidad) continue;
          cambios.push({
            ...f, actual: f.cantidad, nuevo,
            motivo: `media de ${m.dias} ${d}s antes de agosto`,
          });
          algo = true;
        }
      }
      if (!algo) {
        dudas.push(`No hay histórico suficiente de ${punto} para calcular la media (${op.literal})`);
      }
    }
  }

  return { cambios: deduplicar(cambios), dudas, avisos };
}

// Una misma celda puede recibir dos cambios: "Villacarralón a 4 panes" y "no
// abren los lunes" tocan los dos la fila del lunes. Manda el último, que es el
// más específico, y así lo que se enseña coincide con lo que se escribe.
function deduplicar(cambios: ps.Cambio[]): ps.Cambio[] {
  const porFila = new Map<number, ps.Cambio>();
  for (const c of cambios) porFila.set(c.fila, c);
  return [...porFila.values()].filter(c => c.actual !== c.nuevo);
}

// El nombre en la hoja y el de Holded no siempre coinciden literalmente
// ("HORNO SANABRES SL" vs "Horno Sanabrés, S.L."). Se compara sin tildes y por
// la palabra más larga, que es la distintiva.
function emparejarConHistorico(punto: string, entregas: historico.Entrega[]): string | undefined {
  const nombres = [...new Set(entregas.map(e => e.cliente))];
  const n = ps.normalizar(punto);
  const exacto = nombres.find(x => ps.normalizar(x) === n);
  if (exacto) return exacto;
  const palabra = n.split(/[^a-z0-9]+/).filter(p => p.length > 4).sort((a, b) => b.length - a.length)[0];
  if (!palabra) return undefined;
  return nombres.find(x => ps.normalizar(x).includes(palabra));
}

export function textoPlan(plan: Plan): string {
  let txt = '';
  if (plan.cambios.length) {
    txt += '📋 *CAMBIOS PROPUESTOS*\n\n' + ps.textoCambios(plan.cambios) + '\n\n';
  } else {
    txt += 'No sale ningún cambio que aplicar.\n\n';
  }
  if (plan.avisos.length) {
    txt += '⚠️ Ojo:\n' + plan.avisos.map(a => `   · ${a}`).join('\n') + '\n\n';
  }
  if (plan.dudas.length) {
    txt += '❓ Esto no lo he tocado, decídelo tú:\n' + plan.dudas.map(d => `   · ${d}`).join('\n');
  }
  return txt.trim();
}
