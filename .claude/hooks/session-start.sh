#!/bin/bash
# Deja lista una sesión de Claude Code en la nube: instala las dependencias de
# npm para que `npm test`, `npm run build` y el typecheck funcionen desde el
# primer momento, sin tener que acordarse de lanzar el install a mano.
#
# En local no hace nada: allí ya tienes tu node_modules y tu .env.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# `npm install` y no `npm ci` a propósito: el contenedor se cachea después del
# hook y así los arranques siguientes reaprovechan node_modules.
npm install --no-audit --no-fund

# El bot lee la configuración de .env. En la nube no hay credenciales reales
# (ni las tiene que haber), así que se deja un .env mínimo en DRY_RUN para que
# nada pueda escribir en Holded desde aquí. No se copia .env.example entero
# para no arrastrar valores de ejemplo que luego parezcan configuración real;
# si necesitas más variables, añádelas tú a mano (el .env está en .gitignore).
if [ ! -f .env ]; then
  printf 'NODE_ENV=development\nDRY_RUN=true\n' > .env
fi

echo "Entorno de madapan-bot listo."
