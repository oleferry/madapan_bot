# madapan-bot — instrucciones para Claude Code

## Sincronización multi-dispositivo
Este repo se trabaja desde varios equipos Windows distintos.
- Al inicio de sesión: `git fetch origin` + `git pull --rebase` antes de tocar código. Si hay cambios locales sin commitear, avísame primero.
- Si hay conflictos, para y muéstramelos.
- Al terminar una tarea: commit descriptivo en español y `git push`. Confirma que el push ha funcionado. Antes de `git add -A`, comprueba que no se cuela ningún `.env` ni secretos.
- Nunca commitear node_modules, .env, dist ni build.

## Sesiones en la nube
- La nube es un equipo más: mismo flujo de `git pull --rebase` al empezar y
  commit + push al terminar. El contenedor es efímero, lo no empujado se pierde.
- El hook `.claude/hooks/session-start.sh` instala las dependencias solo cuando
  `CLAUDE_CODE_REMOTE=true`; en local no hace nada.
- En la nube no hay credenciales reales y el `.env` va en `DRY_RUN=true`. No
  pidas ni pegues claves de Holded, Telegram o Google en una sesión de nube.

