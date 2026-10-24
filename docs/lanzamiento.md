# Lanzamiento: puesta en producción

> Lista de pasos de cierre de producción con su criterio de «hecho» de cada uno.
> Fuentes: [AGENTS.md](../AGENTS.md) §8, [render-cloudflare-supabase.md](render-cloudflare-supabase.md),
> [despliegue.md](despliegue.md), [izipay-suscripcion.md](izipay-suscripcion.md),
> [deuda-tecnica.md](deuda-tecnica.md) y [backups.md](backups.md).
>
> **Estado general:** nada de esto está confirmado todavía. `render-cloudflare-supabase.md`
> §6 declara que aún **no hay URLs ni proyectos remotos creados/verificados**:
> Render, Vercel y Supabase figuran como «no creado/verificado» y las seis
> verificaciones remotas están «pendientes». Los comandos y SQL de abajo se toman
> literales de la documentación; lo que no se pueda confirmar se marca con
> ⚠️ **AVISO**.

---

## 1. Seed y permiso `billing.manage` en Render

**Acciones** (después del despliegue: build → pre-deploy `npm run deploy:migrate`,
en ese orden — `render-cloudflare-supabase.md` §2), en el **Shell de Render**:

```sh
npm run deploy:seed
```

Equivale a `npm run db:seed`/`tsx prisma/seed.ts` con `DATABASE_URL` directa
**solo en ese proceso**. Crea permisos, planes, catálogos y el owner de
plataforma (no es parte de build/pre-deploy/start; **no ejecutar** `db:seed-demo`
— AGENTS.md regla 7). Tras el seed se puede retirar `PLATFORM_OWNER_PASSWORD`
del entorno.

`db:seed` crea el permiso `billing.manage` (recurso `billing`, acción `manage`,
en `src/core/catalogo/permisos.ts`) y el **alta de clínica otorga el catálogo
completo** ([izipay-suscripcion.md](izipay-suscripcion.md), §Permisos y §Puesta
en producción): el ADMIN de la clínica lo recibe sin pasos extra.

**Criterio de hecho:**

1. `npm run deploy:seed` terminó en el Shell de Render sin error.
2. Login de owner en `/admin/login` con MFA (paso 2 de las verificaciones
   remotas), alta de la clínica de prueba desde el panel de plataforma, y login
   clínico de su ADMIN.
3. La sesión clínica ve la ruta `/mi-plan` (que exige `billing.manage`) y sus
   endpoints `POST /api/facturacion/mi-plan/formtoken`, `GET /api/facturacion/mi-plan`,
   `POST /api/facturacion/mi-plan/validar-retorno` responden sin 403 (403 solo
   si falta el permiso; `payments.write` **no** sirve para el plan).
4. `db:seed-demo` **no** se ha corrido en producción: el panel muestra solo la
   clínica de prueba real, sin la clínica ficticia.

⚠️ **AVISO:** no se puede confirmar que el seed se haya ejecutado en Render, ni
que exista owner de plataforma o clínica de alta remota (tabla del §6 de
`render-cloudflare-supabase.md`: «Pendiente de seed/owner remoto»). Este paso queda
sin verificar hasta tener la URL real y acceso al Shell de Render.

⚠️ **AVISO:** la documentación no incluye una consulta SQL literal para comprobar
`billing.manage` en Supabase; la única comprobación descrita es funcional (ver
`/mi-plan` y probar que sin el permiso devuelve 403, como en
`backend/test/izipay.e2e-spec.ts`). No inventar SQL ad hoc aquí.

---

## 2. Pago real del sandbox de Izipay y periodo extendido

**Acciones** (aceptación pendiente descrita en `izipay-suscripcion.md`
§«Aceptación pendiente: sandbox real»; verificación 5 de `render-cloudflare-supabase.md`):

Con las cinco variables TEST configuradas en Render (`IZIPAY_BASE_URL`,
`IZIPAY_SHOP_ID`, `IZIPAY_CLAVE`, `IZIPAY_CLAVE_HMAC`, `IZIPAY_PUBLIC_KEY`):

1. En Back Office sandbox, configurar la notificación:

   ```text
   POST https://<api-real>.onrender.com/api/webhooks/izipay
   ```

2. Abrir `/mi-plan` y pulsar **«Pagar el plan»** (el cobro del periodo se crea
   o reutiliza solo; el importe sale del servidor).
3. Pagar en SmartForm con tarjeta TEST.
4. La página de resultado espera hasta que `GET mi-plan` refleje el cobro
   `pagado` al llegar la IPN a `POST /api/webhooks/izipay` (la IPN es la fuente
   de verdad; el navegador nunca marca nada como cobrado).
