# Render + Vercel + Supabase — puesta en marcha desde los paneles

## Estado y decisiones

El usuario eligió configurar los servicios desde sus paneles. **Todavía no hay
URLs ni proyectos remotos creados/verificados por este trabajo.** Este documento
es el procedimiento y registro de aceptación; no declara un despliegue operativo.

- API: Render **Node 22**, una instancia de pago, disco persistente `/var/data`.
- Base: Supabase; `DATABASE_URL` pooler :6543 para la app y `DIRECT_URL` directa
  :5432 para CLI/migraciones/seed. Ambas con `sslmode=require`.
- Web: Vercel, raíz `frontend`, Node 22, build `npm run build`, salida `dist`.
- Navegador → `/api` en Vercel → Render. `VITE_API_URL` **vacía**.
- Cookie existente `HttpOnly; Secure; SameSite=Strict`; no se cambia su política.
- Archivos: `UPLOADS_DIR=/var/data/uploads`, siempre dentro del disco de Render.
  Supabase Storage queda como tarea de código independiente, no implementada aquí.

Hay un `render.yaml` para crear la API por Blueprint, o usar sus campos en el
formulario Web Service. No contiene secretos ni fija PORT. Antes de utilizarlo,
los cambios del repositorio deben publicarse en la rama que leen los proveedores.

**Claves existentes:** se retiraron credenciales de Izipay de `.env.example`.
Si se publicaron en GitHub, reemplazarlas en Back Office y en el entorno; retirar
del archivo no las elimina de los commits históricos. No copiar `.env` al repo.

## 1. Supabase

1. Crear proyecto, seleccionar región próxima a Render y guardar la contraseña
   de PostgreSQL en un gestor/variables del proveedor.
2. En **Connect**, copiar las cadenas que entrega el panel, no deducir el host:
   - Transaction pooler: puerto **6543**, usuario `postgres.<project-ref>`.
   - Direct connection: host `db.<project-ref>.supabase.co`, puerto **5432**.
3. Reemplazar la contraseña y codificar sus caracteres reservados para URL.
4. Añadir `sslmode=require` a las dos cadenas. No mostrar sus valores en informes.
5. Configurar la del pooler como `DATABASE_URL` y la directa como `DIRECT_URL`
   en Render. El CLI de Prisma prioriza DIRECT_URL; la app conserva DATABASE_URL.

La conexión directa normalmente es IPv6. Comprobar su alcance desde Render:
si no es alcanzable, habilitar conectividad directa IPv4 en Supabase o ejecutar
la migración desde una máquina con acceso directo. **No pasar la migración al
pooler transaccional como supuesto arreglo.**

Prisma 7 usa `@prisma/adapter-pg`, no el motor anterior. Comprobar las operaciones
reales sobre el pooler durante el recorrido; el éxito de una migración directa
no prueba por sí solo que el pooler sirva a la app.

El plan **Free puede pausarse por inactividad**. Las copias diarias accesibles
para restauración son de los planes Pro/Team/Enterprise: no asumir que el Free
incluye un respaldo recuperable. Para operación con datos reales elegir el plan
con respaldos, consultar Database → Backups y realizar un ensayo de restauración
en un proyecto de prueba, con conteos y login posterior.

## 2. Render: API Web Service

Crear desde `https://github.com/ecuellara/Saas-MultiTent`:

| Campo | Configuración |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Node | 22 (`engines` + `NODE_VERSION` en Blueprint) |
| Build | `npm ci --include=dev && npx prisma generate && npm run build` |
| Pre-deploy | `npm run deploy:migrate` |
| Start | `node dist/main.js` |
| Health check | `/api/health` |
| Instancias | 1 |
| Disco | mount `/var/data`, tamaño inicial 10 GB, plan de pago |

El orden es instalar → generate → migrate deploy. El pre-deploy se ejecuta
después del build. `deploy:migrate` ejecuta `prisma migrate deploy` con la URL
directa y rechaza el pooler/SSL incorrecto antes de conectar. Si falla, resolver
la conexión y no dar por publicado el esquema.

