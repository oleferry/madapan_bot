# -*- coding: utf-8 -*-
"""Extractor de facturas de proveedor.

Un solo extractor para los nueve proveedores. Se probo antes el camino de
escribir un parser por proveedor, anclado en las coordenadas de las columnas,
y no aguanta: solo Sucaspan usa cuatro maquetaciones distintas entre nueve
facturas, y las columnas se desplazan lo bastante como para pegar la cantidad
al precio (un "1" y un "7.05" acababan siendo "17.05") sin que el cuadre
aritmetico lo detecte.

Aqui el PDF se le da al modelo:
  - si tiene capa de texto, se manda el texto (barato)
  - si es un escaneo, se renderiza la pagina y se manda como imagen

El mismo extractor sirve luego para las fotos de albaranes.
"""
import base64
import json
import os
import pathlib

import fitz  # PyMuPDF
from anthropic import Anthropic

MODELO = "claude-sonnet-5"
UMBRAL_TEXTO = 120      # menos caracteres que esto = escaneo
MAX_PAGINAS = 4

ESQUEMA = {
    "name": "factura",
    "description": "Datos extraidos de una factura de proveedor",
    "input_schema": {
        "type": "object",
        "properties": {
            "proveedor": {"type": "string", "description": "Nombre fiscal del proveedor que emite"},
            "nif_proveedor": {"type": "string"},
            "num_factura": {"type": "string"},
            "fecha_factura": {"type": "string", "description": "AAAA-MM-DD"},
            "albaranes": {
                "type": "array",
                "description": "Numeros de albaran referenciados en la factura, si los hay",
                "items": {"type": "string"},
            },
            "base_imponible": {"type": "number"},
            "total": {"type": "number"},
            "lineas": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "codigo": {"type": "string"},
                        "descripcion": {"type": "string"},
                        "cantidad": {"type": "number"},
                        "precio_unitario": {"type": "number"},
                        "descuento_pct": {"type": "number"},
                        "importe": {"type": "number"},
                        "iva_pct": {"type": "number"},
                        "albaran": {"type": "string", "description": "Albaran al que pertenece la linea, si consta"},
                    },
                    "required": ["descripcion", "cantidad", "precio_unitario", "importe"],
                },
            },
        },
        "required": ["proveedor", "num_factura", "fecha_factura", "lineas"],
    },
}

INSTRUCCIONES = """Extrae los datos de esta factura de proveedor de una panaderia.

Reglas:
- El PROVEEDOR es quien EMITE la factura, normalmente arriba con su logo.
  El destinatario es siempre "Semilla Empresarial, S.L." (o "Madapan"), que
  es NUESTRA empresa: no la pongas nunca como proveedor.
- Solo lineas de PRODUCTO. Nada de portes, totales, bases imponibles,
  subtotales, cuotas de IVA ni recargo de equivalencia.
- precio_unitario es el precio por unidad ANTES de IVA. Debe cumplirse
  cantidad x precio_unitario = importe (salvo descuento en linea).
- Si una cifra es ambigua, prefiere la que haga cuadrar esa multiplicacion.
- Los decimales pueden venir con coma. Devuelvelos como numero.
- Si la factura agrupa lineas por albaran, indica en cada linea a cual
  pertenece.
- Si un campo no aparece, deja cadena vacia o 0. No te lo inventes."""


def _cliente() -> Anthropic:
    clave = os.environ.get("ANTHROPIC_API_KEY")
    if not clave:
        raise RuntimeError("Falta ANTHROPIC_API_KEY en el entorno")
    return Anthropic(api_key=clave)


def _contenido(ruta: pathlib.Path) -> list:
    """Devuelve el contenido para el mensaje: texto si el PDF lo tiene,
    imagenes renderizadas si es un escaneo."""
    doc = fitz.open(ruta)
    try:
        paginas = min(doc.page_count, MAX_PAGINAS)
        texto = "\n".join(doc[p].get_text() for p in range(paginas))
        if len(texto.strip()) >= UMBRAL_TEXTO:
            return [{"type": "text", "text": f"Texto extraido del PDF:\n\n{texto}"}]
        # Escaneo: se renderiza como JPEG. En PNG a 150 ppp una factura
        # escaneada se va por encima del limite de 10 MB por imagen de la API,
        # asi que se baja la resolucion hasta que entre.
        bloques = []
        for p in range(paginas):
            for dpi in (150, 110, 80):
                jpg = doc[p].get_pixmap(dpi=dpi).tobytes("jpg", jpg_quality=80)
                if len(jpg) < 4_500_000:
                    break
            bloques.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/jpeg",
                           "data": base64.b64encode(jpg).decode()},
            })
        return bloques
    finally:
        doc.close()


def extraer(ruta) -> dict:
    """Extrae una factura. Devuelve el dict del esquema, mas metadatos."""
    ruta = pathlib.Path(ruta)
    contenido = _contenido(ruta)
    es_imagen = contenido[0]["type"] == "image"

    r = _cliente().messages.create(
        model=MODELO,
        max_tokens=8000,
        tools=[ESQUEMA],
        tool_choice={"type": "tool", "name": "factura"},
        messages=[{"role": "user", "content": contenido + [{"type": "text", "text": INSTRUCCIONES}]}],
    )
    datos = next(b.input for b in r.content if b.type == "tool_use")
    datos["_archivo"] = ruta.name
    datos["_via"] = "vision" if es_imagen else "texto"
    datos["_tokens"] = {"entrada": r.usage.input_tokens, "salida": r.usage.output_tokens}
    return datos


def cuadra(datos: dict, tolerancia: float = 0.02) -> list:
    """Devuelve las lineas cuyo cantidad x precio no coincide con el importe.
    Es la comprobacion que separa una extraccion buena de una plausible."""
    malas = []
    for l in datos.get("lineas", []):
        esperado = l["cantidad"] * l["precio_unitario"]
        dto = l.get("descuento_pct") or 0
        if dto:
            esperado *= (1 - dto / 100)
        if abs(esperado - l["importe"]) > tolerancia:
            malas.append(l)
    return malas


if __name__ == "__main__":
    import sys
    d = extraer(sys.argv[1])
    malas = cuadra(d)
    print(json.dumps(d, ensure_ascii=False, indent=1)[:3000])
    print(f"\nlineas: {len(d['lineas'])} | no cuadran: {len(malas)} | via: {d['_via']}")
