# Incidentes en producción

> Procedimiento para cuando algo falla con datos reales. Se apoya en
> [despliegue.md](despliegue.md), [backups.md](backups.md),
> [render-vercel-supabase.md](render-vercel-supabase.md),
> [izipay-suscripcion.md](izipay-suscripcion.md) y
> [deuda-tecnica.md](deuda-tecnica.md). Los comandos y rutas son los de esa
> documentación; si algo no coincide, primero se corrige el documento, no se
> improvisa en caliente.

**Regla de oro:** durante el diagnóstico no se despliega, no se migra, no se
ejecuta `db:seed`/`db:seed-demo`, no se restaura sobre la base en uso y no se
borra nada. Primero se acota el fallo y se conserva la evidencia; después se
decide la acción. Un reinicio o un rollback a ciegas convierte un incidente
diagnosticable en una pérdida de datos.

---

## 1. Primeros cinco minutos (en este orden)

### 0:00–0:30 — Confirmar y acotar

- Quién lo reporta, a qué hora, en qué pantalla y con qué acción.
- ¿Falla una clínica o todas? ¿Un usuario o todos? ¿Solo web, solo API, también
  la IPN de Izipay?
- Código HTTP y mensaje exacto. Captura o texto, sin datos de pacientes.
- ¿Coincide con un despliegue, migración, cambio de variable o incidencia del
  proveedor (Render/Vercel/Supabase/Izipay)?
- Abrir la bitácora del incidente con hora, responsable y una línea de impacto.
  Todo lo que se pruebe se anota con hora y resultado, incluido lo que no
  reprodujo.

No pedir contraseñas, tokens ni el contenido de documentos. Nunca pegar
`DATABASE_URL`, cookies, `ACCESS_TOKEN`, `kr-answer` ni datos de pacientes en el
chat del incidente.

### 0:30–1:30 — Salud directa y a través del proxy

Producción (desde la raíz del repo):

```powershell
$env:API_PUBLIC_URL="https://<api-real>.onrender.com"
$env:FRONTEND_PUBLIC_URL="https://<web-real>.vercel.app"
node deploy/verificar-remoto.mjs health
```

Debe responder `{"status":"ok","database":"ok"}` directamente y a través de
Vercel. Abrir además una ruta profunda como `/admin/clinicas`: no debe dar 404.

Staging/local:

```powershell
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:8080/api/health
cd backend
npm run smoke:arranque
```

Interpretación rápida:

| Resultado | Siguiente paso |
|---|---|
| No responde / 502 / 503 | §2.4 «La API no arranca» |
| `{"status":"ok","database":"error"}` | §2.5 «La base no responde» |
| Responde, pero falla una pantalla concreta | §2.1, §2.2 o §2.3 según el síntoma |
| `database:ok` y todo autenticado da 500 | Revisar que se arrancó con `node dist/main.js` (compilado), no con `tsx` |

### 1:30–2:30 — Vigilancia

```powershell
cd backend
$env:DATABASE_URL = "postgresql://<usuario>:<clave>@<host>:<puerto>/<base>?sslmode=require"
$env:VIGILANCIA_API_URL = "https://<api-real>.onrender.com"
npm run vigilancia
```

Sale **0 OK / 1 revisar / 2 crítico**. Revisa `/api/health`, fallos `FAILURE` de
`Auditoria` en la ventana y la marca `acceso_cruzado`; además informa la
antigüedad de la copia externa más reciente (umbral
`VIGILANCIA_MAX_HORAS_REMOTO`, 48 h por defecto).

- Un `acceso_cruzado` es **crítico por definición** (`VIGILANCIA_MAX_CRUZADOS=0`):
  trátalo como incidente de seguridad, no como bug funcional.
- La vigilancia no ve los 500 de un `GET` (solo se auditan mutaciones críticas) ni
  los 401/403 de los guards (deuda nº 1). Esos se miran en los logs HTTP.

### 2:30–3:30 — Cambios recientes y logs

Preguntas, en este orden:

1. ¿Hubo despliegue en Render o Vercel? ¿Se ejecutó el pre-deploy
   `npm run deploy:migrate`?
