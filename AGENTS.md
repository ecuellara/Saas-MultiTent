# AGENTS.md — Dental SaaS

Instrucciones para quien trabaje en este repositorio, sea persona o agente.
La documentación funcional está en `docs/`; esto es lo que hay que saber **antes** de
tocar código: las reglas, cómo se comprueba que algo está terminado, y las trampas que
este proyecto ya pagó con tiempo.

## 1. Qué es

- **`backend/`** — NestJS 12 + Prisma 7.10 + PostgreSQL. ESM (`"type": "module"`): los
  imports relativos llevan **`.js`** aunque el fichero sea `.ts`.
- **`frontend/`** — Vue 3.5 + Vite + Pinia + Tailwind 4. Mobile-first.
- Multi-tenant con **base compartida y `tenantId`**; aislamiento en
  `backend/src/core/prisma/tenant-extension.ts`.
- Desplegado en **Render** (API), **Cloudflare Pages** (frontend, con proxy `/api` de mismo origen hacia Render), **Supabase** (PostgreSQL) y **Cloudflare R2** (archivos). Render es **free hasta el primer cliente real**; al firmarlo, **Starter** (la free duerme).
- Especificación: `docs/dental-saas-arquitectura-v2.md`. Deuda aceptada:
  `docs/deuda-tecnica.md`. Cómo probar: `docs/como-probar.md`.

## 2. Reglas que no se negocian

Cada una existe porque su incumplimiento ya causó un incidente real.

1. **Aislamiento por clínica.** La extensión de Prisma filtra por `tenantId` **solo
   cuando `ctx.validado === true`**. En una ruta `@Public()` (webhooks, feed ICS) el
   filtro está **apagado**: hay que fijar `tenantId` explícitamente en la consulta. Si
   no, una clínica puede leer los datos de otra.
2. **Rutas de plataforma** → `PlatformGuard`. **`@Body()`** → siempre una clase con
   decoradores de `class-validator`, nunca un objeto suelto (si no, la validación no
   corre y el `forbidNonWhitelisted` no protege).
3. **Relaciones con `select` explícito**, nunca `include: true`: ya se filtró el hash de
   contraseña una vez.
4. **Fechas `@db.Date`** se leen con `getUTC*`, nunca con `getDate()`. La zona de la
   clínica es `America/Lima` = **UTC-5 sin horario de verano** (un desplazamiento fijo es
   correcto; está en `core/…/calendario-ics.ts`).
5. **Dinero en céntimos** con `Prisma.Decimal`, nunca `float`. Y el **importe lo fija
   siempre el servidor**: lo que el cliente envía no decide cuánto se cobra.
6. **Pasarela (Izipay).** La IPN es pública pero solo la autentica la **firma sobre el
   `kr-answer` CRUDO**; `orderStatus === 'PAID'` no basta (hace falta intento conocido +
   importe y moneda iguales); es **idempotente**; y el navegador **nunca** marca un pago
   como cobrado. El cobro de la clínica va por `BillingService.procesar`; el módulo
   `pagos` es registro interno y **no conoce Izipay**.
7. **Nada de credenciales por defecto** ni de datos de demostración en producción: el
   seed de demo (`db:seed-demo`) crea una clínica ficticia.
8. **Una sola fuente de verdad por regla.** Ejemplo vivo: la disponibilidad de la agenda
   y el guardado de una cita usan la **misma** `evaluarFranja`. Si la interfaz ofrece una
   hora que el guardado rechaza, el error es de la interfaz.

## 3. Cómo se da algo por terminado

No hay «listo» sin una corrida fresca que lo demuestre. La cadena completa:

```powershell
cd backend
docker start dental-saas-test          # PostgreSQL 16 en el puerto 5433
$env:DATABASE_URL = "postgresql://postgres:test@127.0.0.1:5433/dental_saas_test?sslmode=disable"
$env:JWT_SECRET   = "secreto-de-pruebas-de-al-menos-32-caracteres-ok"
$env:NODE_ENV     = "test"
npx prisma migrate deploy
npx prisma generate
npx tsc --noEmit
npx vitest run --config vitest.config.e2e.ts
Remove-Item Env:DATABASE_URL, Env:NODE_ENV
npm run smoke:arranque

cd ..\frontend
npm run typecheck
npm run build            # el `prebuild` verifica la configuración de Vercel
npm run test:deploy
npm run test:izipay
```

Reglas de esa cadena:

- **Orden obligatorio**: `migrate deploy` **y después** `generate`. Al revés, el cliente
  de Prisma no conoce las columnas nuevas y los endpoints devuelven 400 sobre campos
  recién añadidos.
- **La suite completa, sola.** El contenedor de PostgreSQL se queda sin memoria si se
  corre a la vez que otro trabajo pesado (ver §4). La suite ya es serial por
  configuración (`fileParallelism: false`) y fija `TZ: America/Lima`.
- **Cuenta las pruebas.** Si el total baja más de lo esperado por lo que tocaste, se ha
  perdido algo. Retirar la prueba de una funcionalidad retirada es correcto; que bajen
  cinco pruebas «sin querer» no.
- **Los seeds no pasan por `tsc`.** Ejecútalos de verdad contra una base de desarrollo
  antes de confiar en un cambio en `prisma/seed*.ts`.
