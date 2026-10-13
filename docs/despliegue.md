# Despliegue: staging, ensayo de migración y rollback

Este documento es el procedimiento ejecutable de la Fase 9 (staging, rollback
documentado, alertas) y el campo de ensayo de migraciones con datos (futura
Fase 4 si una clínica trae datos; la actual no tiene). Todo lo que dice
«ejecuta» está probado tal cual en Windows + Docker Desktop; si algo no
cuadra, es un bug del documento, no del lector.

> Procedimiento de copias (origen de varios pasos de aquí):
> [docs/backups.md](backups.md).

---

## 0. Mapa del kit

| Pieza | Dónde | Para qué |
|---|---|---|
| API en contenedor | `backend/Dockerfile` (objetivos `runtime` y `herramientas`) | Servir tráfico / operaciones puntuales |
| Web en contenedor | `frontend/Dockerfile` + `frontend/nginx.conf` | Estáticos + proxy `/api` → backend |
| Stack | `compose.staging.yml` + `.env.staging` (desde `.env.staging.example`) | Staging completo con su base y sus volúmenes |
| Respaldo base/archivos | `npm run db:backup`, `npm run archivos:backup` | §5 |
| Vigilancia | `npm run vigilancia` (`backend/scripts/vigilancia.mjs`) | §6 |
| Timers Linux | `deploy/systemd/dental-saas-*.service/.timer` | §5 |
| Ensayo migración | `npm run db:migrar-clinica` | §3 (en seco primero) |

Decisiones que afectan a este documento (no las cambies sin leerlas):

- **`TRUST_PROXY` es variable** (`backend/src/main.ts`): 2 con CDN+proxy
  (producción), **1 detrás del nginx de este compose**, 0 con API directa.
  Un valor mayor que los saltos reales degrada el rate limit por IP a un cubo
  compartido y ensucia la IP de auditoría. El arranque falla si no es válido.
- **`db:seed` corre con `tsx` también en producción**, dentro del objetivo
  `herramientas` (lleva las devDeps y el cliente Postgres). El `runtime` que
  sirve tráfico NO lleva `tsx` ni el CLI de Prisma: no se compilan los seeds
  a `dist/` para no mantener dos procedimientos.
- **Base `node:22-slim`, no alpine**: los motores de Prisma y `argon2`/`bcrypt`
  necesitan glibc; en alpine el arranque falla de formas crípticas.
- El frontend se construye con `VITE_API_URL` vacía: el navegador usa `/api`
  relativo y lo resuelve el nginx del compose (sin CORS que configurar).

---

## 1. Primera puesta en marcha del staging

Requisitos: Docker con plugin compose, y libres los puertos 5434 (pg), 3001
(API) y 8080 (web). No toca el desarrollo: proyecto `dental-staging`
(contenedores `dental-staging-*`), volúmenes `staging-*` y esos puertos están
fuera del rango de dev (5433, 3000, 5173, 3100).

```powershell
# Desde la raíz del repo. PowerShell; en bash es idéntico salvo el §3.
Copy-Item .env.staging.example .env.staging
# Rellenar los 4 SECRETOS en .env.staging (sin ellos, falla al levantar):
#   STAGING_DB_PASSWORD, JWT_SECRET, PLATFORM_OWNER_PASSWORD, DEMO_OWNER_PASSWORD

docker compose -f compose.staging.yml config --quiet
docker compose -f compose.staging.yml up -d --build
```

Todos los comandos de este documento usan
`docker compose --env-file .env.staging -f compose.staging.yml ...` (las
credenciales viven SOLO en `.env.staging`, nunca en el compose).

```powershell
$dc = "docker compose --env-file .env.staging -f compose.staging.yml"
iex "$dc up -d --build"
iex "$dc run --rm herramientas npx prisma migrate deploy"
iex "$dc run --rm herramientas npm run db:seed"
iex "$dc run --rm herramientas npm run db:seed-demo"
```

> **Si la migración cambia el esquema, reconstruye ANTES las imágenes.** El cliente de
> Prisma va DENTRO de la imagen, así que un contenedor con el cliente viejo frente a un
> esquema nuevo responde 400 en los campos recién añadidos (pasó con `PATCH /sedes/:id
> {"activo":false}` tras la migración `5_sede_activo`). El orden es **build → migrate**.

Comprobación (puertos y salud):

```powershell
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:8080/api/health
iex "$dc ps"
```