5. Conciliar en BD `IntentoIzipay`/`EventoIzipay`, importe y moneda; para
   `PAID` el importe aceptado coincide exactamente con el intento guardado
   antes de abonar, y el periodo queda extendido **exactamente una vez**.
6. Reenviar **el mismo** IPN desde Back Office: saldo igual, un evento
   aceptado, un único `IZIPAY_ABONO` y periodo **sin segunda extensión**
   (idempotencia: la clave `izipay:<uuid>:PAYMENT_ACCEPTED` es única).
7. Alterar un byte de `kr-answer` manteniendo el hash: **401**, sin cambiar
   cobros, eventos ni auditoría de IPN.

**Criterio de hecho** (los seis puntos anteriores del §Aceptación con
evidencia): `GET mi-plan` muestra el cobro `pagado`, la IPN real llegó al
webhook público configurado, importe/moneda concilian, `periodoFin` extendido
una sola vez (comparar antes/después, como hace
`backend/test/izipay.e2e-spec.ts` con `periodoFin extendido una sola vez`), y
el replay + el byte alterado se comportan como está especificado.

⚠️ **AVISO:** solo se confirmó parcialmente con credenciales TEST
(`CreatePayment` → HTTP 200, `status: SUCCESS`, formToken válido). **Toda esta
comprobación sigue pendiente**: pago real, entrega pública del IPN, conciliación
y replay (tabla del §6 de `render-cloudflare-supabase.md`: «Pendiente de URL pública
y Back Office»). «Pasar la página de resultado» no es evidencia: el único
medio de confirmar es el webhook público observado realmente.

⚠️ **AVISO:** la única consulta SQL literal de la documentación sobre
conciliación es la del diseño general (`izipay-integracion.md` §26) y usa la
tabla genérica del diseño, no el esquema real:

```sql
SELECT id
FROM payment_events
WHERE provider = 'izipay'
  AND external_id = 'TX123456'
  AND event_type = 'PAYMENT_ACCEPTED';
```

En el esquema real las tablas son `IntentoIzipay`/`EventoIzipay`/`WebhookEvent`
con clave idempotente `izipay:<uuid>:PAYMENT_ACCEPTED`; esa SQL es del boceto de
diseño, así que **no aplicarla tal cual contra Supabase**: conciliar leyendo
esas tablas reales (vía shell/psql del proyecto o panel de Supabase) y registrar
aquí lo observado.

---

## 3. Las cuatro comprobaciones de producción

Del §4 de `render-cloudflare-supabase.md`. Se necesita la sesión de plataforma/
clínica del paso 1, y `DOCUMENTO_ID` de 3.c para el paso 3.b.

### 3.a Sesión tras quince minutos

**Acción:** en la sesión **clínica** (para plataforma usar `platform_token` y
navegar a Clínicas, con `/api/platform/auth/refresh`):

```js
localStorage.setItem('token', 'access-token-expirado-de-prueba')
```

Navegar a Pacientes/Pagos: en Network debe verse 401 →
`POST /api/auth/refresh` **en Vercel** → 200 → repetición de la lectura → 200,
sin volver al login. Alternativa: esperar realmente 15 min y repetir una
lectura. Repite lo mismo con la sesión de plataforma.

*Contexto de esta prueba:* la cookie de refresh es
`SameSite=Strict` (`HttpOnly; Secure`), por eso el navegador debe hablar con el
mismo origen vía rewrite `/api` de Vercel y `VITE_API_URL` vacía.

**Criterio de hecho:** el 401 se renueva en silencio en ambas sesiones
(clínica y plataforma), con la cookie `refresh_token` visible en DevTools →
Application → Cookies en el host **Vercel**, HttpOnly, Secure, SameSite Strict,
`path /api/auth` o `/api/platform/auth`. Registrar fecha, navegador, origen y
resultado. No imprimir el token ni la cookie.

⚠️ **AVISO:** no se puede confirmar remotamente (pendiente de despliegue,
tabla §6). SameSite real solo se comprueba en navegador; no sustituir por curl.

### 3.b Archivos tras un redespliegue

**Acción:** redesplegar la API desde Render **manteniendo el disco**
(`/var/data`); con `DOCUMENTO_ID` del paso 3.c y un `ACCESS_TOKEN` vigente (y
`TENANT_ID`/`PACIENTE_ID` de esa sesión, **no versionarlos**):

```powershell
node deploy/verificar-remoto.mjs persistencia
```

Debe descargar el mismo PDF y el mismo hash. Comprobar también una firma
subida antes del redespliegue. Al terminar:
`Remove-Item Env:ACCESS_TOKEN` (y TENANT_ID/PACIENTE_ID si corresponden).

