# Despliegue: Render + Cloudflare + Supabase

**Arquitectura vigente desde 2026-10.** Sustituye a la guía «Render + Vercel + Supabase»
(antes en este mismo fichero). El frontend y los archivos pasan a Cloudflare; la API sigue
en Render y la base en Supabase.

## 1. Qué corre dónde, y por qué

| Pieza | Dónde | Por qué |
|---|---|---|
| **Frontend** (Vue/Vite) | **Cloudflare Pages** | Gratis, sin tope de banda y sin coste de salida. Antes Vercel Hobby, que limita la banda y no aporta nada aquí |
| **Proxy `/api`** | Pages Function | Mantiene el **mismo origen**: la cookie de refresh es `SameSite=Strict` y sin esto la sesión se cae a los 15 minutos |
| **API** (NestJS) | **Render** | Cloudflare **no puede** ejecutar NestJS (Workers es V8 sin Node; Containers está en beta y escala a cero). **Free hasta el primer cliente real; Starter ($7) al firmarlo** |
| **Base de datos** | **Supabase** (Free) | Postgres gestionado. D1 no sirve: es SQLite |
| **Archivos** (radiografías, PDF, firmas) | **Cloudflare R2** | 10 GB gratis y **sin coste de salida**, frente a 1 GB y Pro a $25 en Supabase Storage |
| **DNS, WAF, DDoS** | **Cloudflare** | Incluido y gratis; el mismo sitio que Pages |

```
Navegador
   │  https://app.<dominio>            (mismo origen para todo)
   ▼
Cloudflare Pages ──── /api/* ──▶ Pages Function ──▶ Render (API NestJS)
   │                                                    │
   │                                      ┌─────────────┴─────────────┐
   ▼                                      ▼                           ▼
Cloudflare R2 (archivos)            Supabase (PostgreSQL)
```

**Lo que NO se migra, y por qué** (para que nadie lo reintente):

- **La API no puede ir a Cloudflare Workers**: NestJS depende de Express, del motor de
  Prisma y de APIs de Node. La alternativa sería reescribir el backend y sus pruebas.
- **La base no puede ir a D1**: es SQLite; el esquema, las migraciones y Prisma son
  Postgres.
- **Cloudflare Containers** sí ejecutaría la imagen Docker, pero está en beta, cobra por
  uso y **escala a cero**: el mismo cold start del que se huye.

### Coste

| Concepto | Ahora (sin clientes) | Con el primer cliente |
|---|---:|---:|
| Render | **$0** (free, duerme) | **$7** (Starter, siempre encendida) |
| Cloudflare Pages + R2 + DNS | **$0** | **$0** (R2 gratis hasta 10 GB) |
| Supabase | **$0** | **$0** |
| Dominio | ~S/ 40/año | ~S/ 40/año |
| **Total** | **~S/ 4/mes** | **~S/ 30/mes** |

## 2. Variables por pieza

### API (Render)

| Variable | Valor |
|---|---|
| `DATABASE_URL` | **Pooler** de Supabase: `postgresql://postgres.<ref>:<clave>@aws-0-us-east-1.pooler.supabase.com:5432/postgres` |
| `JWT_SECRET` | 32+ caracteres |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `2` (Cloudflare + Render: dos saltos reales) |
| `FRONTEND_URL` | `https://app.<dominio>` (o el `*.pages.dev`) |
| `STORAGE_DRIVER` | `r2` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Credenciales del bucket |
| `IZIPAY_*` | Las cinco de la pasarela |

Build command: `npm ci --include=dev && npx prisma generate && npm run deploy:migrate && npm run build`.
Sin `deploy:migrate` la base se queda atrás y aparecen 400 imposibles de explicar.

### Pages (Cloudflare)

| Variable | Valor |
|---|---|
| `API_ORIGIN` | `https://<api>.onrender.com` (**no** es un secreto) |

Build: comando `npm run build`, salida `dist`, directorio raíz `frontend`. El `prebuild`
verifica la configuración antigua de Vercel y **se salta solo** cuando no corre en Vercel.