**CLI y seeds:** `prisma`, `tsx` y `dotenv` permanecen en devDependencies.
La instalación explícita **`npm ci --include=dev`** los conserva en este runtime
Node de Render; no ejecutar prune/omit=dev después. El Dockerfile de staging
conserva sus objetivos runtime/herramientas, no se mezcla con este procedimiento.

### Variables en Render (nombres y finalidad)

| Nombre | Finalidad |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Lo inyecta Render; no fijarlo manualmente |
| `DATABASE_URL` | Pooler Supabase :6543, SSL |
| `DIRECT_URL` | Conexión directa Supabase :5432, SSL |
| `JWT_SECRET` | Secreto único de 32+ caracteres |
| `TRUST_PROXY` | Número de saltos verificado, explícito |
| `FRONTEND_URL` | Origen HTTPS de Vercel sin barra final |
| `UPLOADS_DIR` | `/var/data/uploads` |
| `BACKUP_DIR` | `/var/data/backups` (no activa ningún job por sí solo) |
| `PLATFORM_OWNER_EMAIL`, `PLATFORM_OWNER_PASSWORD` | Seed inicial; contraseña 12+ caracteres |
| `IZIPAY_BASE_URL` | Origen REST del entorno contratado |
| `IZIPAY_SHOP_ID`, `IZIPAY_CLAVE` | Basic auth y firma IPN password |
| `IZIPAY_CLAVE_HMAC`, `IZIPAY_PUBLIC_KEY` | Retorno firmado del navegador y Krypton |

Puede crearse la API antes de conocer Vercel; completar FRONTEND_URL después
de crear la web y redesplegar. Si falta una variable Izipay, conservar el 503
con su nombre: se corrige la variable en Render, no con una clave por defecto.

### Seed una sola vez

Después de migrar, en **Shell de Render**:

```sh
npm run deploy:seed
```

Equivale a ejecutar `npm run db:seed`/`tsx prisma/seed.ts` con DATABASE_URL
directa **solo en ese proceso**. Crea permisos, planes, catálogos y el owner de
plataforma. No forma parte de build/pre-deploy/start; no ejecutar `db:seed-demo`.
Se puede retirar PLATFORM_OWNER_PASSWORD del entorno después del seed inicial.

Anotar la URL que **Render entrega**, incluido cualquier sufijo de su nombre:
`https://<api-real>.onrender.com`. No inferirla solo de `name: dental-saas-api`.

### TRUST_PROXY

Cadena habitual: navegador → Vercel → Render → app, dos intermediarios. Para
esa cadena el valor esperado es **2**; una solicitud directa → Render → app
(IPN o una subida directa) tiene **1**. El Blueprint pide el valor en el panel,
no lo inventa. Revisar `X-Forwarded-For`, la cadena efectiva y los logs de IP
antes de aceptar el despliegue. Render/Vercel pueden reemplazar/añadir cabeceras.
No dar por exacto el conteo únicamente por el número de marcas de proveedores.

Con rutas de distinta longitud, el ajuste numérico tiene límites: validar
especialmente que dos navegadores no comparten el mismo cubo de login. No usar
un valor mayor como solución genérica. La IPN se autentica por firma.

## 3. Vercel

1. Importar el mismo repo, **Root Directory `frontend`**, Node 22.
2. Build `npm run build`, output `dist`.
3. `VITE_API_URL` vacía o sin definir, tanto producción como previews usados en
   las pruebas. La cadena Supabase, JWT y claves privadas nunca van en Vercel.
4. Con la URL real de Render, configurar localmente:

```powershell
cd E:\SAAS\frontend
npm run configurar:vercel -- https://<api-real>.onrender.com
```

Esto actualiza `frontend/vercel.json`. Publicar ese archivo en la rama usada
por Vercel y redesplegar. La URL no es un secreto. No se interpolan variables
del panel en `destination`: la regla debe contener una URL real.

