# madapan-bot — instrucciones para Claude Code

## Sincronización multi-dispositivo
Este repo se trabaja desde varios equipos Windows distintos.
- Al inicio de sesión: `git fetch origin` + `git pull --rebase` antes de tocar código. Si hay cambios locales sin commitear, avísame primero.
- Si hay conflictos, para y muéstramelos.
- Al terminar una tarea: commit descriptivo en español y `git push`. Confirma que el push ha funcionado. Antes de `git add -A`, comprueba que no se cuela ningún `.env` ni secretos.
- Nunca commitear node_modules, .env, dist ni build.