2. ¿Se aplicó una migración nueva? ¿Se regeneró el cliente de Prisma?
3. ¿Cambió `JWT_SECRET`, `TRUST_PROXY`, `FRONTEND_URL`, `DATABASE_URL`,
   `DIRECT_URL`, `UPLOADS_DIR` o alguna `IZIPAY_*`?
4. ¿Se reinició la base o el contenedor? ¿Se ejecutó un `down -v`?
5. ¿La clínica reporta un pago o un documento, o es toda la aplicación?

Logs:

```powershell
docker compose logs backend
# Stack de staging:
$dc = "docker compose --env-file .env.staging -f compose.staging.yml"
iex "$dc ps"
iex "$dc logs backend"
```

En Render: **Logs** del Web Service. En Vercel: **Deployments → Functions/Logs**.
Comparar la hora del primer error con la hora del último despliegue o cambio de
variable. No borrar ni rotar logs todavía.

### 3:30–4:30 — Congelar antes de tocar

- **Congelar despliegues y migraciones** hasta tener diagnóstico y backup
  verificado.
- Si hay riesgo de escrituras inconsistentes (restauración, migración a medias,
  corrupción), congelar escritura parando la API o poniendo mantenimiento. En
  compose:

  ```powershell
  docker compose --env-file .env.staging -f compose.staging.yml stop backend proxy
  ```

  En Render, usar el mantenimiento/despliegue detenido del panel; no borrar el
  servicio.
- Antes de cualquier restauración: sacar un volcado **del estado actual** si la
  base responde, y comprobar el manifiesto del volcado que se va a restaurar.
- Conservar: hora, capturas, códigos de error, IDs de transacción
  (`orderId`/`uuid` de Izipay) y nombres de volcado. No copiar payloads crudos
  con datos de pacientes.

### 4:30–5:00 — Clasificar, asignar y comunicar

- Asignar un **responsable del incidente** (una sola voz), un **operador** y un
  **escriba** de la bitácora (pueden ser la misma persona si el equipo es
  pequeño).
- Clasificar con la tabla de §4.1.
- Enviar el primer aviso interno con lo que se sabe, lo que no y la hora del
  próximo update. Si el impacto es en clínicas, primer aviso externo según §4.3.
- Si no hay canal real de alertas configurado (deuda nº 15), el aviso de los
  timers solo queda en el journal y en `/etc/dental-saas/avisos.sh` si existe;
  usar el canal acordado por el equipo y anotar que se avisó a mano.

---

## 2. Diagnóstico por síntoma

### 2.1 «La sesión se cae» (a los 15 minutos o al recargar)

**Qué significa.** El access token dura 15 minutos; lo normal es un 401 y una
renovación silenciosa. Si el usuario vuelve al login, el refresh está fallando.

**Comprobar, en este orden:**

1. Abrir DevTools → Network y reproducir la acción. Debe verse:
   `401` → `POST /api/auth/refresh` **en el dominio de Vercel** → `200` →
   repetición de la lectura → `200`. En plataforma:
   `POST /api/platform/auth/refresh`.
2. DevTools → Application → Cookies, en el host **Vercel**:
   `refresh_token` con `HttpOnly`, `Secure`, `SameSite=Strict` y path
   `/api/auth` o `/api/platform/auth`. Si la cookie pertenece a Render, el
   navegador está hablando con otro origen.
3. Confirmar que `VITE_API_URL` está **vacía o sin definir** en Vercel y que el
   `vercel.json` conserva el rewrite:

   ```json
   { "rewrites": [
     { "source": "/api/:path*", "destination": "https://<api-real>.onrender.com/api/:path*" },
     { "source": "/(.*)", "destination": "/index.html" }
   ] }
   ```

   El `prebuild` rechaza `VITE_API_URL` absoluta, reglas invertidas y el marcador
   `configurar-api-render.onrender.com`.
4. ¿Se cambió `JWT_SECRET` o se reinició la API sin él? En local, sin
   `JWT_SECRET` se genera uno nuevo por arranque y todas las sesiones mueren. En
   producción el secreto debe ser único y de 32+ caracteres.
