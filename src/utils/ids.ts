// Identificador corto para apuntes, encargos, sobras y reversiones.
//
// Antes era solo `prefijo + Date.now()` en base 36, y dos registros creados en
// el mismo milisegundo salían con el MISMO id. Como el id es la clave con la
// que luego se busca y se marca cada registro, marcar uno marcaba también al
// otro. En Windows casi nunca se veía (había milisegundo de sobra entre una
// cosa y otra); en máquinas rápidas salta enseguida.
//
// La parte de milisegundos ocupa siempre 8 caracteres en base 36, así que el
// contador que se añade al final no puede confundirse con el id del siguiente
// milisegundo.

let ultimoMs = 0;
let contador = 0;

export function nuevoId(prefijo: string): string {
  const ahora = Date.now();
  if (ahora === ultimoMs) {
    contador += 1;
  } else {
    ultimoMs = ahora;
    contador = 0;
  }
  const base = `${prefijo}${ahora.toString(36).toUpperCase()}`;
  return contador === 0 ? base : `${base}${contador.toString(36).toUpperCase()}`;
}