### R2 (Cloudflare)

Bucket privado (sin acceso público). Token de API con permiso **solo de escritura y
lectura sobre ese bucket**, no de cuenta completa.

## 3. Puesta en marcha

1. **R2**: crear el bucket, generar el token de API y anotar `ACCOUNT_ID`, `ACCESS_KEY_ID`,
   `SECRET_ACCESS_KEY`.
2. **Render**: poner las variables de la §2 y desplegar. El plan free **duerme** la
   instancia a los 15 minutos de inactividad.
3. **Pages**: crear el proyecto apuntando a `frontend`, con la variable `API_ORIGIN`. El
   fichero `frontend/functions/api/[[ruta]].ts` hace de proxy sin bufferizar el cuerpo, para
   que quepan archivos grandes.
4. **Cortar**: apuntar el dominio a Pages y actualizar `FRONTEND_URL` en Render con ese
   dominio exacto (sin barra final).
5. **Comprobar** lo de la §4.

## 4. Las cuatro comprobaciones de lanzamiento

> **Con Render free la API duerme.** Antes de medir nada, haz una llamada de calentamiento
> (`/api/health`) y espera a que responda; los tiempos de la primera petición no valen.

| # | Qué comprobar | Cómo | Criterio |
|---|---|---|---|
| 1 | **Sesión** | En la consola del navegador, dentro de la app: `await fetch('/api/auth/refresh', {method:'POST', credentials:'include'})` | **200**. Prueba que el proxy es de mismo origen y que la cookie de refresh llega |
| 2 | **Archivos** | Subir un documento, **redesplegar la API** y volver a descargarlo | Sigue ahí. Prueba que va a R2 y no al disco efímero |
| 3 | **`TRUST_PROXY`** | Hacer un login fallido y consultar `SELECT ip FROM "Auditoria" ORDER BY "createdAt" DESC LIMIT 5` | La IP debe ser **la del usuario**, no una de Cloudflare/Render (rangos `172.6x`, `162.159.x`, `104.2x`) |
| 4 | **Subida grande** | Subir un archivo de ~10 MB | **201** en menos de ~5 s. Cloudflare admite cuerpos de hasta 100 MB, muy por encima del tope de 20 MB de la app |

Las cuatro quedan cerradas cuando las cuatro dan el criterio, con la API despierta.

## 5. Vuelta atrás

Mantener el proyecto de Vercel **dos semanas** funcionando en paralelo. Para revertir:
apuntar el dominio a Vercel, restaurar `VITE_API_URL` vacía y el `vercel.json` con el
rewrite `/api` → Render. La base y la API no cambian, así que la vuelta atrás son minutos.

## 6. Seguridad de la nueva pieza

- **El proxy de Pages es público**: no guarda secretos y no autoriza nada. Solo reenvía
  `/api/*`; quien decide es la API, con su JWT, su cookie y sus permisos.
- **Las credenciales de R2** viven solo en Render. El token del bucket **no** debe ser una
  clave de cuenta con acceso a todo Cloudflare.
- **El bucket es privado**: los archivos se sirven a través de la API, que valida el
  tenant y el tipo de contenido antes de entregarlos.
- Si el proxy tuviera que exponer otro prefijo en el futuro, sería una decisión consciente
  y con revisión de seguridad; hoy solo `/api/*`.

## 7. Cuándo cambiar de plan o de pieza

| Disparador | Acción |
|---|---|
| **Primer cliente real** | Render **Starter** ($7): la API deja de dormir |
| Las radiografías pasan de ~8 GB, o el tráfico de salida crece | R2 de pago (muy barato, sin salida) |
| La base supera 400 MB o quieres copias gestionadas | Supabase Pro ($25) — antes, agota los dumps propios |
| Más de ~10 clínicas, o se necesita más de una instancia | VPS con el kit del proyecto (`compose.staging.yml` + `deploy/systemd`) |