5. ¿Se restauró un backup? Los refresh emitidos **después** del volcado viven en
   `RefreshToken` y dejan de existir: esos usuarios repiten login (pérdida
   asumida del RPO).
6. ¿El fallo es solo en un navegador o en todos? `SameSite=Strict` se comprueba
   en navegador real, no con `curl`. Repetir con otro navegador y otro usuario
   para descartar caché o cookie corrupta.

**No hacer:** cambiar la política de la cookie, mover la API a otro origen para
«saltarse» CORS ni poner `VITE_API_URL` absoluta. Eso rompe el refresh y empeora
el aislamiento.

**Para forzar la prueba sin esperar 15 minutos** (solo en una sesión de prueba):

```js
localStorage.setItem('token', 'access-token-expirado-de-prueba')
// Plataforma:
localStorage.setItem('platform_token', 'access-token-expirado-de-prueba')
```

Navegar a Pacientes/Pagos o Clínicas y observar el ciclo 401 → refresh → 200. No
imprimir ni copiar el token.

### 2.2 «Los documentos desaparecen»

**Primero distinguir dos fallos distintos:**

| Síntoma | Qué es |
|---|---|
| El documento sigue en la ficha pero la descarga da 404 | El metadato está en la base y el archivo no está en `UPLOADS_DIR`, o la ruta cambió |
| El documento ya no aparece en la ficha | El registro de base no está (borrado, restauración, migración o aislamiento) |
| La subida falla con 413/400 | Límite de proxy o validación de contenido/tamaño, no pérdida |

**Rutas reales:** `StorageService` guarda en `UPLOADS_DIR`; en Render es
`/var/data/uploads`, siempre dentro del disco persistente `/var/data`. En el
compose de staging, el volumen `staging-uploads` se monta en `/app/uploads`. El
árbol es `tenants/{tenantId}/...`. El tope es 20 MB y se valida por **contenido**,
no por extensión.

**Comprobar:**

1. ¿Hubo redespliegue en Render? Un 404 después de redesplegar apunta a
   `UPLOADS_DIR` o `mountPath` incorrecto o a pérdida real. Ejecutar, con
   `ACCESS_TOKEN`, `TENANT_ID`, `PACIENTE_ID` y `DOCUMENTO_ID` vigentes:

   ```powershell
   node deploy/verificar-remoto.mjs persistencia
   ```

   Debe descargar el mismo PDF y el mismo hash que antes del redespliegue.
2. ¿Se ejecutó `docker compose down -v`? Ese comando **borra los volúmenes**
   `staging-*`; `down` a secas no los borra. En staging, comprobar que el volumen
   `staging-uploads` existe y está montado.
3. ¿El disco está lleno o el mount desapareció? Revisar el disco de Render
   (`/var/data`) y los eventos del servicio. En compose:

   ```powershell
   $dc = "docker compose --env-file .env.staging -f compose.staging.yml"
   iex "$dc ps"
   iex "$dc exec backend ls -la /app/uploads"
   ```

4. ¿El 404 es solo de una clínica? Verificar que la ruta incluye el `tenantId`
   correcto y que no se está leyendo el directorio de otro tenant. El aislamiento
   de base no protege un `UPLOADS_DIR` mal montado.
5. ¿Se restauró la base sin restaurar los archivos? Son dos copias distintas y
   con la misma cadencia: base y `archivos-*.tar.gz`. Restaurar solo una deja
   metadatos sin bytes o bytes sin metadatos.

**Restauración de archivos** (ver §3.2). No restaurar sobre el `UPLOADS_DIR` en
uso: el script se niega si el destino es el directorio activo o lo solapa, y si
el destino ya tiene ficheros. Si hay que mezclar, primero se saca un paquete del
estado actual y se usa `--permitir-merge` con conocimiento del riesgo.

**No hacer:** volver a subir documentos «para que aparezcan» sin antes conservar
la evidencia; borrar `uploads/`; asumir que el snapshot del disco de Render
recupera solo una carpeta (restaura el disco completo y pierde cambios
posteriores).

### 2.3 «Un pago no se registra»

**Primero distinguir qué pago es.** Son dos mundos que no se tocan:

| Pago | Dónde vive | Quién lo confirma |
|---|---|---|
| Cobro del **plan de la clínica** | `CobroSuscripcion` / `IntentoIzipay` / `EventoIzipay` | La **IPN** de Izipay, procesada por `BillingService.procesar` |
| Cobro **a un paciente** | `pagos` (registro interno, arqueo) | El usuario de la clínica; **no** conoce Izipay |

Si es un cobro a paciente, no consultes Izipay: revisa el alta/abono en la
clínica y la auditoría. La pasarela nunca toca `pagos` (`IntentoIzipay` no
referencia `Pago`).

**Comprobar el cobro del plan, en este orden:**

1. `GET /api/facturacion/mi-plan` (permiso `billing.manage`). ¿El cobro está
   `pendiente` o `pagado`? ¿El importe y la moneda son los del servidor?
2. Si `POST /api/facturacion/mi-plan/formtoken` devuelve **503**, falta una
   variable `IZIPAY_*` en el entorno. El 503 nombra la faltante: se corrige la
   variable en Render, **nunca** con una clave por defecto. Las cinco son
   `IZIPAY_BASE_URL`, `IZIPAY_SHOP_ID`, `IZIPAY_CLAVE`, `IZIPAY_CLAVE_HMAC`,
   `IZIPAY_PUBLIC_KEY`.
3. ¿Llegó la IPN a `POST /api/webhooks/izipay`? Es pública, sin JWT y sin CORS;
   la única autenticación es la firma. En el Back Office de Izipay debe estar
   configurada:

   ```text
   POST https://<api-real>.onrender.com/api/webhooks/izipay
   ```

4. Revisar `EventoIzipay.estado`:
   - `procesado`: conciliado.
   - `sin_cobro`: no había cobro pendiente que casar.
   - `importe_moneda_incorrectos`: no se acredita; hay que conciliar.
   - `orden_desconocida`: no se acredita; hay que conciliar.

   Un evento guardado con estado distinto de `procesado` **no** es un pago
   perdido: es una discrepancia a revisar. No se marca a mano.
5. Comprobar la firma: `kr-answer` debe ser una **cadena** y se verifica sobre
   sus bytes UTF-8 exactos. Para la IPN el `kr-hash-key` es `password` y la clave
   `IZIPAY_CLAVE`; para el retorno del navegador es `sha256_hmac` y
   `IZIPAY_CLAVE_HMAC`. Las claves no se cruzan. Una firma inválida responde
   **401 y no escribe nada**.
6. Para acreditar hace falta: `orderStatus=PAID`, transacción `status=PAID`,
   `uuid`, importe y moneda iguales al intento, e intento existente. Un pago de
   importe distinto se guarda para conciliación y responde 200 **sin acreditar**.
7. ¿El navegador dice «pagado» pero la IPN no llegó? El navegador **nunca** marca
   nada: prevalece la IPN. La página de resultado solo consulta `GET mi-plan`
   hasta ver el cobro `pagado`.
8. Idempotencia: la clave `izipay:<uuid>:PAYMENT_ACCEPTED` es única y es también
   el `eventId` de `WebhookEvent`. Reenviar el mismo IPN desde el Back Office
   debe dejar el saldo igual, un evento aceptado y **una sola** extensión del
   periodo. Si se acreditó dos veces, es un incidente de datos, no un reintento
   normal.
9. Si se perdió la IPN, reenviarla **desde el Back Office** (mismo IPN). No
   fabricar ni editar el payload. Si el evento es antiguo y ya hubo otro abono,
   no se salta topes ni se resucita nada: conciliar.
10. Revisar logs de Render por la petición a `/api/webhooks/izipay` y su código.
    Los logs HTTP no contienen payloads; no copies `kr-answer` a tickets.

**No hacer:** cambiar el cobro a `pagado` por SQL, poner el periodo a mano,
desactivar la verificación de firma, aceptar el estado que devuelve el navegador
o tocar `pagos` desde la pasarela. Tampoco ejecutar `db:seed-demo` en producción.

### 2.4 «La API no arranca»

**Comprobar:**