El archivo tiene este orden:

```json
{ "rewrites": [
  { "source": "/api/:path*", "destination": "https://<api-real>.onrender.com/api/:path*" },
  { "source": "/(.*)", "destination": "/index.html" }
] }
```

**El marcador inicial `configurar-api-render.onrender.com` no es un servicio.**
El prebuild en Vercel rechaza ese marcador, las reglas invertidas o VITE_API_URL
absoluta. También se desactiva la caché de `/api` para no cachear respuestas de
sesión/estado de pagos. Las rutas SPA profundas deben devolver index.html.

Copiar la URL estable de producción de Vercel a FRONTEND_URL en Render.
Si se prueba un preview, añadir ese origen exacto temporalmente a FRONTEND_URL
(el backend admite lista separada por comas), sin comodines de credenciales.

## 4. Seis verificaciones remotas (registro obligatorio)

### 1 — Salud API y proxy

Desde la raíz, con URLs públicas sin `/api`:

```powershell
$env:API_PUBLIC_URL="https://<api-real>.onrender.com"
$env:FRONTEND_PUBLIC_URL="https://<web-real>.vercel.app"
node deploy/verificar-remoto.mjs health
```

Debe responder `{"status":"ok","database":"ok"}` directamente y a través
de Vercel. Abrir también una ruta profunda como `/admin/clinicas`: no debe 404.

### 2 — Login y refresh en navegador (no sustituirlo por curl)

Entrar a `/admin/login` con el owner del seed, enrolar/verificar MFA. Crear la
clínica del paso 3 y hacer login clínico. En DevTools → Application → Cookies:
`refresh_token` pertenece al host **Vercel**, HttpOnly, Secure, SameSite Strict,
path `/api/auth` o `/api/platform/auth`, según la sesión.

Los clientes de clínica/plataforma renuevan automáticamente ante un 401 de un
endpoint autenticado; peticiones concurrentes comparten un refresh y reintentan
una vez. Login, MFA y 401 silenciosos de Izipay no disparan esa renovación.

Para forzar el recorrido sin esperar 15 minutos, en la sesión **clínica**:

```js
localStorage.setItem('token', 'access-token-expirado-de-prueba')
```

Navegar a Pacientes/Pagos. En Network debe verse 401 →
`POST /api/auth/refresh` **en Vercel** → 200 → repetición de la lectura → 200,
sin volver al login. Para plataforma usar `platform_token` y navegar a Clínicas;
el refresh debe ser `/api/platform/auth/refresh`. No imprimir el token ni la cookie.
Alternativamente esperar realmente 15 min y repetir una lectura. Registrar
fecha, navegador, origen y resultado; SameSite real se comprueba en navegador.

### 3 — Primera clínica

Desde plataforma dar de alta una clínica real de prueba con su owner (sin seed
demo). Seguir [primeros-pasos-clinica.md](primeros-pasos-clinica.md): horario y
descansos, tratamiento, paciente, cita, realización de cita y pago pendiente.
Verificar permisos, clínica seleccionada y que el cobro quede asociado al paciente.

### 4 — Subida real de aproximadamente 10 MB

En una clínica/paciente de prueba, configurar temporalmente en el entorno local
ACCESS_TOKEN, TENANT_ID y PACIENTE_ID de esa sesión (no versionarlos). Ejecutar:

```powershell
node deploy/verificar-remoto.mjs subida
```

Genera un PDF válido de ~10 MiB, lo envía **por Vercel** como multipart a
`POST /api/pacientes/:id/documentos/archivo` (`archivo` + `tipo=OTRO`), exige
201 y descarga comparando los bytes/hash. Anotar DOCUMENTO_ID para el paso 6.

No confundir con POST `/documentos`, que solo registra metadatos. Las firmas
usan `POST /api/consentimientos/:id/firmas` (`archivo` + `rol`).