- **Si el encargo es ambiguo, pregunta antes de implementar.** En este proyecto ya se
  construyó una integración completa en la dirección equivocada por no confirmar el
  alcance: una pregunta cuesta una frase, suponer cuesta días.

## 4. Trampas que ya nos costaron tiempo

| Síntoma | Causa real |
|---|---|
| Funciona en local y en Render faltan campos / 400 raros | Se migró sin `prisma generate`, o el build de producción no instaló las `devDependencies` (el CLI de Prisma y `tsx` viven ahí) |
| La suite entera falla de golpe, con «column does not exist» | El contenedor murió con `Exited (137)` (sin memoria) y dejó el esquema desincronizado de `_prisma_migrations`. Reinicia el contenedor y vuelve a migrar; **no** es tu código |
| La sesión se cae a los 15 minutos | La cookie de refresh es `SameSite=Strict`: el navegador debe hablar **con el mismo origen** (proxy `/api` de Cloudflare Pages, antes rewrite de Vercel). `VITE_API_URL` debe estar **vacía** |
| 400 «Referencia inválida» al guardar | Un campo de texto libre que en realidad es una **clave foránea**: valida antes de escribir, con mensaje claro. (Pasó con el ubigeo, ya retirado) |
| «No se puede agendar en el pasado» al editar | Correcto: la regla del pasado se aplica al reprogramar. Las citas del seed están en fechas fijas del pasado |
| El seed falla solo en ejecución | Una línea fusionada o un import roto en `prisma/seed*.ts`: `tsc` no los cubre |
| La suite falla en varios ficheros con «Foreign key constraint violated» **en una limpieza** | Una corrida anterior se cortó y dejó filas huérfanas (p. ej. una suscripción apuntando a un plan que otro spec borra). Rehacer la base de pruebas (`DROP DATABASE … WITH (FORCE)` + `CREATE` + `migrate deploy`) y repetir; no es tu código |

## 5. Antes de confirmar (checklist)

- **Alcance del diff**: solo lo que dijiste. Nada de formatear ficheros ajenos.
- **Nada ignorado se cuela**: `git status` limpio de `.env`, `uploads/`, `backups/`, bases
  locales.
- **Las pruebas no se debilitan**: no se relajan asertos ni se borran casos para pasar.
  Si una prueba tenía que fallar, se explica por qué cambió la regla.
- **La documentación no miente**: si cierras una deuda, se anota en
  `docs/deuda-tecnica.md` **con el porqué**; si cambias el esquema, el fragmento de
  `docs/dental-saas-arquitectura-v2.md` se actualiza.
- **Migraciones**: carpeta nueva numerada a mano (`prisma/migrations/N_nombre/migration.sql`)
  con el SQL comentado justificando la decisión. Nunca se edita una migración ya aplicada.
  Una migración **destructiva** con clientes reales se hace en **dos despliegues**
  (primero el código que deja de usar la columna, después la migración).

## 6. Si trabajas desde PowerShell en Windows

Esto nos costó varias rondas de depuración. El shell es **Windows PowerShell 5.1**:

- `Invoke-RestMethod` devuelve un **array JSON como un único objeto**: `$x | Where-Object`
  no filtra elemento a elemento. Usa `(Invoke-WebRequest …).Content | ConvertFrom-Json`
  y luego `.Where({ … })`, o accede con `[0]`.
- `"$obj.campo"` con un array **concatena** los valores: obtienes ids unidos sin avisar.
- `'{0:d2}' -f [math]::Floor(...)` falla (un `double` no admite formato de entero):
  convierte con `[int]` primero.
- No existen `-Form`, `-SkipHttpErrorCheck` ni `Invoke-RestMethod -Form`.
- `curl.exe` dentro de comandos largos puede fallar con `spawn EPERM`: reestructura en
  lugar de reintentar igual.

## 7. Mapa rápido

| Qué | Dónde |
|---|---|
| Contexto de tenant e aislamiento | `backend/src/core/tenant-context/`, `core/prisma/tenant-extension.ts` |
| Inventario de permisos | `backend/src/core/catalogo/permisos.ts` |
| Pasarela (Izipay) | `backend/src/core/pasarela/`, `modules/facturacion/` |
| Reglas de agenda | `backend/src/modules/citas/citas.service.ts` (`evaluarFranja`) |
| Feed de calendario | `backend/src/modules/feeds-calendario/` |
| Documentos y archivos | `backend/src/core/storage/` — `STORAGE_DRIVER=r2` en producción (bucket R2, S3-API), `local` en desarrollo; `UPLOADS_DIR` solo aplica al driver local; tope 20 MB |
| Avisos por WhatsApp | `frontend/src/services/whatsapp.ts` (manual, `wa.me`) |
| Pantallas | `frontend/src/views/`; componentes reutilizables en `components/ui/` |

## 8. Trabajo pendiente

La lista viva es `docs/deuda-tecnica.md`. Ahora mismo, lo que falta para considerar el
producto lanzado está en los cuatro puntos de cierre de producción (permiso
`billing.manage`, aceptación real del sandbox de Izipay, comprobaciones de producción y
deudas 14–17 de esa lista).