1. **Logs de arranque** (Render → Logs; staging `iex "$dc logs backend"`). La
   aplicación valida el entorno **antes** de crear la app: un mensaje explícito
   suele decir qué variable falta o es inválida.
2. `TRUST_PROXY`: es obligatorio en producción y el arranque falla si no es
   válido. En la cadena navegador → Vercel → Render → app el valor esperado es
   **2**; una petición directa (IPN o subida directa) tiene **1**. No subirlo
   «por si acaso»: un valor mayor degrada el rate limit por IP a un cubo
   compartido y ensucia la IP de auditoría.
3. `JWT_SECRET`: obligatorio, único y de 32+ caracteres. Si falta o es corto, no
   arranca.
4. `DATABASE_URL` (pooler Supabase :6543) y `DIRECT_URL` (directa :5432), ambas
   con `sslmode=require`. El pre-deploy `npm run deploy:migrate` usa la directa y
   **rechaza el pooler o un SSL incorrecto antes de conectar**. Si falla, resolver
   la conexión; no dar el despliegue por publicado.
5. **Orden de build en Render:** `npm ci --include=dev && npx prisma generate &&
   npm run build`, luego pre-deploy `npm run deploy:migrate`, luego start
   `node dist/main.js`. Las `devDependencies` son necesarias en este runtime
   (`prisma`, `tsx`, `dotenv`): no ejecutar `prune`/`omit=dev`. Si faltan, el
   build o el CLI fallan de formas raras.
6. **Cliente de Prisma viejo:** si la migración añadió columnas y no se regeneró
   el cliente, la API puede arrancar pero devolver 400 en los campos nuevos. En
   local/CI el orden es `migrate deploy` → `generate`; en Render, `generate` va en
   el build y `migrate deploy` en el pre-deploy. No invertir el orden local.
7. **Imagen/base:** el runtime es Node 22 (`node:22-slim` en Docker, no alpine):
   los motores de Prisma y `argon2`/`bcrypt` necesitan glibc. En alpine el
   arranque falla de formas crípticas.
8. **Puerto:** en Render lo inyecta la plataforma; no fijar `PORT` a mano. En
   staging, la API escucha en 3000 dentro del contenedor y se publica en 3001.
9. **`tsx` en vez de `dist`:** `tsx` transpila sin metadatos de decorador; la API
   puede arrancar y **toda ruta autenticada devuelve 500** (`this.reflector` es
   `undefined` en `JwtAuthGuard`). Se arranca con `npm run build` y
   `npm start` (`node dist/main.js`).
10. Si el proceso muere y no hay log de aplicación, mirar memoria/CPU y el
    evento del proveedor. Un contenedor de PostgreSQL local con `Exited (137)`
    es falta de memoria, no un bug del código (ver §2.5).

**No hacer:** cambiar `TRUST_PROXY` a un número mayor para «arreglar» 502,
ejecutar `db:seed` a ciegas, desactivar la validación de entorno, ni rotar
secretos sin coordinación: un cambio de `JWT_SECRET` invalida las sesiones.

### 2.5 «La base no responde»

**Comprobar:**

1. Salud: `/api/health` con `database:error` significa que la API levantó pero no
   conecta. Revisar primero la cadena de conexión, no el código.
2. Supabase:
   - `DATABASE_URL` debe ser el **Transaction pooler :6543**, usuario
     `postgres.<project-ref>`; `DIRECT_URL` la directa `db.<project-ref>.supabase.co:5432`.
   - Ambas con `sslmode=require`; la contraseña con caracteres reservados
     codificada para URL.
   - La conexión directa suele ser **IPv6**. Si Render no la alcanza, habilitar
     conectividad directa IPv4 en Supabase o ejecutar la migración desde una
     máquina con acceso. **No** pasar la migración al pooler como supuesto
     arreglo.
   - El plan **Free puede pausarse por inactividad**. Revisar el estado del
     proyecto en el panel antes de tocar la aplicación.
   - Prisma 7 usa `@prisma/adapter-pg`, no el motor anterior. Comprobar las
     operaciones reales sobre el pooler; que una migración directa funcione no
     prueba que el pooler sirva a la app.