El límite de ~4.5 MB de las Functions de Vercel no demuestra por sí solo el
límite de sus external rewrites. **La subida remota sigue pendiente de medida.**
Si devuelve 413/falla por tamaño en el proxy, conservar logs y probar la misma
subida con `BASE_SUBIDA=https://<api-real>.onrender.com`. Si directo funciona,
activar como cambio posterior un cliente Bearer **solo para estos dos endpoints
de bytes** (sin withCredentials), con FRONTEND_URL/CORS correcto. Login, refresh,
lecturas, pagos y demás API siguen por Vercel. No cambiar VITE_API_URL a Render.
Ese bypass no está activado sin evidencia de fallo del proxy.

### 5 — Izipay e IPN

En Back Office sandbox configurar la notificación:

```text
POST https://<api-real>.onrender.com/api/webhooks/izipay
```

Es pública, sin JWT y no depende de CORS. Pagar en SmartForm con tarjeta TEST.
La página de resultado debe esperar hasta que GET del pago refleje el IPN.
En BD conciliar `IntentoIzipay`/`EventoIzipay`, importe y moneda; para PAID el
importe aceptado coincide exactamente con el intento guardado antes de abonar.

Reenviar **el mismo** IPN desde Back Office: saldo igual, un evento aceptado y
un único `IZIPAY_ABONO`. Alterar un byte de `kr-answer` manteniendo el hash:
401, sin cambiar pago/eventos/auditoría de IPN. La firma se calcula sobre el
texto crudo con password REST y comparación constante. No copiar payloads con
datos del paciente a logs/commits. No dar por completada esta prueba porque solo
CreatePayment funciona: la entrega pública del IPN debe observarse realmente.

### 6 — Persistencia después de redesplegar

Redesplegar la API desde Render manteniendo el disco. Con DOCUMENTO_ID del
paso 4 y un ACCESS_TOKEN vigente:

```powershell
node deploy/verificar-remoto.mjs persistencia
```

Debe descargar el mismo PDF y hash. Comprobar también una firma subida antes
del redespliegue. Un 404 revela mountPath/UPLOADS_DIR incorrecto o pérdida real.

Al terminar las comprobaciones, retirar ACCESS_TOKEN de la terminal:
`Remove-Item Env:ACCESS_TOKEN` (también TENANT_ID/PACIENTE_ID si corresponde).

## 5. Respaldos: estado honesto

- **Supabase**: configurar el plan con copias diarias/PITR según necesidad y
  probar restauración en otro proyecto. No activado ni restaurado por este trabajo.
- **Disco Render**: los discos de pago tienen snapshots diarios, al menos
  siete días según el proveedor. Comprobarlos en Disk y ensayar restauración
  controlada. Un snapshot restaura el disco completo y pierde cambios posteriores.
- **Copia externa de archivos**: pendiente. Un disco solo lo ve su propia
  instancia; **un Render Cron Job no puede montar el disco de la API**, y tampoco
  lo ven build/pre-deploy/one-off jobs. No crear un cron de archivos sobre un
  directorio vacío y llamarlo respaldo. Como operación manual, usar Shell/SSH
  de esa instancia para `archivos:backup` y sacar el paquete por SCP a otro destino.
- **Scripts del repo**: no se han instalado timers systemd en Render. Tampoco
  hay Cron Jobs, destino externo, rclone ni vigilancia configurados.
- **Cron de base**: puede ser un servicio separado que conecte por DIRECT_URL,
  usando una imagen Docker de operaciones con pg_dump/pg_restore y rclone.
  Antes verificar versión del cliente Postgres, credenciales del destino,
  manifiestos SHA256 y restauración. El runtime Node elegido no añade rclone.
- Supabase Storage requeriría su propio respaldo de objetos: el backup de la
  base solo conserva metadatos de Storage, no los archivos.

## 6. Informe de aceptación (rellenar con evidencia)

| Servicio | URL real | Estado actual |
|---|---|---|
| Render API | Pendiente del panel | No creado/verificado |
| Vercel web | Pendiente del panel | No creado/verificado |
| Supabase proyecto | Pendiente del panel | No creado/verificado |