**Criterio de hecho:** el PDF (y la firma) descargados tras el redespliegue
coinciden byte/hash con los subidos antes. Un 404 revela mountPath/UPLOADS_DIR
incorrecto o pérdida real.

⚠️ **AVISO:** pendiente de disco y documento remoto (tabla §6). Requiere haber
completado la subida 3.c primero.

### 3.c Subida de diez megabytes

**Acción** — en una clínica/paciente de prueba, con `ACCESS_TOKEN`, `TENANT_ID`
y `PACIENTE_ID` de esa sesión en el entorno local (no versionar):

```powershell
node deploy/verificar-remoto.mjs subida
```

Genera un PDF válido de ~10 MiB, lo envía **por Vercel** como multipart a
`POST /api/pacientes/:id/documentos/archivo` (`archivo` + `tipo=OTRO`), exige
201 y descarga comparando bytes/hash. Anotar `DOCUMENTO_ID` para el paso 3.b.
No confundir con `POST /documentos` (solo metadatos) ni con las firmas
(`POST /api/consentimientos/:id/firmas`, `archivo` + `rol`); el tope real es
20 MB (`storage/`, `UPLOADS_DIR`).

**Criterio de hecho:** respuesta 201 y hash del archivo descargado idéntico al
subido, todo por Vercel (no directo). Si el proxy devuelve 413, conservar logs
y repetir con `BASE_SUBIDA=https://<api-real>.onrender.com` para diagnosticar
el límite de external rewrites; el bypass Bearer solo se activa con esa
evidencia (no dárselo por hecho).

⚠️ **AVISO:** la generación del PDF 10 486 379 bytes con cabecera PDF está
comprobada localmente, pero **la subida remota sigue pendiente de medida**
(literal de `render-cloudflare-supabase.md` §4.4): el límite ~4.5 MB de las
Functions de Vercel no demuestra el de sus rewrites.

### 3.d TRUST_PROXY comprobado con la IP de auditoría

**Acción:** valor **2** esperado por la cadena navegador → Vercel → Render →
app, **1** para la IPN o una subida directa (render-cloudflare-supabase.md §2).
El valor lo pide el panel de Render, no lo inventa el Blueprint. Antes de
aceptar el despliegue:

1. Revisar `X-Forwarded-For`, la cadena efectiva y los logs de IP en Render y
   Vercel (esto no se automatiza con ningún comando documentado; es lectura de
   logs y comparación manual).
2. Verificar contra lo que quede registrado en `Auditoria` (la tabla que va
   detrás de la IP de auditoría del rate limit y del seguimiento): la IP en los
   registros de mutaciones críticas debe ser la del navegador que hizo la
   acción, no la del proxy/CDN en lugar de la del cliente. En particular,
   verificar que **dos navegadores distintos no comparten el mismo cubo de
   login** (con rutas de distinta longitud el ajuste numérico tiene límites).
   No dar el conteo por exacto solo por el número de marcas del proveedor.
   Un `TRUST_PROXY` mayor que los saltos reales degrada el rate limit por IP a
   un cubo compartido y ensucia la IP de auditoría (`despliegue.md` §0);
   el arranque de producción **rechaza un valor no válido** (verificación local:
   `TRUST_PROXY` vacía con `NODE_ENV=production` sale 1 antes de crear la app).

**Criterio de hecho:** la IP guardada en `Auditoria` para las acciones de esta
sesión coincide con la IP pública del navegador (comprobarla en el router/
whatismyip del momento), y no se observa cubo compartido entre usuarios
distintos. Las peticiones directas a Render (IPN, si tocara escribir) usan el
salto 1 sin enmascarar.

⚠️ **AVISO:** esto depende de las URLs reales y de los logs de Render/Vercel
(que pueden reemplazar/añadir cabeceras); nada de ello existe todavía ni hay
comando automatizado en la documentación que verifique la IP de auditoría.
Pendiente de confirmación manual con evidencia de logs: «cualquier 401/403 de
guard no deja fila en `Auditoria`» (deuda nº 1), así que la IP solo se puede
comparar en las mutaciones críticas que sí la registran.

---

## 4. Copias de Supabase y canal de alertas

### 4.a Copias de Supabase

**Acciones** (`render-cloudflare-supabase.md` §1 y §5, `backups.md`):

1. Elegir plan con **copias diarias/PITR** (el Free puede pausarse por
   inactividad y **no** incluye respaldo recuperable). Configurar el plan del
   proyecto.
2. Verificar las copias visibles en **Database → Backups**.
3. Realizar un **ensayo de restauración en un proyecto de prueba**, con
   conteos por tabla y login posterior.
4. Comprobar también los snapshots diarios del disco de Render (Disk) y
   ensayar una restauración controlada (un snapshot restaura todo el disco y
   pierde cambios posteriores).