3. Staging/local: el PostgreSQL de pruebas es `dental-saas-test`, puerto **5433**,
   usuario `postgres`, contraseña `test`. Comprobar que está arriba:

   ```powershell
   docker start dental-saas-test
   iex "$dc ps"
   ```

   Si el contenedor murió con `Exited (137)` (sin memoria), dejó el esquema
   desincronizado de `_prisma_migrations`. Reiniciar el contenedor y volver a
   migrar; **no** es tu código. La suite completa debe correr sola
   (`fileParallelism: false`), no a la vez que otro trabajo pesado.
4. ¿Se restauró una base y no se apuntó la API a la nueva? `npx prisma migrate
   deploy` es no-op si el volcado traía `_prisma_migrations`, pero la URL debe
   apuntar al destino correcto.
5. ¿El fallo es de una sola consulta? Un error de columna o de tipo suele ser
   cliente de Prisma viejo o migración no aplicada; no es caída de base.
6. Si la base responde pero el disco de archivos no, es §2.2, no este apartado.

**No hacer:** borrar el volumen de PostgreSQL (`down -v`) para «limpiar»; usar
`pg_restore --clean` sobre la base en uso; restaurar sobre la base de
`DATABASE_URL` (el script se niega a propósito); ni ejecutar migraciones
destructivas en un solo despliegue con clientes reales (van en dos).

---

## 3. Restaurar desde las copias

### 3.1 Decidir qué restaurar

| Qué falta | Copia |
|---|---|
| Solo la base | `db:backup` (`.dump` + `.manifiesto.json`) |
| Solo los archivos | `archivos:backup` (`archivos-*.tar.gz` + manifiesto) |
| Base y archivos, o se perdió el host | Ambas + copia externa (`db:backup-remoto`) o snapshot del proveedor |
| Solo una versión de la app | Imagen/tag anterior o despliegue anterior; no requiere restaurar datos |

RPO: con backup diario se pierde como máximo un día; la copia externa añade ~1 h
de rezago, no un día más. Antes de un despliegue con migraciones se saca backup
expreso y la ventana tiende a cero.

### 3.2 Base de datos

1. **Localizar y verificar el volcado.** En `BACKUP_DIR` (por defecto
   `backend/backups/`), por fecha. Leer el manifiesto
   `<volcado>.manifiesto.json`: fecha, tamaño, `sha256`, base y última migración.
2. **Simulacro de restauración** (si hay tiempo; es la prueba de que el volcado
   sirve):

   ```powershell
   cd backend
   npm run db:prueba-restauracion
   ```

   Vuelca, restaura en una base temporal y compara fila por fila `Tenant`, `User`,
   `Paciente`, `Cita`, `Pago`, `Insumo`, `Compra`, `Auditoria` + última migración.
   Falla si algo no coincide. Con la base origen vacía avisa; no lo uses como
   prueba de contenido.
3. **Restaurar primero en una base de usar y tirar**, nunca sobre la base viva:

   ```powershell
   npm run db:restaurar -- --archivo <volcado>.dump --destino revision --confirmo-restauracion
   ```

   Imprime recuentos por tabla. Comparar con producción antes de tocar nada. El
   script se niega a restaurar sobre la base de `DATABASE_URL` y a destinos no
   vacíos.
4. **Congelar escritura** (parar la API o poner mantenimiento) y sacar un
   volcado del estado actual si aún responde.
5. **Restaurar en la base definitiva** (vacía o nueva, no la que está en uso) con
   el mismo comando:

   ```powershell
   npm run db:restaurar -- --archivo <volcado>.dump --destino <bd> --confirmo-restauracion
   ```

   El volcado incluye `_prisma_migrations`; sin esa tabla el siguiente
   `migrate deploy` se confunde. Si se restaura en una base nueva, apuntar
   `DATABASE_URL` a ella.
6. **Completar el esquema y verificar:**

   ```powershell
   npx prisma migrate deploy     # no-op si el volcado traía las migraciones
   npx prisma generate
   npm run smoke:arranque
   ```

   Además: `/api/health`, login, lectura de un paciente y descarga de un
   documento. Para el tenant migrado, `db:migrar-clinica --solo-verificar` y
   lectura por API (el `smoke:arranque` cubre la base demo, no el tenant
   migrado).