`/api/health` responde `{"status":"ok","database":"ok"}` tanto directo (3001)
como a través del proxy (8080). Si `database` dice `error`, la API levantó
pero no conecta: revisa `STAGING_DB_PASSWORD`.

Para tirar el stack sin perder datos: `iex "$dc down"` (los volúmenes
`staging-*` sobreviven; solo `down -v` los borra).

---

## 2. Qué usa el stack

| Servicio | Imagen | Puerto host | Volumen | Salud |
|---|---|---|---|---|
| `db` | `postgres:16` | `${STAGING_POSTGRES_PORT:-5434}` → 5432 | `staging-pgdata` | `pg_isready` |
| `backend` | `dental-api:staging` (build local) | `${STAGING_API_PORT:-3001}` → 3000 | `staging-uploads` → `/app/uploads` | `/api/health` (arranque ordenado tras `db`) |
| `proxy` | `dental-web:staging` (build local) | `${STAGING_WEB_PORT:-8080}` → 80 | — | tras `backend` sano |
| `herramientas` | `dental-herramientas:staging` (perfil, no arranca con `up`) | — | `staging-uploads` + `staging-backups` → `/app/backups` | tras `db` sana |

Sin `staging-uploads`, cada redespliegue borraría radiografías, PDFs y firmas
(deuda nº 13 vista desde el despliegue: el volumen la cubre; el almacenamiento
de objetos sigue siendo la opción estratégica). `staging-backups` es el
`BACKUP_DIR` propio del staging: los volcados de ensayo no se mezclan con los
de desarrollo.

---

## 3. Ensayo de una migración con datos (futuras clínicas, sin tocar producción)

> NO es un paso del lanzamiento: la clínica actual no tiene datos que migrar
> (ver Fase 4 en `dental-saas-arquitectura-v2.md`). Esto se conserva como
> procedimiento para una clínica futura que SÍ traiga datos. NO ejecutes la
> migración real aquí: esto PREPARA el ensayo. La migración la corre un humano
> cuando toque, siguiendo estos mismos pasos.

Supuestos: el stack de staging levantado (§1) y una copia de producción
accesible. `PG_DOCKER_CONTAINER` apunta al postgres de staging para que los
scripts usen `docker exec`/`docker cp` sin cliente local.

```powershell
cd backend
$env:PG_DOCKER_CONTAINER = "dental-staging-db-1"
$env:DATABASE_URL = "postgresql://postgres:<clave-staging>@127.0.0.1:5434/dental_saas_staging?sslmode=disable"
$env:BACKUP_DIR = ".\backups-staging"
```

**Paso 1 — Volcar producción** (en la máquina que alcance a producción; el
volcado incluye `_prisma_migrations` y su manifiesto, ver `backups.md`):

```powershell
$env:DATABASE_URL = "<URL-de-produccion>"
$env:BACKUP_DIR = ".\backups-produccion"
npm run db:backup
```

**Paso 2 — Restaurarla en staging**, en una base de ensayo aparte (NO se pisa
la base de staging: así el ensayo es repetible y el staging sigue sirviendo
la demo):

```powershell
$env:DATABASE_URL = "postgresql://postgres:<clave-staging>@127.0.0.1:5434/dental_saas_staging?sslmode=disable"
npm run db:restaurar -- --archivo .\backups-produccion\<volcado>.dump --destino dental_saas_ensayo --confirmo-restauracion
```

El script se niega a restaurar sobre la base de `DATABASE_URL` y a destinos
no vacíos; al terminar imprime recuentos por tabla.

**Paso 3 — Migración en seco** (no escribe nada; lee el informe entero,
incluidos los avisos de suscripción/entitlements):

```powershell
npm run db:migrar-clinica -- --source "postgresql://postgres:<clave-staging>@127.0.0.1:5434/dental_saas_ensayo?sslmode=disable" --target "postgresql://postgres:<clave-staging>@127.0.0.1:5434/dental_saas_staging?sslmode=disable" --slug <slug-clinica> --dry-run
```

**Paso 4 — Migración de verdad contra staging** (con el backup verificado) y
verificación con recuentos (el `smoke:arranque` cubre la base demo, no el
tenant migrado; para el migrado valen `--solo-verificar` + lectura por API):