Variables **preparadas/documentadas**, no afirmadas configuradas remotamente:
NODE_ENV, NODE_VERSION, DATABASE_URL, DIRECT_URL, JWT_SECRET, TRUST_PROXY,
FRONTEND_URL, UPLOADS_DIR, BACKUP_DIR, PLATFORM_OWNER_EMAIL,
PLATFORM_OWNER_PASSWORD, IZIPAY_BASE_URL, IZIPAY_SHOP_ID, IZIPAY_CLAVE,
IZIPAY_CLAVE_HMAC, IZIPAY_PUBLIC_KEY; PORT automático de Render y VITE_API_URL vacía.

| # | Verificación | Resultado remoto actual |
|---|---|---|
| 1 | Health directo y por proxy | Pendiente de URLs |
| 2 | Login y refresh en navegador | Pendiente de despliegue |
| 3 | Alta clínica y primer día | Pendiente de seed/owner remoto |
| 4 | Documento ~10 MB por Vercel | Pendiente de subida real |
| 5 | Pago sandbox + IPN + replay | Pendiente de URL pública y Back Office |
| 6 | Redespliegue y archivos iguales | Pendiente de disco y documento remoto |

### Verificación local realizada

- `npm ci --include=dev --dry-run --ignore-scripts` en backend y frontend:
  lockfiles compatibles. Es un ensayo, no una instalación Linux de Render.
- Prisma generate y migrate deploy contra la base **local de pruebas**: correctos.
- Backend `tsc --noEmit`: correcto; **245 pruebas e2e aprobadas en 24 archivos**.
- `npm run smoke:arranque`: 4/4 pasos con la base local de desarrollo.
- Arranque compilado con NODE_ENV=production y TRUST_PROXY vacía: rechazado
  antes de crear la app, con salida 1 y mensaje explícito.
- `npm run test:deploy` backend: 2/2 (URL directa/SSL y CLI Prisma 7/tsx real).
- `npm run test:deploy` frontend: 5/5 (proxy y renovación concurrente/separada).
- `npm run test:izipay` frontend: 5/5; typecheck y build correctos.
- Prebuild ejecutado como Vercel con API absoluta: rechazado correctamente.
- PDF del guion de subida: 10 486 379 bytes, cabecera PDF, tamaño dentro de 20 MB.
  **Generación local comprobada; subida y persistencia remotas aún pendientes.**

Estos resultados no sustituyen las seis comprobaciones remotas de la tabla.

## Fuentes consultadas

- [Render Blueprint](https://render.com/docs/blueprint-spec)
- [Render discos y snapshots](https://render.com/docs/disks)
- [Vercel rewrites y caché](https://vercel.com/docs/rewrites)
- [Supabase conexiones](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase backups por plan](https://supabase.com/docs/guides/platform/backups)

---

## Almacenamiento de documentos (Supabase Storage)

En Render el disco es **efímero**: los documentos subidos se borran en cada
despliegue. Por eso producción guarda en un bucket de Supabase, que sí es
persistente y entra en el plan gratuito.

1. Supabase → **Storage** → *New bucket* → nombre `documentos` → **privado**
   (el backend lo sirve con su clave; nunca debe ser público).
2. Copia la **service role key** (Settings → API). Es un secreto: solo en la
   configuración de Render, nunca en el repositorio.
3. Variables en Render:

   | Variable | Valor |
   |---|---|
   | `STORAGE_DRIVER` | `supabase` |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | la clave del paso 2 |
   | `SUPABASE_STORAGE_BUCKET` | `documentos` |

4. Redespliega y sube un documento: debe aparecer en el bucket y **seguir ahí
   después de un redespliegue**.

Si falta alguna variable, la API falla al usar el almacenamiento nombrando la
que falta (no arranca con un valor por defecto silencioso). Sin
`STORAGE_DRIVER=supabase` se usa el disco local, que es lo correcto en
desarrollo y en las pruebas.