7. **Reabrir el tráfico** solo con la verificación anterior en verde.

**Supabase:** elegir plan con copias diarias/PITR (el Free puede pausarse y no
incluye respaldo recuperable), comprobar **Database → Backups** y ensayar la
restauración en un proyecto de prueba con conteos y login posterior. No hay
comando de restauración en el repo para el panel de Supabase.

**Render:** los discos de pago tienen snapshots diarios (al menos siete días
según el proveedor). Un snapshot restaura el **disco completo** y pierde los
cambios posteriores: no es selectivo por carpeta.

### 3.3 Archivos

1. Localizar el paquete `archivos-AAAAMMDD-HHMMSS.tar.gz` y su manifiesto
   (fecha, bytes, `sha256`, número de ficheros, bytes sumados y conteo por
   tenant; nunca nombres ni rutas).
2. Verificar el paquete (`tar -tzf` debe listar el mismo conjunto empaquetado) y
   el `sha256` contra el manifiesto.
3. Restaurar **a un directorio nuevo**, no al `UPLOADS_DIR` en uso:

   ```powershell
   cd backend
   npm run archivos:restaurar -- --archivo <paquete>.tar.gz --destino <dir-nuevo> --confirmo-restauracion
   ```

   El script se niega si el destino es el `UPLOADS_DIR` activo o lo solapa, y si
   ya tiene ficheros. Solo si de verdad hay que mezclar, usar
   `--permitir-merge` **después** de sacar un paquete del estado actual.
4. Con la API parada, apuntar `UPLOADS_DIR` al directorio restaurado (o
   reemplazar el contenido con la API detenida) y verificar con
   `node deploy/verificar-remoto.mjs persistencia` y una descarga real.
5. El paquete conserva exactamente el árbol `tenants/{tenantId}/...`. No
   reorganizar carpetas ni renombrar tenants.

### 3.4 Copia externa y desastre del host

```powershell
cd backend
$env:RESPALDO_REMOTO = "D:\respaldos"   # o b2:bucket/dental-saas con rclone
npm run db:backup-remoto -- --verificar
npm run db:prueba-respaldo-remoto
```

- `--verificar` comprueba lo que ya hay fuera contra el `sha256` del manifiesto.
- La prueba de la cadena copia, corrompe la copia y exige que se rechace, borra
  `BACKUP_DIR` («muere el host») y restaura **desde la copia externa**.
- Destino local/disco montado: restaurar directamente de ahí con
  `db:restaurar`/`archivos:restaurar`.
- Destino `rclone`: traer primero los 4 ficheros
  (`rclone copy <remoto>:<dir>/ ./traidos/`) y seguir el procedimiento normal.
  Restaurar desde la copia es la prueba; que `copy` salga en verde no lo es.
- Sin `RESPALDO_REMOTO` el script **falla a propósito**: una copia que no sale
  de la máquina no es una copia externa.

### 3.5 Volver a la versión anterior de la aplicación

El rollback es **restaurar el volcado previo + volver a la imagen anterior**. La
base origen de la clínica nunca se toca en una migración de datos (el script solo
lee de ella), así que el plan B existe.

- Staging: `docker compose --env-file .env.staging -f compose.staging.yml up -d
  --no-build` con el tag anterior fijado.
- Render: redesplegar el despliegue anterior desde el panel, con la misma
  configuración. No cambiar variables a la vez.
- Después: `npx prisma migrate deploy` (no-op si el volcado traía las
  migraciones), `/api/health`, login, lectura de un paciente y un documento.

**Qué se pierde al restaurar** (decirlo antes, no después): escrituras entre el
backup y el corte (hasta el RPO), refresh emitidos después del backup (los
usuarios repiten login) y archivos subidos después del paquete previo.

---

## 4. Comunicación

### 4.1 Severidad