```powershell
npm run db:migrar-clinica -- --source "postgresql://postgres:<clave-staging>@127.0.0.1:5434/dental_saas_ensayo?sslmode=disable" --target "postgresql://postgres:<clave-staging>@127.0.0.1:5434/dental_saas_staging?sslmode=disable" --slug <slug-clinica> --confirmo-produccion --backup-verificado .\backups-produccion\<volcado>.dump.manifiesto.json
npm run db:migrar-clinica -- --source "postgresql://postgres:<clave-staging>@127.0.0.1:5434/dental_saas_ensayo?sslmode=disable" --target "postgresql://postgres:<clave-staging>@127.0.0.1:5434/dental_saas_staging?sslmode=disable" --slug <slug-clinica> --solo-verificar
# Y por API: login del admin migrado, GET /api/pacientes con su X-Tenant-Id,
# y una descarga de documento (prueba que los uploads migrados se leen).
```

Si la migración trae archivos, se copian con `--uploads-origen <copia-de-prod>`
`--uploads-destino <dir-de-ensayo>` en el mismo comando (ver
`npm run db:migrar-clinica -- --ayuda`).

**Paso 5 — Producción, solo entonces**: con el backup verificado (simulacro
`db:prueba-restauracion` en verde), la ventana de corte y este rollback
preparado (§4).

---

## 4. Rollback (documentado y ensayado)

El rollback es **restaurar el volcado previo + volver a la imagen anterior**.
La base origen de la clínica nunca se toca (la migración solo lee de ella),
así que el plan B siempre existe.

### 4.1 Procedimiento (staging o producción, mismo comando)

```powershell
cd backend
# 1. Congelar escritura: parar la API (o poner mantenimiento).
#    En compose:  docker compose --env-file .env.staging -f compose.staging.yml stop backend proxy
# 2. Restaurar el volcado previo en una base NUEVA y comparar recuentos:
npm run db:restaurar -- --archivo <volcado-previo>.dump --destino <base>_rollback --confirmo-restauracion
# 3. Si los recuentos cuadran, repetir contra la base definitiva
#    (vacía: el script aborta si tiene tablas) o renombrar.
# 4. Volver a la imagen anterior (la que corría antes del despliegue):
#    docker compose ... up -d --no-build   (con el tag anterior fijado)
# 5. npx prisma migrate deploy   (no-op si el volcado traía las migraciones)
# 6. Verificar: /api/health + login + lectura de un paciente y un documento.
# 7. Reabrir el tráfico.
```

### 4.2 Tiempos estimados (medidos, no supuestos)

Base de pruebas con 4658 filas de auditoría (`backups.md`): volcado
408 KB, `pg_restore` **2,9 s**, simulacro completo **3,7 s**. Archivos
(6 ficheros): paquete 112 KB, restauración **0,1 s**. En la práctica suma
descarga del volcado + verificación + corte: **minutos, no horas**. El RTO
crece con el tamaño: **re-mide estos números con el volcado real antes del
día del corte** (`db:prueba-restauracion` los imprime) y anota aquí el
resultado.

### 4.3 Qué se pierde (decirlo antes, no después)

- Las escrituras entre el backup previo y el corte (acotado por el RPO: con
  backup diario, como máximo un día; antes de un despliegue se saca backup
  expreso y la ventana tiende a cero).
- Las sesiones con refresh emitido DESPUÉS del backup: el refresh vive en la
  base (`RefreshToken`), así que esos usuarios repiten login. Los access
  tokens son cortos de todos modos.
- Los archivos subidos después del paquete previo (misma cadencia que la
  base: mismo timer, ver §5).

---

## 5. Operación programada

### 5.1 Linux (systemd, el servidor)

```bash
cp deploy/systemd/dental-saas-* /etc/systemd/system/
# /etc/dental-saas/backend.env (chmod 600, solo root) con:
#   DATABASE_URL=...  BACKUP_DIR=/var/backups/dental-saas
#   BACKUP_RETENCION_DIAS=14  UPLOADS_DIR=/opt/dental-saas/uploads
#   PG_DUMP_BIN=/usr/bin/pg_dump  PG_RESTORE_BIN=/usr/bin/pg_restore
#   VIGILANCIA_API_URL=http://127.0.0.1:3000
#   RESPALDO_REMOTO=/mnt/respaldos  (o `b2:bucket/dental-saas`; sin él,
#     el servicio de copia externa falla a propósito)
systemctl daemon-reload
systemctl enable --now dental-saas-db-backup.timer
systemctl enable --now dental-saas-archivos-backup.timer
systemctl enable --now dental-saas-backup-remoto.timer
systemctl enable --now dental-saas-vigilancia.timer
systemctl list-timers --all | grep dental
journalctl -u dental-saas-db-backup -e
```