5. Definir el resto de copias que siguen abiertas (`despliegue.md` §7, deuda
   nº 14): la copia de archivos es manual (un Cron Job de Render **no puede**
   montar el disco de la API), por Shell/SSH con `archivos:backup` y SCP a otro
   destino; y la copia de base externa con `db:backup-remoto` (timer 04:00,
   sha256, vigilancia de antigüedad) necesita un destino real
   (`RESPALDO_REMOTO`, `rclone config` si aplica).

**Criterio de hecho:** el plan activo muestra backups reales en «Database →
Backups»; existe un proyecto de prueba donde la restauración de una copia
terminó con conteos por tabla correctos y un login posterior exitoso; el disco
de Render tiene snapshots y se probó al menos uno. Para copia externa: existe
`RESPALDO_REMOTO` con restauración desde él probada.

⚠️ **AVISO:** nada de esto está activado ni restaurado (`render-vercel-
supabase.md` §5, literal: «No activado ni restaurado por este trabajo»). Sin
un plan pagado de Supabase y un ensayo real de restauración, este paso **no
está cumplido por más que existan los scripts del repo**.

### 4.b Canal de alertas

**Acciones** (`despliegue.md` §5.1–§6, deuda técnica nº 15):

1. La pieza de vigilancia ya existe y no añade dependencias:

```powershell
cd backend
$env:DATABASE_URL = "postgresql://postgres:test@127.0.0.1:5433/dental_saas_test?sslmode=disable"
npm run vigilancia
# Contra el staging: VIGILANCIA_API_URL=http://127.0.0.1:3001
```

   Variables: `VIGILANCIA_API_URL`, `VIGILANCIA_SOLO_BD=1`,
   `VIGILANCIA_VENTANA_HORAS` (24), `VIGILANCIA_MAX_FALLOS_PCT` (5),
   `VIGILANCIA_MAX_CRUZADOS` (0: cualquier `acceso_cruzado` es crítico).
   Sale 0 OK / 1 revisar / 2 crítico.

2. Conectar el canal real: los timers systemd activan `dental-saas-aviso@.service`,
   que si existe llama a `/etc/dental-saas/avisos.sh` — ahí es donde conecta el
   canal del equipo (correo/webhook). En Render **no hay timers systemd ni Cron
   Jobs** (render-cloudflare-supabase.md §5), así que hay que definir un
   equivalente (p. ej. servicio externo con `DIRECT_URL` y la imagen de
   operaciones que corra la vigilancia/copia) o asumir chequeo manual.
3. Operación programada en un servidor propio (si aplica, `despliegue.md` §5.1):
   `systemctl enable --now dental-saas-db-backup.timer`,
   `dental-saas-archivos-backup.timer`, `dental-saas-backup-remoto.timer`,
   `dental-saas-vigilancia.timer` y `systemctl list-timers --all | grep dental`.

**Criterio de hecho** (deuda nº 14/15 de `deuda-tecnica.md`, cerrándolas):
existe un destino de copia **externo a la máquina** con restauración probada,
y un destinatario/canal real (correo/webhook del equipo) al que la vigilancia
y los fallos de backup envían avisos; se ha producido al menos un aviso de
prueba para demostrar que llega. Para asegurar el chequeo periódico en Render:
el trabajo de vigilancia corre de forma automática
(VIGILANCIA_API_URL apuntando a la API real y `DATABASE_URL` = base de
producción), no solo manualmente en la terminal.

⚠️ **AVISO:** «sin canal real de alertas… ningún correo/webhook configurado»
(deuda técnica nº 15): el gancho vive en una máquina Linux systemd que, según la
documentación, es el **servidor de staging/Docker**, no Render. En Render
hoy **no se puede confirmar** ninguna automatización: ni timers, ni Cron Job
(no puede montar el disco de la API), ni destino `RESPALDO_REMOTO`. Este paso
queda marcado como **no verificado** hasta decidir dónde corre la vigilancia
en producción y probar de verdad que el aviso llega a alguien.

---

## Cierre final

El lanzamiento se da por completado solo cuando:

- Los cuatro pasos tienen su evidencia registrada en el acta del §6 de
  `render-cloudflare-supabase.md` en lugar de «Pendiente».
- La clínica real ya puede darse de alta desde el panel y empezar de cero
  (primer día guiado en [primeros-pasos-clinica.md](primeros-pasos-clinica.md));
  el «ensayo de migración» solo aplica si una clínica trae datos
  (`despliegue.md` §3, «NO es un paso del lanzamiento»).
- No queda ningún ⚠️ **AVISO** de esta lista sin resolver o sin anotarse en
  `docs/deuda-tecnica.md` con la fecha y el porqué de lo que se pospone.