| Nivel | Criterio | Respuesta |
|---|---|---|
| **S1** | Toda la plataforma caída, pérdida/corrupción de datos, fuga entre clínicas, pago cobrado sin registrar o doble abono | Aviso inmediato; incidente dirigido por el responsable; sin cambios no coordinados |
| **S2** | Una clínica o una función crítica degradada (agenda, documentos, login de un usuario, pago pendiente) sin pérdida de datos | Aviso en 15 min; actualización cada 30 min o al cambiar el estado |
| **S3** | Función secundaria o error con workaround; sin impacto en datos | Aviso en la siguiente ventana; seguimiento normal |

Un `acceso_cruzado` de la vigilancia se trata como **S1 de seguridad** aunque el
impacto funcional parezca pequeño.

### 4.2 Reglas de los mensajes

- Una sola persona comunica (el responsable del incidente). Los demás no
  especulan en canales de clientes.
- Formato: **qué pasa**, **a quién afecta**, **desde cuándo**, **qué estamos
  haciendo**, **workaround si existe**, **hora del próximo update**. Si no se
  sabe la causa, se dice «en diagnóstico»; no se inventa.
- Nunca incluir contraseñas, tokens, cookies, `DATABASE_URL`, `JWT_SECRET`,
  claves `IZIPAY_*`, `kr-answer`, payloads de pago ni datos de pacientes. Los
  logs se comparten redactados y por el canal interno.
- No prometer una hora de restauración sin backup verificado y RTO medido. El
  RTO crece con el tamaño: re-medirlo con el volcado real
  (`db:prueba-restauracion` imprime los tiempos).
- Los avisos automáticos de los timers systemd van al journal y a
  `dental-saas-aviso@.service` → `/etc/dental-saas/avisos.sh` si existe. Hoy no
  hay canal real configurado (deuda nº 15): si el aviso no llega, se avisa a mano
  y se anota en la bitácora.

### 4.3 Cadencia

| Momento | Acción |
|---|---|
| T+5 min | Aviso interno: impacto, alcance, responsable, próximo update |
| T+15 min | Primer aviso a clínicas afectadas si hay impacto visible (S1/S2) |
| Cada 30 min o al cambiar el estado | Actualización breve; no repetir la misma información sin avance |
| Al estabilizar | Aviso de servicio restablecido + qué se perdió, si se perdió algo |
| Cierre | Informe con línea de tiempo, causa raíz, acciones con responsable y fecha |

### 4.4 Cierre del incidente

1. Confirmar con evidencia: `/api/health`, login, lectura de un paciente, descarga
   de un documento y, si aplica, conciliación del pago y periodo extendido una
   sola vez.
2. Comprobar que no quedó ningún cambio a medias (migración, variable,
   restauración, rollback) y que la vigilancia vuelve a 0.
3. Escribir el post-incidente: qué pasó, detección, causa raíz, qué funcionó, qué
   no, y acciones con dueño y fecha.
4. Si el incidente reveló una deuda nueva, anotarla en
   [deuda-tecnica.md](deuda-tecnica.md) con el porqué y el disparador. Si cambió
   el esquema o el procedimiento, actualizar la documentación correspondiente.
5. Si hubo un fallo de una prueba, añadir la prueba de regresión antes de cerrar.
   No se debilitan asertos ni se borran casos para «pasar».

---

## 5. Prohibiciones rápidas (las que más caro salen)

- `docker compose down -v` para «limpiar»: borra los volúmenes `staging-*`
  (uploads y datos).
- Restaurar sobre la base en uso o usar `pg_restore --clean` sin guarda.
- Ejecutar `db:seed-demo` en producción: crea una clínica ficticia.
- Migrar sin backup verificado, sin `prisma generate` o invirtiendo
  `migrate`/`generate` en local.
- Cambiar `TRUST_PROXY` a un valor mayor para «arreglar» el rate limit o los 502.
- Tocar el estado de un pago o de una suscripción a mano, o desactivar la
  verificación de firma de Izipay.
- Restaurar archivos sobre `UPLOADS_DIR` en uso sin parar la API.
- Rotar `JWT_SECRET` o `DATABASE_URL` en caliente sin coordinación.
- Publicar en el ticket logs con datos de pacientes, cookies o el contenido de
  `.env`.