Cada servicio vuelca al journal y, si falla, activa
`dental-saas-aviso@.service`: línea `emerg` en el journal + llamada a
`/etc/dental-saas/avisos.sh` si existe (ahí se conecta el canal real; ver
§6 y la deuda pendiente en `deuda-tecnica.md`).

### 5.2 Windows (desarrollo; el equivalente documentado)

```powershell
# Respaldo diario de la base (03:00) y de archivos (03:30), como SYSTEM:
schtasks /create /tn "DentalBackupDB" /tr "npm run db:backup" /sc daily /st 03:00 /ru SYSTEM /f
schtasks /create /tn "DentalBackupArchivos" /tr "npm run archivos:backup" /sc daily /st 03:30 /ru SYSTEM /f
# Ojo: schtasks no avisa si el comando sale != 0; la vigilancia (§6) es la
# que detecta la ausencia de volcados recientes. Revisa BACKUP_DIR cada semana.
```

Las variables (`DATABASE_URL`, `BACKUP_DIR`...) las resuelve el `.env` del
`WorkingDirectory`... con `schtasks` no hay WorkingDirectory: usa la forma
PowerShell con `-WorkingDirectory "E:\SAAS\backend"` si necesitas `.env`
(ver `backups.md` §4), o define las variables en el entorno del sistema.

---

## 6. Vigilancia mínima (`npm run vigilancia`)

Sin dependencias nuevas (usa `pg`, que ya es dependencia): comprueba
`/api/health`, cuenta `FAILURE` en `Auditoria` en la ventana y busca la
marca `acceso_cruzado`. Imprime informe y sale **0 OK / 1 revisar /
2 crítico**.

```powershell
cd backend
$env:DATABASE_URL = "postgresql://postgres:test@127.0.0.1:5433/dental_saas_test?sslmode=disable"
npm run vigilancia
# Contra el staging: VIGILANCIA_API_URL=http://127.0.0.1:3001
```

Variables: `VIGILANCIA_API_URL`, `VIGILANCIA_SOLO_BD=1` (solo BD, útil en
local), `VIGILANCIA_VENTANA_HORAS` (24), `VIGILANCIA_MAX_FALLOS_PCT` (5),
`VIGILANCIA_MAX_CRUZADOS` (0: cualquier intento de acceso cruzado es
crítico, mejora #21).

Límites honestos (están en la cabecera del script): `Auditoria` solo guarda
mutaciones críticas, así que un 500 en un GET no deja fila (la señal completa
de 5xx vive en los logs: `docker compose logs backend` / journal); y los
403/404 normales NO cuentan como acceso cruzado (la señal es la marca
explícita, no el código). Los 401/403 de guard tampoco dejan fila (deuda
nº 1).

---

## 7. Copia fuera del servidor

El mecanismo existe (`npm run db:backup-remoto`, ver `backups.md` §9:
verificación sha256, simulacro de cadena en CI, timer 04:00 y vigilancia de
antigüedad). Lo que sigue pendiente es el **destino de producción**: contratar
o montar el disco/remoto, definir `RESPALDO_REMOTO` en el entorno del servidor
(`rclone config` antes si es un remoto `rclone`) y probar la restauración
desde él. Detalle en `deuda-tecnica.md` (nº 14).

---

## 8. Producción (diferencias con staging)

- `TRUST_PROXY=2` (CDN + proxy; en staging es 1).
- `FRONTEND_URL` con el dominio real (CORS); en staging va vacío.
- `JWT_SECRET` largo y único (el arranque falla si falta o es corto).
- NO correr `db:seed-demo` en producción (solo `db:seed` + `migrate deploy`).
- Imagen fijada por tag/digest (`dental-api:<version>`, no `staging`), y el
  tag anterior a mano para el rollback (§4.1 paso 4).
- `BACKUP_DIR` en disco del servidor + copia externa (§7) + timers (§5.1).
- El primer cliente se da de alta desde el panel y empieza de cero (NO hay
  migración en el lanzamiento): su primer día está guiado en
  [docs/primeros-pasos-clinica.md](primeros-pasos-clinica.md).

Checklist previo al corte: suite verde, simulacro de restauración verde,
backup expreso verificado, rollback preparado (§4), ventana comunicada.
(El "ensayo de migración en staging" solo aplica si una clínica trae datos.)

---

## 9. Secretos

Nunca al repo: ni `.env`, ni `.env.staging`, ni claves en el compose (los
`*-password` del ejemplo van vacíos). `.env.staging.example` SÍ se versiona
(es la plantilla). Si un secreto llega a git, se rota (no basta con
revertir el commit).
