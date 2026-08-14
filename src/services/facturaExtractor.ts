import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { log, warn } from '../utils/logger';

// Extracción de facturas y albaranes de proveedor con Claude.
//
// Es el equivalente en TypeScript de scripts/facturas/extractor.py, que se usa
// para procesar en lote el histórico del Drive. Aquí no hace falta PyMuPDF: lo
// que llega del bot es una FOTO (ya es JPEG) o un PDF, y la API acepta los dos
// tal cual.
//
// Por qué un modelo y no un parser posicional: se probó primero anclando las
// columnas por coordenadas y no aguanta. Solo Sucaspan usa cuatro maquetaciones
// distintas, y basta con que una columna se desplace para pegar la cantidad al
// precio (un "1" y un "7.05" acaban siendo "17.05") sin que el cuadre
// aritmético lo detecte.

const MODELO = 'claude-sonnet-5';

export interface LineaDocumento {
  codigo?: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_pct?: number;
  importe: number;
  iva_pct?: number;
  albaran?: string;
}

export interface DocumentoProveedor {
  tipo: 'factura' | 'albaran';
  proveedor: string;            // nombre fiscal
  nombre_comercial?: string;    // el de la marca, si es distinto
  nif_proveedor?: string;
  num_documento: string;
  fecha: string;              // AAAA-MM-DD
  albaranes?: string[];
  base_imponible?: number;
  total?: number;
  lineas: LineaDocumento[];
}

const ESQUEMA: Anthropic.Tool = {
  name: 'documento',
  description: 'Datos extraídos de una factura o albarán de proveedor',
  input_schema: {
    type: 'object',
    properties: {
      tipo: { type: 'string', enum: ['factura', 'albaran'] },
      proveedor: { type: 'string', description: 'Nombre fiscal del proveedor que emite' },
      nombre_comercial: { type: 'string', description: 'Marca o nombre comercial, si difiere del fiscal' },
      nif_proveedor: { type: 'string' },
      num_documento: { type: 'string', description: 'Número de factura o de albarán' },
      fecha: { type: 'string', description: 'AAAA-MM-DD' },
      albaranes: { type: 'array', items: { type: 'string' } },
      base_imponible: { type: 'number' },
      total: { type: 'number' },
      lineas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            codigo: { type: 'string' },
            descripcion: { type: 'string' },
            cantidad: { type: 'number' },
            precio_unitario: { type: 'number' },
            descuento_pct: { type: 'number' },
            importe: { type: 'number' },
            iva_pct: { type: 'number' },
            albaran: { type: 'string' },
          },
          required: ['descripcion', 'cantidad', 'precio_unitario', 'importe'],
        },
      },
    },
    required: ['tipo', 'proveedor', 'num_documento', 'fecha', 'lineas'],
  },
};

const INSTRUCCIONES = `Extrae los datos de este documento de proveedor de una panadería.

Reglas:
- Indica en "tipo" si es una FACTURA o un ALBARÁN de entrega.
- El PROVEEDOR es quien EMITE el documento, normalmente arriba con su logo.
  El destinatario es siempre "Semilla Empresarial, S.L." (o "Madapan"), que es
  NUESTRA empresa: no la pongas nunca como proveedor.
- En "proveedor" pon el nombre FISCAL y, si la marca es distinta, ponla además
  en "nombre_comercial" (por ejemplo, "La Ventosa" factura como "Hijos de
  Valentín Gangoso, S.A."; "DonDomino" como "Soluciones Corporativas IP, S.L.").
- Solo líneas de PRODUCTO. Nada de portes, totales, bases imponibles,
  subtotales, cuotas de IVA ni recargo de equivalencia.
- precio_unitario es el precio por unidad ANTES de IVA. Debe cumplirse
  cantidad x precio_unitario = importe (salvo descuento en línea).
- Si una cifra es ambigua, prefiere la que haga cuadrar esa multiplicación.
- Los decimales pueden venir con coma. Devuélvelos como número.
- Si un campo no aparece, deja cadena vacía o 0. No te lo inventes.`;

let cliente: Anthropic | null = null;
function getCliente(): Anthropic {
  if (!config.anthropicApiKey) throw new Error('Falta ANTHROPIC_API_KEY');
  cliente ??= new Anthropic({ apiKey: config.anthropicApiKey });
  return cliente;
}

// La API rechaza imágenes de más de 10 MB. Las fotos que manda Telegram son
// muy inferiores, pero un PDF escaneado puede pasarse.
const MAX_BYTES = 9_500_000;

export async function extraerDocumento(
  fichero: Buffer,
  mimeType: string
): Promise<DocumentoProveedor> {
  if (fichero.length > MAX_BYTES) {
    throw new Error(`El fichero pesa ${(fichero.length / 1e6).toFixed(1)} MB; el máximo es 9,5 MB`);
  }

  const datos = fichero.toString('base64');
  const bloque: Anthropic.ContentBlockParam = mimeType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: datos } }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: (mimeType === 'image/png' ? 'image/png' : 'image/jpeg'),
          data: datos,
        },
      };

  const r = await getCliente().messages.create({
    model: MODELO,
    max_tokens: 8000,
    tools: [ESQUEMA],
    tool_choice: { type: 'tool', name: 'documento' },
    messages: [{ role: 'user', content: [bloque, { type: 'text', text: INSTRUCCIONES }] }],
  });

  const uso = r.content.find(b => b.type === 'tool_use');
  if (!uso || uso.type !== 'tool_use') {
    throw new Error('El modelo no devolvió datos estructurados');
  }
  log('FacturaExtractor', `${mimeType}: ${r.usage.input_tokens} tokens de entrada`);
  return uso.input as unknown as DocumentoProveedor;
}

// Comprobación aritmética: es lo que separa una extracción buena de una
// simplemente plausible. Si una línea no cuadra, se avisa al staff en vez de
// archivar en silencio un dato inventado.
export function lineasQueNoCuadran(doc: DocumentoProveedor, tolerancia = 0.02): LineaDocumento[] {
  return (doc.lineas ?? []).filter(l => {
    let esperado = l.cantidad * l.precio_unitario;
    if (l.descuento_pct) esperado *= 1 - l.descuento_pct / 100;
    return Math.abs(esperado - l.importe) > tolerancia;
  });
}

// Nombre de archivo pedido: "Proveedor + nº documento + fecha".
// Se limpia lo que Drive o Windows no admiten en un nombre.
//
// Para el nombre se usa la MARCA cuando la hay ("DonDomino", no "Soluciones
// Corporativas IP, S.L."): es como está archivado hoy el histórico y como se
// busca en el Drive. El nombre fiscal se conserva en los datos extraídos, que
// es donde hace falta para cotejar precios.
export function nombreArchivo(doc: DocumentoProveedor): string {
  const limpio = (s: string): string =>
    (s || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  const proveedor = limpio(doc.nombre_comercial ?? '') || limpio(doc.proveedor) || 'Proveedor desconocido';
  const num = limpio(doc.num_documento) || 's-n';
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(doc.fecha ?? '') ? doc.fecha : 'sin-fecha';
  return `${proveedor} ${num} ${fecha}.pdf`;
}

// Mes de archivo: el de la FECHA DEL DOCUMENTO, no el de hoy. Una factura de
// fin de mes que llega en papel días después tiene que archivarse en su mes.
export function mesDelDocumento(doc: DocumentoProveedor): { anio: string; mes: string } {
  const m = /^(\d{4})-(\d{2})/.exec(doc.fecha ?? '');
  if (!m) {
    warn('FacturaExtractor', `Documento sin fecha válida ("${doc.fecha}"), se archiva en el mes actual`);
    const hoy = new Date();
    return { anio: String(hoy.getFullYear()), mes: String(hoy.getMonth() + 1).padStart(2, '0') };
  }
  return { anio: m[1]!, mes: m[2]! };
}
