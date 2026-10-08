# Dental SaaS — Arquitectura, mejoras y plan de implementación (v2)

> **Versión:** 2.0
> **Estado:** Documento consolidado para implementación (reemplaza a `dental-saas-arquitectura-completa.md`)
> **Ámbito:** Arquitectura multi-tenant, modelo de datos corregido, mejoras priorizadas, plan de implementación por fases y evolución del software
> **Origen:** Transformación del sistema actual (monoclínica, `E:\clinicaDental`) a SaaS multi-tenant

---

## Tabla de contenido

1. [Propósito y alcance](#1-propósito-y-alcance)
2. [Estado actual → estado objetivo](#2-estado-actual--estado-objetivo)
3. [Principios arquitectónicos](#3-principios-arquitectónicos)
4. [Decisiones de arquitectura (ADRs)](#4-decisiones-de-arquitectura-adrs)
5. [Arquitectura objetivo](#5-arquitectura-objetivo)
6. [Modelo de datos multi-tenant (Prisma corregido)](#6-modelo-de-datos-multi-tenant-prisma-corregido)
7. [Core multi-tenant: contexto, guard y extensión](#7-core-multi-tenant-contexto-guard-y-extensión)
8. [Seguridad en profundidad](#8-seguridad-en-profundidad)
9. [Storage multi-tenant](#9-storage-multi-tenant)
10. [Auditoría](#10-auditoría)
11. [Observabilidad y health checks](#11-observabilidad-y-health-checks)
12. [Backups y recuperación](#12-backups-y-recuperación)
13. [Mejoras priorizadas](#13-mejoras-priorizadas)
14. [Plan de implementación por fases](#14-plan-de-implementación-por-fases)
15. [Estrategia de pruebas](#15-estrategia-de-pruebas)
16. [Evolución del software](#16-evolución-del-software)
17. [Checklist antes de vender](#17-checklist-antes-de-vender)
18. [Riesgos y mitigaciones](#18-riesgos-y-mitigaciones)
19. [Próximos pasos](#19-próximos-pasos)
20. [Registro de deuda técnica](#20-registro-de-deuda-técnica)

---

## 1. Propósito y alcance

Transformar el sistema actual de gestión dental (una clínica, un odontólogo, un usuario) en una plataforma **SaaS multi-tenant** que permita a múltiples clínicas operar sobre una misma aplicación, una misma API y una misma infraestructura, **sin compartir información entre ellas**.

Este documento corrige los cuatro problemas estructurales del documento v1:

1. **Contradicción de claves:** el v1 declaraba FK compuestas `(tenant_id, id)` pero el esquema Prisma no las implementaba, y la extensión Prisma propuesta no era compatible con `findUnique`.
2. **Orden de ejecución incorrecto** del `TenantContext` (middleware leyendo `req.user` antes del guard).
3. **Contradicción sobre RLS** (`service_role` desactiva RLS; la "segunda capa" descrita no aplicaba).
4. **Regresión funcional:** el v1 sustituía el modelo clínico real (odontograma NTS 188 versionado, consentimientos, historial, saldos de pagos) por versiones simplificadas que perdían funcionalidad ya construida y probada.

**Regla rectora de este documento:** el SaaS debe **envolver** las entidades actuales con `tenantId`, **no reescribirlas**.

---

## 2. Estado actual → estado objetivo

| Dimensión | Actual (monoclínica) | Objetivo (SaaS multi-tenant) |
|---|---|---|
| Tenants | 1 implícito | N clínicas, aislamiento estricto |
| Usuarios | 1 odontólogo + 1 superadmin | `User` global con `Membership` por clínica |
| Roles | `odontologo` / `superadmin` | RBAC por tenant (admin, odontólogo, recepción, asistente) |
| Planes | No aplica | `Plan` → `PlanFeature` → `Subscription` → `Entitlements` |
| Sedes | 1 implícita | `Sede` (plan "Clínica" multi-sede) |
| Numeración recibos | `MAX()+1` global | Secuencia por tenant |
| Storage | `uploads/` plano | `/tenants/{tenantId}/...` privado + URLs firmadas |
| Auditoría | Tabla existe, nadie la escribe | Append-only con interceptor |
| Auth | bcrypt + JWT 8h en localStorage | Argon2id + JWT corto + refresh rotativo (etapa 2) |
| Google Calendar | 1 cuenta por usuario | 1 cuenta por `(tenant, user)` |
| WhatsApp | `wa.me` con plantillas | `PlantillaWhatsApp` por tenant |

**Lo que NO debe perderse** (ya existe y funciona en el código actual):

- Odontograma NTS 188 **versionado** (`Odontograma` + `HallazgoCatalogo` + `OdontogramaHallazgo` + `OdontogramaEvento`), bloqueo por firma, "anular ≠ borrar".
- Consentimientos informados (plantillas COP, firmas PNG, PDF firmado, revocación).
- Historial clínico por paciente/cita.
- Pagos con `montoTotal` / `montoPagado` / `saldo` + cuotas.
- Compras atómicas (transacción `Serializable` que actualiza stock y genera el egreso).
- Google Calendar OAuth con refresh token cifrado (AES-256-GCM).
- `Ubigeo`, `Especialidad`, catálogo NTS 188.

---

## 3. Principios arquitectónicos

1. **Aislamiento de tenants por encima de todo.** Ninguna consulta, archivo o respuesta puede cruzar tenants.
2. **El `tenant_id` se deriva del servidor** (sesión/membresía), **nunca** del frontend ni del body.
3. **Defensa en profundidad** (capas, no una sola barrera).
4. **Entitlements desacoplados** de los módulos (nada de `if (plan === 'pro')` disperso).
5. **API stateless** desde el primer día.
6. **No escalar prematuramente.** Un VPS + una API + un Postgres basta para las primeras decenas de clínicas.
7. **Preservar lo que funciona.** El modelo clínico actual es un activo; se envuelve, no se tira.

---

## 4. Decisiones de arquitectura (ADRs)

> Cada decisión resuelve un bloqueador identificado en el análisis del v1.

### ADR-001 — Multi-tenancy lógico (base de datos compartida)

**Decisión:** una sola PostgreSQL con columna `tenantId` en todas las entidades del tenant.

**Alternativa considerada:** schema-per-tenant o BD-per-tenant. Descartada: coste operativo alto y nulo beneficio a esta escala.

**Consecuencia:** el aislamiento depende de la capa de aplicación + (etapa 2) RLS. Obliga a tests de aislamiento automáticos.

### ADR-002 — Estrategia de ID y de FK

**Decisión:** `id` **UUID global único** como PK en todas las tablas + columna `tenantId` obligatoria + **índices y uniques compuestos** `[tenantId, ...]`. Las FKs entre entidades del tenant son por `id` (único global); `tenantId` se **denormaliza** en las tablas hijas para que la extensión Prisma pueda filtrar sin joins.

**Alternativa considerada:** claves primarias compuestas `@@id([tenantId, id])` con FKs compuestas. Es la opción de mayor aislamiento a nivel de esquema, pero:
- Hace **incompatible** la inyección automática de `tenantId` con `findUnique` (Prisma exige claves únicas exactas).
- Multiplica la complejidad de todas las relaciones y migraciones.
- A 1–3 clínicas, el riesgo que mitiga (escritura SQL directa cruzada) ya lo cubren la extensión Prisma y el hecho de que todo el acceso pasa por la API.

**Regla de compensación:** la **extensión Prisma** inyecta `tenantId` en `create`/`findMany`/`findFirst`/`count`, y las **mutaciones por id** (`update`/`delete`/`findUnique`) verifican explícitamente la pertenencia antes de operar. RLS se añade en etapa 2 como backstop.

### ADR-003 — Enforcement del tenant

**Decisión:** `TenantContext` (AsyncLocalStorage) **creado en el guard** (no en middleware) + **extensión Prisma** `$allOperations` que inyecta/filtra `tenantId` automáticamente.

**Motivo:** el middleware Nest corre *antes* del guard, así que no puede leer `req.user`. El contexto se crea en `JwtAuthGuard`/`TenantGuard`, donde `req.user` ya existe.

### ADR-004 — Autenticación

**Decisión:** mantener **NestJS propio** (no migrar a Supabase Auth). Etapa 1 conserva bcrypt (10) + JWT, pero con **expiración corta (15 min) + refresh token rotativo en cookie httpOnly** (`SameSite=Strict`, `Secure`) y **rate limit estricto en login**.

**Evolución (etapa 2):** migrar hash a **Argon2id** y añadir **MFA (TOTP)** obligatorio para `PLATFORM_ADMIN`.

**Motivo:** el sistema actual ya tiene auth NestJS funcional; Supabase Auth ahora implicaría rehacer sesión sin beneficio inmediato.

### ADR-005 — Tenant activo y usuario multi-clínica

**Decisión:** el JWT lleva **solo `sub` (userId)**, sin `tenantId` fijo. El cliente envía el tenant activo vía header `X-Tenant-Id` (o subdominio, en el futuro). `TenantGuard` valida que el usuario tenga **membresía ACTIVA** en ese tenant y que el tenant esté ACTIVO.

**Motivo:** un `User` puede pertenecer a varias clínicas (`User → N × Membership`). Fijar `tenantId` en el JWT obliga a re-login para cambiar de clínica.

### ADR-006 — RLS

**Decisión:** **no activar RLS en etapa 1.** Usar la extensión Prisma + tests de aislamiento como única barrera de consulta.

**Evolución (etapa 2):** RLS con **rol dedicado** (no `service_role`) y `set_config('app.current_tenant_id', ...)` por transacción.

**Motivo:** con `service_role`, RLS no aplica; la "segunda capa" del v1 era una ilusión. RLS bien hecho exige un rol con permisos y pruebas que no aportan en el MVP y son fuente de errores silenciosos.

### ADR-007 — Numeración por tenant

**Decisión:** recibos (`REC-<año>-NNNN`), tokens de cita (`CIT-XXXXXX`) y códigos de compra se generan con **secuencia por tenant** y unicidad `@@unique([tenantId, codigo])`.

**Motivo:** hoy `codigoRecibo` es `@unique` global; con 2 clínicas colisionarían al primer `REC-2026-0001`.

### ADR-008 — Facturación del SaaS

**Decisión:** etapa 1 **manual** (panel de plataforma marca la suscripción). Pero el modelo se diseña desde el inicio con **idempotencia** (clave idempotente por cobro) y **firma de webhooks** para cuando se conecte pasarela (Izipay/Mercado Pago/Culqi/Stripe).

**Motivo:** cobrar suscripciones sin idempotencia ni firma de webhooks es la vía más directa a cobros duplicados.

### ADR-009 — Conservar el modelo clínico

**Decisión:** el esquema parte del `schema.prisma` actual y le añade `tenantId` + `deletedAt` + uniques/índices por tenant, **conservando** odontograma NTS 188, consentimientos, historial y pagos con saldo.

**Motivo:** el v1 los eliminaba; eso era una regresión funcional y una pérdida de trabajo probado.

### ADR-010 — Infraestructura

**Decisión:** Cloudflare (DNS/WAF) + Vercel (Vue) + DigitalOcean VPS con Docker (NestJS + Nginx) + Supabase (Postgres + Storage). Una instancia de API stateless.

**Evolución:** Redis/colas en etapa 2; load balancer y réplicas en etapa 3. No antes.

---

## 5. Arquitectura objetivo

```text
                              INTERNET
                                 |
                                 v
                         +---------------+
                         |   Cloudflare  |
                         | DNS/SSL/WAF/  |
                         | rate limit    |
                         +-------+-------+
                                 |
                 +---------------+---------------+
                 |                               |
                 v                               v
         +---------------+               +----------------+
         |    Vercel     |               | DigitalOcean   |
         | Vue 3 + Vite  |               | VPS + Docker   |
         | app.dominio   |               | api.dominio    |
         +-------+-------+               +--------+-------+
                 |                                |
                 |                        +-------+--------+
                 |                        | Reverse proxy  |
                 |                        | (Nginx/Traefik)|
                 |                        +-------+--------+
                 |                                |
                 |                        +-------+--------+
                 |                        | NestJS API     |
                 |                        | stateless      |
                 |                        +-------+--------+
                 |                                |
                 v                                v
         (JWT + X-Tenant-Id)            +----------------+
                                         |   Supabase     |
                                         | PostgreSQL      |
                                         | Storage privado |
                                         +----------------+
```

### Backend NestJS (estructura)

```text
src/
├── core/
│   ├── auth/               # JWT, login, refresh, MFA
│   ├── tenant-context/     # AsyncLocalStorage + TenantGuard
│   ├── prisma/             # PrismaService + extensión tenant
│   ├── guards/             # JwtAuth, Tenant, Membership, Permission, Feature
│   ├── interceptors/       # Audit, Logging, Transform
│   ├── filters/            # Mapeo de excepciones Prisma
│   └── health/
├── platform/               # Administración del SaaS (global)
│   ├── tenants/
│   ├── users/              # PlatformUser
│   ├── memberships/
│   ├── roles/
│   ├── permissions/
│   ├── plans/
│   ├── subscriptions/
│   ├── entitlements/
│   └── admin/
├── clinical/               # Módulos clínicos (envueltos con tenantId)
│   ├── patients/
│   ├── history/
│   ├── appointments/
│   ├── treatments/
│   ├── odontogram/         # NTS 188 versionado (conservado)
│   ├── consents/           # consentimientos (conservado)
│   └── documents/
├── billing/
│   ├── payments/
│   └── installments/
├── inventory/
│   ├── items/
│   ├── purchases/
│   └── suppliers/
├── dashboard/
├── config/                 # TenantConfig + PlantillaWhatsApp
└── main.ts
```

### Frontend Vue 3 (estructura)

Proyecto propio en `frontend/` (Vue 3.5 + Vite 8 + Pinia 4 + Router 5 + Tailwind 4),
hermano de `backend/`. **Estado actual — cimientos construidos y verificados:**

```text
frontend/src/
├── services/                   # capa de dominio: las vistas NO llaman a `api.*`
│   ├── api.ts                  # axios: Bearer + X-Tenant-Id; 401 → evento (sin recarga)
│   ├── errores.ts              # mensajeDeError / esNoEncontrado / esProhibido / esConflicto
│   ├── fechas.ts               # formatearFecha vs formatearFechaUTC, deInputFecha, sumarDias…
│   ├── pacientes.ts            # expediente y documentos (subida y descarga)
│   ├── citas.ts                # agenda, estados y sus etiquetas
│   └── catalogos.ts            # tratamientos, sedes y equipo
├── stores/
│   ├── session.ts              # usuario + clínicas + activa (rol, permisos, features)
│   └── theme.ts                # claro/oscuro (la clase se aplica antes de pintar)
├── components/
│   ├── ui/                     # ModalBase, ModalConfirmar, SelectorEntidad, AvisoError, …
│   ├── layout/                 # navigation.ts (fuente única del menú) + AppSidebar
│   ├── pacientes/              # formulario, documentos, historial, odontogramas
│   └── citas/CitaFormModal.vue
├── layouts/AppLayout.vue       # cabecera + menú (superpuesto en móvil)
├── router/index.ts             # guard: token → sesión → clínica → permiso
└── views/
    ├── auth/                   # LoginView, SeleccionClinicaView
    ├── pacientes/              # PacientesView, PacienteDetalleView
    ├── agenda/AgendaView.vue   # vista del día con acciones de estado
    ├── DashboardView.vue       # comprobación del enlazado multi-clínica
    └── EnConstruccionView.vue  # relleno de los módulos pendientes
```

**Pendiente:** odontograma (editor gráfico), consentimientos, usuarios y sedes.
Las rutas ya están declaradas con su `meta.permiso`, así que sustituir
`EnConstruccionView` por la vista real no obliga a tocar el enrutado ni el menú.
Hechos: pacientes, agenda, pagos (lista, detalle, alta con cuotas, abonos,
anulación; botón «Cobrar» en la agenda), inventario (insumos con entradas y
salidas, proveedores, compras con líneas y detalle) y panel `/admin`.

**Regla de oro:** el frontend **oculta** lo no permitido; el backend **rechaza** lo no permitido.

### El endpoint que hace posible el multi-clínica

El JWT lleva **solo `sub`** (ADR-005), así que el frontend no puede deducir de él ni
quién es el usuario ni a qué clínicas pertenece. Eso obliga a un endpoint de sesión:

```text
GET /api/auth/sesion
Authorization: Bearer <access_token>
X-Tenant-Id: <tenantId>            ← OPCIONAL

200 → {
  usuario: { id, email, nombre, cop },
  tenants: [ { id, nombre, slug, rol, sedeId } ],
  activo: null | { tenantId, rol, sedeId, permissions: string[], features: {...} }
}
```

- **Sin `X-Tenant-Id`** → `activo: null` y el frontend muestra el selector de clínica.
- **Con `X-Tenant-Id` válido** → `activo` resuelto (permisos del rol y features del plan).
- **Con `X-Tenant-Id` inválido o ajeno** → **403**, como el resto de la API.

Se apoya en `@TenantOpcional()`: con esa marca, `TenantGuard` deja pasar la petición
**sin validar** cuando no hay cabecera (el contexto queda `validado: false`, igual que
en una ruta `@Public`). Si hay cabecera, el camino es el de siempre.

> **Consecuencia importante para cualquier servicio que corra sin contexto validado:**
> la extensión Prisma **no filtra** (solo lo hace con `validado: true`), así que estas
> rutas deben acotar por sí mismas. Y hay un matiz que no es evidente: las membresías
> se leen **desde `User`** (`user.findUnique({ select: { memberships: … } })`), no con
> `membership.findMany({ where: { userId } })`. El motivo es que `Membership` está en
> `TENANT_MODELS` y `findMany` en las operaciones de lectura, de modo que con una
> cabecera válida la extensión **inyectaría `tenantId` en el `where`** y la lista se
> recortaría a esa clínica: un usuario multi-clínica perdería el resto de sus clínicas
> justo en el endpoint que existe para listarlas. La extensión solo reescribe el modelo
> **raíz** de la operación, no las relaciones anidadas.

### Convención de fechas (afecta a todo formulario)

Un campo `DateTime`/`@db.Date` de Prisma **rechaza** la forma corta `aaaa-mm-dd`
—justo la que devuelve `<input type="date">`— con «Datos inválidos», que el filtro
global traduce a **400**. La regla es que **el servicio normaliza la fecha en el
borde**, como ya hacían citas, historiales, odontograma, compras, pagos y
plataforma con `new Date(dto.fecha)`:

```text
DTO: "2026-03-10"  →  new Date(...)  →  Prisma        (en el servicio)
Prisma: ISO UTC    →  timeZone: 'UTC'                 (al mostrar una fecha sin hora)
```

`pacientes` era el **único** módulo que pasaba la cadena directamente a Prisma, de
modo que guardar una fecha de nacimiento fallaba aunque el DTO la aceptara. Ya está
corregido: la API es uniforme y el cliente puede enviar la forma corta o el
instante completo.

Al **mostrar** hay una segunda mitad que no es opcional: las columnas sin hora se
guardan como medianoche UTC, así que formatearlas en hora local las adelanta un día
en husos negativos (Lima es UTC-5): el 09/03 aparecería como 08/03.

- **Fecha sin hora** (nacimiento, `HistorialClinico.fecha`, vencimiento de cuota):
  `formatearFechaUTC` (`timeZone: 'UTC'`).
- **Instante real** (`createdAt`, `firmadoEn`): `formatearFecha`, en hora local.

Nada de esto lo detecta el compilador, y tampoco aparece en los e2e que montan la app
sin el `ValidationPipe` global. Por eso hay specs de **contrato**
(`contrato-paciente`, `contrato-modulos`, `contrato-inventario-clinico`) que envían
los cuerpos tal como los construye el cliente y fijan las dos mitades.

> **Simétrico: al mostrar y al CALCULAR.** Formatear en UTC no basta; cualquier
> **cálculo** sobre una columna `@db.Date` —el día de la semana, comparar con un
> rango de descansos— debe leerla también en UTC. `CitasService` usaba `getDay()`
> local, y como el valor es medianoche UTC, en Lima el 05/10/2026 (lunes) se leía
> como **domingo**: el horario se validaba contra el día anterior, de modo que **un
> domingo se aceptaba** (validado como sábado) y un lunes se rechazaba. El spec
> `citas-horario` lo fija, y la suite fuerza `TZ=America/Lima` porque CI corre en UTC
> y ahí el desplazamiento no existe: el fallo habría pasado desapercibido.

### Regla de agenda: no se agenda en el pasado

`CitasService` rechaza crear o **mover** una cita a una franja que ya pasó. La cita
se sitúa en una fecha civil + una hora local del consultorio, así que el instante se
reconstruye con las partes UTC de la fecha (columnas `@db.Date`) y la hora indicada.

- Se valida en `crear` y al **mover** (si cambia fecha u hora).
- **No** se valida al cambiar solo el estado o la observación: marcar como realizada
  una cita de ayer debe seguir funcionando.
- El mensaje nombra la franja (`... la franja 2026-10-05 11:00 ya pasó`) para que no
  haya que deducir a qué se refiere.

Orden de las validaciones en `crear`: rango → **pasado** → paciente/tratamiento/sede
→ horario y descansos → solapamiento. Lo primero que se comprueba es lo que el
usuario necesita leer: antes, intentar agendar para una hora ya pasada devolvía «El
consultorio no atiende el día dom» y ocultaba el motivo real.

### Trampa: un cuerpo declarado como objeto literal no se valida

```typescript
@Body() dto: { code: string }   // ❌ el ValidationPipe NO valida nada
@Body() dto: MfaCodeDto         // ✅ valida (el metatipo es una clase)
```

El `ValidationPipe` solo valida cuando el metatipo del parámetro es una **clase con
decoradores**. Para un objeto literal, TypeScript emite `Object` y el pipe lo salta
en silencio: el `whitelist` no se aplica, los campos que faltan llegan como
`undefined` y los tipos equivocados pasan tal cual. Ha mordido ya dos veces:

- `Partial<Dto>` en un controlador → el whitelist no filtraba nada.
- Los cuerpos de MFA del panel: `POST /platform/auth/mfa/verify` (que es `@Public()`)
  con `code: 123456` llegaba a `verificarTotp`, que hace `code.replace(...)` →
  **500** en lugar de 400. Corregido con DTO reales, y `verificarTotp` además
  rechaza lo que no sea cadena.

Quedan **dos** cuerpos crudos y son deliberados: el webhook de pagos (su validez la
da la **firma**, no el esquema) y un parámetro sin usar en `subscriptions`.

> Nota de orden de ejecución: los **guards corren antes que los pipes**. Un endpoint
> protegido con un cuerpo inválido devuelve 401/403, no 400, así que la validación
> de un DTO solo se puede probar en rutas alcanzables (`@Public` o con credenciales
> válidas).

### Trampa: `include: true` sobre un modelo con columnas sensibles

```typescript
include: { user: true }        // ❌ devuelve passwordHash, passwordAlgo, mfaSecret
select: { user: { select: { id: true, email: true, nombre: true } } }   // ✅
```

`include: true` trae la fila **completa** del modelo relacionado. Ocurrió en
`GET /memberships`: el equipo de la clínica se servía con `include: { user: true }`,
así que el hash de la contraseña y el secreto TOTP de cada miembro viajaban al
cliente. Ya está corregido con un `select` explícito.

Regla: **toda respuesta que atraviese una relación usa `select`**, aunque hoy
parezca que no hay nada sensible. Vale igual para `User` (credenciales),
`Tenant` (configuración) y `GoogleAccount` (tokens cifrados).

---

## 6. Modelo de datos multi-tenant (Prisma corregido)

> Esquema completo. Conserva el modelo clínico actual, añade `tenantId` + `deletedAt` + uniques/índices por tenant, y resuelve los hallazgos de la auditoría (versionado atómico del odontograma, `cuerpoSnapshot`, unicidad por tenant, trazabilidad de firma/revocación).

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

// ============================================================
// PLATAFORMA (global — sin tenant)
// ============================================================

model Plan {
  id            String   @id @default(uuid())
  codigo        String   @unique
  nombre        String
  descripcion   String?
  precioMensual Decimal  @db.Decimal(10, 2)
  moneda        String   @default("PEN")
  activo        Boolean  @default(true)
  features      PlanFeature[]
  suscripciones Subscription[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model PlanFeature {
  id         String  @id @default(uuid())
  planId     String
  clave      String
  habilitado Boolean @default(true)
  limite     Int?
  plan       Plan    @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@unique([planId, clave])
}

model Subscription {
  id            String            @id @default(uuid())
  tenantId      String            @unique
  planId        String
  estado        EstadoSuscripcion @default(TRIAL)
  iniciadaEn    DateTime          @default(now())
  periodoInicio DateTime
  periodoFin    DateTime
  canceladaEn   DateTime?
  metadata      Json?
  tenant        Tenant            @relation(fields: [tenantId], references: [id])
  plan          Plan              @relation(fields: [planId], references: [id])
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
}

enum EstadoSuscripcion {
  TRIAL
  ACTIVE
  PAST_DUE
  SUSPENDED
  CANCELLED
  EXPIRED
}

model PlatformUser {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  nombre       String
  rol          String   @default("soporte") // owner | soporte | finanzas
  mfaEnabled   Boolean  @default(false)
  mfaSecret    String?
  activo       Boolean  @default(true)
  auditLogs    PlatformAuditLog[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model PlatformAuditLog {
  id             String       @id @default(uuid())
  platformUserId String
  accion         String
  recurso        String
  recursoId      String?
  metadata       Json?
  ip             String?
  userAgent      String?
  usuario        PlatformUser @relation(fields: [platformUserId], references: [id])
  createdAt      DateTime     @default(now())

  @@index([createdAt])
}

// ============================================================
// TENANT / IDENTIDAD
// ============================================================

enum TenantStatus {
  ACTIVE
  SUSPENDED
  CANCELLED
}

model Tenant {
  id          String       @id @default(uuid())
  slug        String       @unique
  nombre      String
  razonSocial String?
  estado      TenantStatus @default(ACTIVE)
  suscripcion Subscription?
  sedes       Sede[]
  memberships Membership[]
  roles       Role[]
  pacientes   Paciente[]
  auditorias  Auditoria[]
  config      TenantConfig?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  deletedAt   DateTime?
}

model Sede {
  id          String   @id @default(uuid())
  tenantId    String
  nombre      String
  direccion   String?
  telefono    String?
  esPrincipal Boolean      @default(false)
  tenant      Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  memberships Membership[]
  createdAt   DateTime     @default(now())
  deletedAt   DateTime?

  @@unique([tenantId, nombre])
  @@index([tenantId])
}

enum UserStatus {
  ACTIVE
  INACTIVE
  BLOCKED
}

model User {
  id           String       @id @default(uuid())
  email        String       @unique
  passwordHash String
  nombre       String
  estado       UserStatus   @default(ACTIVE)
  mfaEnabled   Boolean      @default(false)
  mfaSecret    String?
  lastLoginAt  DateTime?
  memberships  Membership[]
  auditorias   Auditoria[]
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
}

enum MemberStatus {
  ACTIVE
  INACTIVE
}

model Membership {
  id       String       @id @default(uuid())
  tenantId String
  userId   String
  roleId   String
  sedeId   String?
  estado   MemberStatus @default(ACTIVE)
  joinedAt DateTime     @default(now())
  tenant   Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user     User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  role     Role         @relation(fields: [roleId], references: [id])
  sede     Sede?        @relation(fields: [sedeId], references: [id])

  @@unique([tenantId, userId])
  @@index([tenantId, estado])
}

model Role {
  id          String           @id @default(uuid())
  tenantId    String
  codigo      String
  nombre      String
  esSistema   Boolean          @default(false)
  tenant      Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  memberships Membership[]
  permisos    RolePermission[]

  @@unique([tenantId, codigo])
}

model Permission {
  id          String           @id @default(uuid())
  codigo      String           @unique
  recurso     String
  accion      String
  descripcion String?
  roles       RolePermission[]
}

model RolePermission {
  roleId       String
  permissionId String
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
}

// ============================================================
// CLÍNICO (tenant)
// ============================================================

// Catálogo compartido (global): Ubigeo Perú
model Ubigeo {
  codigo       String @id
  departamento String
  provincia    String
  distrito     String
  pacientes    Paciente[]

  @@index([departamento, provincia])
}

model Paciente {
  id                         String    @id @default(uuid())
  tenantId                   String
  tipoDoc                    String    @default("DNI")
  numDoc                     String?
  nombres                    String
  apellidos                  String
  fechaNac                   DateTime?
  sexo                       String?
  grupoSanguineo             String?
  telefono                   String?
  email                      String?
  direccion                  String?
  ubigeoCodigo               String?
  ubigeo                     Ubigeo?   @relation(fields: [ubigeoCodigo], references: [codigo])
  contactoEmergenciaNombre   String?
  contactoEmergenciaTelefono String?
  representanteNombre        String?
  representanteDni           String?
  representanteDomicilio     String?
  representanteParentesco    String?
  alergias                   String?
  enfermedades               String?
  medicamentos               String?
  habitos                    String?
  antecedentes               String?
  activo                     Boolean   @default(true)
  tenant                     Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  citas                      Cita[]
  historiales                HistorialClinico[]
  documentos                 DocumentoPaciente[]
  odontogramas               Odontograma[]
  pagos                      Pago[]
  consentimientos            ConsentimientoFirmado[]
  createdAt                  DateTime  @default(now())
  updatedAt                  DateTime  @updatedAt
  deletedAt                  DateTime?

  @@unique([tenantId, tipoDoc, numDoc])
  @@index([tenantId, apellidos, nombres])
  @@index([tenantId, telefono])
}

model DocumentoPaciente {
  id            String   @id @default(uuid())
  tenantId      String
  pacienteId    String
  nombreArchivo String
  tipo          String
  mimeType      String
  tamanioKb     Int?
  storageKey    String
  url           String?
  paciente      Paciente @relation(fields: [pacienteId], references: [id], onDelete: Cascade)
  createdAt     DateTime @default(now())
  deletedAt     DateTime?

  @@index([tenantId, pacienteId, tipo])
}

model Especialidad {
  id           String        @id @default(uuid())
  tenantId     String
  nombre       String
  descripcion  String?
  activo       Boolean       @default(true)
  tratamientos Tratamiento[]
  createdAt    DateTime      @default(now())

  @@unique([tenantId, nombre])
}

model Tratamiento {
  id              String         @id @default(uuid())
  tenantId        String
  especialidadId  String?
  nombre          String
  descripcion     String?
  precio          Decimal        @db.Decimal(10, 2)
  duracionMin     Int            @default(30)
  activo          Boolean        @default(true)
  especialidad    Especialidad?  @relation(fields: [especialidadId], references: [id])
  citas           Cita[]
  pagoDetalles    PagoDetalle[]
  odontoEventos   OdontogramaEvento[]
  odontoHallazgos OdontogramaHallazgo[]
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  deletedAt       DateTime?

  @@unique([tenantId, nombre])
  @@index([tenantId, activo, nombre])
}

enum EstadoCita {
  pendiente
  confirmada
  recordatorio_enviado
  reprogramada
  cancelada
  realizada
  no_asistio
}

model Cita {
  id                    String     @id @default(uuid())
  tenantId              String
  token                 String
  pacienteId            String
  tratamientoId         String?
  sedeId                String?
  dentistaId            String?
  fecha                 DateTime   @db.Date
  horaInicio            String     // "09:00"
  horaFin               String     // "10:00" — fin explícito (solapamiento)
  estado                EstadoCita @default(pendiente)
  observacion           String?
  recordatorioEnviadoEn DateTime?
  googleEventId         String?
  paciente              Paciente   @relation(fields: [pacienteId], references: [id], onDelete: Cascade)
  tratamiento           Tratamiento? @relation(fields: [tratamientoId], references: [id])
  historiales           HistorialClinico[]
  odontoEventos         OdontogramaEvento[]
  odontoHallazgos       OdontogramaHallazgo[]
  pagos                 Pago[]
  createdAt             DateTime   @default(now())
  updatedAt             DateTime   @updatedAt
  deletedAt             DateTime?

  @@unique([tenantId, token])
  @@index([tenantId, fecha, estado])
  @@index([tenantId, pacienteId, fecha])
}

model HistorialClinico {
  id                   String   @id @default(uuid())
  tenantId             String
  pacienteId           String
  citaId               String?
  fecha                DateTime @db.Date
  hora                 String?
  motivo               String
  sintomas             String?
  diagnostico          String?
  tratamientoRealizado String?
  prescripcion         String?
  paciente             Paciente @relation(fields: [pacienteId], references: [id], onDelete: Cascade)
  cita                 Cita?    @relation(fields: [citaId], references: [id])
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([tenantId, pacienteId, fecha])
}

// ---- Odontograma NTS 188 (conservado, versionado) ----

model Odontograma {
  id            String   @id @default(uuid())
  tenantId      String
  pacienteId    String
  tipo          String   @default("inicial")
  version       Int      @default(1)
  estado        String   @default("borrador")
  piezas        Json
  observaciones String?
  fecha         DateTime @db.Date
  firmadoPor    String?
  firmadoEn     DateTime?
  paciente      Paciente @relation(fields: [pacienteId], references: [id], onDelete: Cascade)
  eventos       OdontogramaEvento[]
  hallazgos     OdontogramaHallazgo[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([tenantId, pacienteId, version])
  @@index([tenantId, pacienteId, fecha])
}

model HallazgoCatalogo {
  id                 String   @id @default(uuid())
  codigo             String   @unique
  nombre             String
  abreviatura        String
  alcance            String
  requiereSuperficie Boolean  @default(false)
  requiereMaterial   Boolean  @default(false)
  colorDefecto       String
  activo             Boolean  @default(true)
  version            Int      @default(1)
  hallazgos          OdontogramaHallazgo[]
}

model OdontogramaHallazgo {
  id               String   @id @default(uuid())
  tenantId         String
  odontogramaId    String
  pieza            String
  piezas           String[] @default([])
  hallazgoCodigo   String
  superficies      String[] @default([])
  estadoClinico    String
  color            String
  material         String?
  tipoDetalle      String?
  especificaciones String?
  tratamientoId    String?
  citaId           String?
  activo           Boolean  @default(true)
  odontograma      Odontograma @relation(fields: [odontogramaId], references: [id], onDelete: Cascade)
  hallazgo         HallazgoCatalogo @relation(fields: [hallazgoCodigo], references: [codigo])
  tratamiento      Tratamiento? @relation(fields: [tratamientoId], references: [id])
  cita             Cita?    @relation(fields: [citaId], references: [id])
  createdAt        DateTime @default(now())

  @@index([tenantId, odontogramaId, pieza, activo])
}

model OdontogramaEvento {
  id             String      @id @default(uuid())
  tenantId       String
  odontogramaId  String
  pieza          String
  estadoAnterior String?
  estadoNuevo    String
  tratamientoId  String?
  citaId         String?
  fecha          DateTime    @default(now())
  observacion    String?
  odontograma    Odontograma @relation(fields: [odontogramaId], references: [id], onDelete: Cascade)
  tratamiento    Tratamiento? @relation(fields: [tratamientoId], references: [id])
  cita           Cita?       @relation(fields: [citaId], references: [id])

  @@index([tenantId, odontogramaId, pieza])
}

// ---- Consentimientos (conservado) ----

model ConsentimientoPlantilla {
  id        String               @id @default(uuid())
  tenantId  String
  clave     String
  titulo    String
  cuerpo    String               @default("")
  activo    Boolean              @default(true)
  firmados  ConsentimientoFirmado[]
  updatedAt DateTime             @updatedAt

  @@unique([tenantId, clave])
}

enum EstadoConsentimiento {
  borrador
  firmado
  revocado
  anulado
}

model ConsentimientoFirmado {
  id                 String               @id @default(uuid())
  tenantId           String
  pacienteId         String
  plantillaId        String
  citaId             String?
  tratamiento        String?
  datosSnapshot      Json
  cuerpoSnapshot     String?
  firmaPacienteKey   String?
  firmaOdontologoKey String?
  pdfKey             String?
  estado             EstadoConsentimiento @default(borrador)
  firmadoEn          DateTime?
  revocadoEn         DateTime?
  revocadoPor        String?
  paciente           Paciente             @relation(fields: [pacienteId], references: [id], onDelete: Cascade)
  plantilla          ConsentimientoPlantilla @relation(fields: [plantillaId], references: [id])
  createdAt          DateTime             @default(now())
  updatedAt          DateTime             @updatedAt

  @@index([tenantId, pacienteId, estado])
}

// ---- Google Calendar (por tenant + usuario) ----

model GoogleAccount {
  id           String   @id @default(uuid())
  tenantId     String
  userId       String
  emailGoogle  String?
  refreshToken String
  calendarId   String   @default("primary")
  conectadaEn  DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([tenantId, userId])
}

// ============================================================
// BILLING (tenant)
// ============================================================

enum TipoPago {
  ingreso
  egreso
}

enum EstadoPago {
  pendiente
  parcial
  pagado
  anulado
}

model Pago {
  id             String     @id @default(uuid())
  tenantId       String
  codigoRecibo   String
  tipo           TipoPago
  pacienteId     String?
  citaId         String?
  concepto       String
  montoTotal     Decimal    @db.Decimal(10, 2)
  montoPagado    Decimal    @default(0) @db.Decimal(10, 2)
  saldo          Decimal    @default(0) @db.Decimal(10, 2)
  metodoPago     String?
  estado         EstadoPago @default(pendiente)
  referenciaTipo String?
  referenciaId   String?
  fecha          DateTime   @db.Date
  observacion    String?
  usuarioId      String?
  paciente       Paciente?  @relation(fields: [pacienteId], references: [id])
  cita           Cita?      @relation(fields: [citaId], references: [id])
  detalles       PagoDetalle[]
  cuotas         Cuota[]
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  deletedAt      DateTime?

  @@unique([tenantId, codigoRecibo])
  @@unique([tenantId, referenciaTipo, referenciaId])
  @@index([tenantId, tipo, fecha])
  @@index([tenantId, pacienteId, estado])
}

model PagoDetalle {
  id            String      @id @default(uuid())
  tenantId      String
  pagoId        String
  tratamientoId String?
  descripcion   String
  cantidad      Int         @default(1)
  precioUnit    Decimal     @db.Decimal(10, 2)
  subtotal      Decimal     @db.Decimal(10, 2)
  pago          Pago        @relation(fields: [pagoId], references: [id], onDelete: Cascade)
  tratamiento   Tratamiento? @relation(fields: [tratamientoId], references: [id])

  @@index([tenantId, pagoId])
}

enum EstadoCuota {
  pendiente
  pagada
  vencida
}

model Cuota {
  id              String      @id @default(uuid())
  tenantId        String
  pagoId          String
  nroCuota        Int
  monto           Decimal     @db.Decimal(10, 2)
  fechaVencimiento DateTime   @db.Date
  fechaPago       DateTime?   @db.Date
  metodoPago      String?
  estado          EstadoCuota @default(pendiente)
  pago            Pago        @relation(fields: [pagoId], references: [id], onDelete: Cascade)
  createdAt       DateTime    @default(now())

  @@unique([tenantId, pagoId, nroCuota])
  @@index([tenantId, fechaVencimiento, estado])
}

// ============================================================
// INVENTARIO (tenant)
// ============================================================

model Proveedor {
  id        String   @id @default(uuid())
  tenantId  String
  ruc       String?
  nombre    String
  contacto  String?
  telefono  String?
  email     String?
  direccion String?
  activo    Boolean  @default(true)
  compras   Compra[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  @@unique([tenantId, ruc])
  @@index([tenantId, activo, nombre])
}

model Insumo {
  id             String               @id @default(uuid())
  tenantId       String
  sedeId         String?
  nombre         String
  unidad         String               @default("und")
  stockActual    Int                  @default(0)
  stockMinimo    Int                  @default(0)
  precioRef      Decimal?             @db.Decimal(10, 2)
  activo         Boolean              @default(true)
  movimientos    MovimientoInventario[]
  compraDetalles CompraDetalle[]
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt
  deletedAt      DateTime?

  @@unique([tenantId, sedeId, nombre])
  @@index([tenantId, activo, nombre])
}

enum TipoMovimiento {
  entrada
  salida
  ajuste
}

model MovimientoInventario {
  id             String         @id @default(uuid())
  tenantId       String
  insumoId       String
  tipo           TipoMovimiento
  cantidad       Int
  stockAnterior  Int
  stockNuevo     Int
  motivo         String?
  referenciaTipo String?
  referenciaId   String?
  fecha          DateTime       @default(now())
  usuarioId      String?
  insumo         Insumo         @relation(fields: [insumoId], references: [id])

  @@index([tenantId, insumoId, fecha])
}

model Compra {
  id          String         @id @default(uuid())
  tenantId    String
  proveedorId String
  sedeId      String?
  codigo      String?
  fecha       DateTime       @db.Date
  montoTotal  Decimal        @db.Decimal(10, 2)
  estado      String         @default("registrada")
  observacion String?
  usuarioId   String?
  proveedor   Proveedor      @relation(fields: [proveedorId], references: [id])
  detalles    CompraDetalle[]
  createdAt   DateTime       @default(now())

  @@unique([tenantId, codigo])
  @@index([tenantId, proveedorId, fecha])
}

model CompraDetalle {
  id        String  @id @default(uuid())
  tenantId  String
  compraId  String
  insumoId  String
  cantidad  Int
  precioUnit Decimal @db.Decimal(10, 2)
  subtotal  Decimal  @db.Decimal(10, 2)
  compra    Compra  @relation(fields: [compraId], references: [id], onDelete: Cascade)
  insumo    Insumo  @relation(fields: [insumoId], references: [id])

  @@index([tenantId, compraId])
}

// ============================================================
// CONFIG (tenant)
// ============================================================

model TenantConfig {
  tenantId   String   @id
  nombre     String   @default("Mi Consultorio")
  ruc        String?
  direccion  String?
  telefono   String?
  email      String?
  ciudad     String   @default("Huancayo")
  horario    Json?
  descansos  Json?
  logoUrl    String?
  colores    Json?
  tenant     Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  updatedAt  DateTime @updatedAt
}

model PlantillaWhatsApp {
  id        String   @id @default(uuid())
  tenantId  String
  clave     String
  texto     String
  activo    Boolean  @default(true)
  updatedAt DateTime @updatedAt

  @@unique([tenantId, clave])
}

// ============================================================
// AUDITORÍA (append-only)
// ============================================================

model Auditoria {
  id              String   @id @default(uuid())
  tenantId        String?
  tabla           String
  registroId      String
  accion          String
  usuarioId       String?
  resultado       String   @default("SUCCESS") // SUCCESS | FAILURE
  ip              String?
  userAgent       String?
  datosAnteriores Json?
  datosNuevos     Json?
  usuario         User?    @relation(fields: [usuarioId], references: [id])
  tenant          Tenant?  @relation(fields: [tenantId], references: [id])
  createdAt       DateTime @default(now())

  @@index([tenantId, createdAt])
  @@index([tenantId, tabla, registroId])
}
```

### Notas del modelo

- **`tenantId` denormalizado** en tablas hijas (p. ej. `PagoDetalle.tenantId`) para que la extensión Prisma filtre sin joins; los servicios lo toman siempre del padre (`pago.tenantId`).
- **`@@unique([tenantId, ...])`** en lugar de los `@unique` globales actuales: mismo DNI puede existir en dos clínicas; mismo `codigoRecibo` también.
- **`deletedAt` (soft delete)** en las entidades principales. Los borrados físicos quedan reservados a administrador con auditoría previa.
- **`firmadoPor`/`firmadoEn`** (odontograma) y **`revocadoEn`/`revocadoPor`** (consentimientos) resuelven la falta de trazabilidad legal detectada.
- **`cuerpoSnapshot`** congela el texto de la plantilla al firmar (evita que el PDF difiera de lo que el paciente vio).
- **`horaFin`** en `Cita` resuelve la detección de solapamientos por duración.
- **`ciudad`** en `TenantConfig` saca el literal `'Huancayo'` del código.
- **`usuarioId`** en pagos/movimientos/compras habilita la auditoría de quién operó.

### Estado de validación del esquema

Verificado con **Prisma 7.10.0** el 2026 (artefacto real en `backend/prisma/schema.prisma`):

| Comprobación | Resultado |
|---|---|
| `prisma validate` | ✅ Esquema válido |
| `prisma format` | ✅ Sin cambios estructurales |
| DDL generado (`migrate diff --from-empty --to-schema --script`) | ✅ 738 líneas de SQL |
| Tablas creadas | 37 |
| Índices únicos | 25 (17 con `tenantId` como primera columna) |
| Referencias a `tenantId` en el DDL | 77 |

**Correcciones aplicadas tras la validación.** La primera pasada de `prisma validate` falló con **4 errores `P1012`** (campos de relación sin campo inverso en el modelo opuesto). Ya están corregidos en el esquema de arriba:

| Campo de relación | Campo inverso añadido |
|---|---|
| `PlatformAuditLog.usuario` → `PlatformUser` | `PlatformUser.auditLogs` |
| `Membership.sede` → `Sede` | `Sede.memberships` |
| `Auditoria.usuario` → `User` | `User.auditorias` |
| `Auditoria.tenant` → `Tenant` | `Tenant.auditorias` |

**Requisito de Prisma 7 (bloqueante para la Fase 1).** La propiedad `url` **ya no se admite** en el bloque `datasource` del schema:

> `error: The datasource property 'url' is no longer supported in schema files. Move connection URLs for Migrate to 'prisma.config.ts'`

La cadena de conexión debe declararse en `prisma.config.ts` y el schema deja solo el proveedor:

```prisma
datasource db {
  provider = "postgresql"
}
```

```typescript
// prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

**Advertencia sobre `@@unique` con columnas opcionales.** En PostgreSQL los `NULL` son distintos entre sí, así que un índice único que incluya una columna opcional **no restringe las filas con `NULL`**. Afecta a cuatro restricciones:

| Restricción | Efecto real |
|---|---|
| `Insumo @@unique([tenantId, sedeId, nombre])` | Dos insumos con el mismo nombre y `sedeId = NULL` **se permiten** → stock fragmentado |
| `Paciente @@unique([tenantId, tipoDoc, numDoc])` | Varios pacientes sin documento (`numDoc = NULL`) se permiten (aceptable) |
| `Proveedor @@unique([tenantId, ruc])` | Varios proveedores sin RUC (aceptable) |
| `Pago @@unique([tenantId, referenciaTipo, referenciaId])` | Los pagos sin referencia no colisionan (correcto) |

**Mitigación obligatoria para `Insumo`:** asignar siempre la sede principal (`sedeId` nunca nulo, incluso en clínicas de una sola sede) o añadir un índice único parcial (`WHERE "sedeId" IS NULL`). Es el único de los cuatro que produce un bug de negocio real.

**Cobertura de integridad referencial sobre `tenantId`.** El DDL crea FK explícita a `Tenant` en **7 tablas** (`Subscription`, `TenantConfig`, `Sede`, `Membership`, `Role`, `Paciente`, `Auditoria`). En las **20 restantes**, `tenantId` es una columna escalar indexada **sin FK**: la coherencia la garantiza la extensión Prisma, que siempre escribe el `tenantId` del contexto. Si se quiere integridad a nivel de motor en todas, basta añadir la relación `tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)` a cada modelo más su campo inverso en `Tenant` — es un cambio mecánico, no de diseño.

---

## 7. Core multi-tenant: contexto, guard y extensión

### 7.1 TenantContext (AsyncLocalStorage)

```typescript
// core/tenant-context/tenant-context.ts
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantStore {
  tenantId: string;
  userId: string;
  roleIds: string[];
  permissions: string[];
  sedeId?: string;
}

export const tenantContext = new AsyncLocalStorage<TenantStore>();

export function requireTenant(): TenantStore {
  const ctx = tenantContext.getStore();
  if (!ctx?.tenantId) throw new Error('TenantContext no disponible');
  return ctx;
}
```

**Importante:** el contexto se crea en el **guard** (donde `req.user` ya existe), no en un middleware. `JwtAuthGuard` valida el token; `TenantGuard` resuelve el tenant activo desde `X-Tenant-Id`, valida la membresía activa y ejecuta `tenantContext.run(store, () => next())`.

> **Enmienda tras Fase 5 (bug real encontrado por los tests).** `enterWith` dentro del guard fija el store en el subcontexto async del propio guard; los hops hermanos (siguiente guard, handler) no lo heredan — ALS solo hereda de padre a hijo — y todo pasaba "de casualidad" con un solo tenant. Patrón vigente: `TenantContextMiddleware` crea el scope con `tenantContext.run(...)` envolviendo `next()` (toda la petición comparte el mismo objeto) y `TenantGuard` lo **puebla** mutándolo in place (ahí `req.user` ya existe). Ver `src/core/tenant-context/tenant-context.middleware.ts`.

### 7.2 Cadena de guards

```text
JwtAuthGuard → TenantGuard → MembershipGuard → PermissionsGuard → FeatureGuard → Controller
```

| Guard | Responsabilidad |
|---|---|
| `JwtAuthGuard` | Token válido, sesión activa, revalida usuario en BD |
| `TenantGuard` | Resuelve `tenantId` (header/subdominio), valida tenant ACTIVE y membresía ACTIVE, inicia `TenantContext` |
| `MembershipGuard` | Valida membresía y sede (opcional) |
| `PermissionsGuard` | Valida rol/permiso granular (`@RequirePermission('patients.write')`) |
| `FeatureGuard` | Valida que el plan permita la operación (`@RequireFeature('multi_sede')`) |

`JwtAuthGuard` y `TenantGuard` se registran como **APP_GUARD global**; el resto se aplica por decorador. El login, el callback de Google OAuth y la creación de tenant (registro) son los únicos `@Public()`.

### 7.3 Extensión Prisma

```typescript
// core/prisma/tenant-extension.ts
const TENANT_MODELS = new Set([
  'Sede', 'Membership', 'Role', 'Paciente', 'DocumentoPaciente',
  'Especialidad', 'Tratamiento', 'Cita', 'HistorialClinico',
  'Odontograma', 'OdontogramaHallazgo', 'OdontogramaEvento',
  'ConsentimientoPlantilla', 'ConsentimientoFirmado', 'GoogleAccount',
  'Pago', 'PagoDetalle', 'Cuota', 'Proveedor', 'Insumo',
  'MovimientoInventario', 'Compra', 'CompraDetalle',
  'TenantConfig', 'PlantillaWhatsApp', 'Auditoria',
]);

export const tenantExtension = Prisma.defineExtension({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = tenantContext.getStore();
        // Solo con contexto VALIDADO por TenantGuard (ver 7.1). El middleware
        // siembra el store sin validar porque en rutas @Public/@Platform ningún
        // guard lo sustituye: filtrar con ese valor sería confiar en el cliente.
        if (!ctx?.validado || !ctx.tenantId || !TENANT_MODELS.has(model)) {
          return query(args);
        }
        const a = args as Record<string, unknown>;
        // Nunca SOBRESCRIBIR en silencio un `tenantId` explícito distinto.
        const declarado = (a.where as Record<string, unknown> | undefined)?.tenantId;
        if (declarado !== undefined && declarado !== ctx.tenantId) {
          throw new ForbiddenException('tenantId declarado distinto del de la sesión');
        }
        if (['findMany', 'findFirst', 'count', 'aggregate', 'groupBy',
             'updateMany', 'deleteMany'].includes(operation)) {
          a.where = { ...(a.where as object | undefined), tenantId: ctx.tenantId };
        }
        if (operation === 'create') {
          a.data = { ...(a.data as object | undefined), tenantId: ctx.tenantId };
        }
        if (operation === 'createMany') {
          const data = a.data as Record<string, unknown> | Array<Record<string, unknown>>;
          a.data = Array.isArray(data)
            ? data.map((d) => ({ ...d, tenantId: ctx.tenantId }))
            : { ...data, tenantId: ctx.tenantId };
        }
        return query(args);
      },
    },
  },
});
```

**Tres reglas que hacen que esto funcione de verdad** (todas verificadas en ejecución):

1. **El contexto debe estar `validado`.** El middleware crea el scope con `run()` pero **sin leer la cabecera**; solo `TenantGuard`, tras validar tenant + membresía, pone `validado: true`. Sin este flag, basta enviar `X-Tenant-Id: <otro tenant>` en una ruta `@Platform()` (export, métricas, checkout) para que la extensión filtrara —y sobrescribiera el filtro explícito del servicio— con un valor del cliente.

2. **`$transaction` debe tomarse del cliente EXTENDIDO.** `PrismaService` copia los delegados extendidos, pero si `this.$transaction` sigue siendo el del cliente base, el `tx` que recibe el callback **no lleva la extensión** y toda consulta dentro de una transacción queda sin filtro. Por eso el constructor hace `this.$transaction = extended.$transaction.bind(extended)`.

3. **Hay un límite de propagación de `AsyncLocalStorage`** (verificado con una sonda): el hook **sí** ve el store cuando el `run()` envuelve la petición completa (el caso real de la API), pero **no** cuando envuelve una llamada suelta a Prisma. Consecuencia: **el aislamiento no debe depender de la extensión**; en scripts, seeds, migraciones y cron —que corren fuera de una petición HTTP— hay que pasar `tenantId` explícito y verificar pertenencia.

**Regla complementaria (mutaciones por id):** `findUnique`/`update`/`delete` por `id` no se tocan en la extensión (Prisma no admite `tenantId` en `findUnique`). En su lugar, el servicio lee el registro y **verifica `registro.tenantId === ctx.tenantId`** antes de mutar, lanzando `NotFoundException` si no coincide. Esto es un chequeo explícito en ~una docena de servicios, no en 90 archivos.

### 7.4 Filtro global de excepciones

Traduce los errores de Prisma y validación a HTTP correctos:

| Error | HTTP |
|---|---|
| `P2002` (unicidad) | 409 Conflict |
| `P2025` (no encontrado) | 404 |
| `P2034` (serialización) | 409 (con reintento) |
| `PrismaClientValidationError` | 400 |
| `ValidationPipe` | 400 |

Esto elimina los `500` por inputs inválidos que hoy devuelve la API.

---

## 8. Seguridad en profundidad

```text
Nivel 1  Cloudflare        WAF, DDoS, rate limit global
Nivel 2  Transporte        HTTPS, HSTS, TLS 1.2+
Nivel 3  Autenticación     JWT 15 min + refresh httpOnly rotativo + MFA (admin, etapa 2)
Nivel 4  Tenant            TenantContext + TenantGuard + membresía activa
Nivel 5  Autorización      Roles, permisos, plan, features
Nivel 6  Consulta          Extensión Prisma fuerza tenant_id
Nivel 7  Base de datos     RLS (etapa 2, rol dedicado)
Nivel 8  Storage           Buckets privados, URLs firmadas
Nivel 9  Auditoría         Append-only
Nivel 10 Operación         Secrets, backups, monitoreo, CI/CD
```

### Prioridades de seguridad heredadas de la auditoría

1. **Eliminar contraseñas por defecto** de los seeds (`123456`, `K3rb3r0s_iuc3ntr0`): fallar si falta `SUPERADMIN_PASSWORD`, generar la inicial aleatoria e imprimirla una vez.
2. **Rate limit estricto en `/auth/login`** (5-10/min por IP y por email) + `app.set('trust proxy', 1)`.
3. **Mínimo 12 caracteres** en contraseñas + rechazo de comunes.
4. **Argon2id** (etapa 2) en lugar de bcrypt.
5. **Cambio de clave invalida tokens** (`passwordChangedAt`/`tokenVersion` en el payload, comparado en el guard).
6. **`trust proxy`** para que el throttling por IP funcione detrás del reverse proxy.
7. **CORS con `.trim()`** sobre la lista de orígenes y sin `credentials` (se usa Bearer, no cookies).
8. **Secrets solo por variables de entorno**, rotación, `service_role` solo en backend.

---

## 9. Storage multi-tenant

```text
/tenants/{tenantId}/patients/{patientId}/documents/{file}
/tenants/{tenantId}/patients/{patientId}/xrays/{file}
/tenants/{tenantId}/consents/{consentId}/{file}
/tenants/{tenantId}/config/logo.png
/tenants/{tenantId}/exports/{exportId}.zip
```

- Buckets **privados**; en producción, URLs **firmadas de 5–15 min**. Con el
  proveedor local la descarga pasa por la API (ver endpoints abajo).
- El backend valida `tenantId` antes de escribir o leer cualquier clave, y la
  contención de rutas (`path.resolve` + `startsWith(base + sep)`) cierra el
  path traversal.
- **La clave la construye siempre el servidor** (`construirClave`); nunca se acepta
  del cliente. Aceptarla permitía registrar el documento de un paciente apuntando
  al archivo de **otro** paciente del mismo tenant y descargarlo después.
- **Doble validación por contenido (magic bytes)**, porque confiar en el `mimeType`
  declarado es lo que habilita el XSS almacenado:
  - **al subir**: el tipo se deriva del contenido, el tamaño real sale de
    `file.size` y el archivo se rechaza antes de tocar el disco;
  - **al servir**: se vuelve a comprobar que el contenido coincide con el
    `mimeType` de la fila; si no coincide, no se entrega ni un byte (404).
- Metadatos en BD con `tenantId`; la `storageKey` **no se expone** en las respuestas.

**Endpoints de documentos** (`patients.write` para subir, `patients.read` para leer):

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/api/pacientes/:id/documentos` | Registra **metadatos** sin bytes (se conserva para flujos administrativos) |
| `POST` | `/api/pacientes/:id/documentos/archivo` | **Sube el archivo** (`multipart`: campo `archivo` + campo `tipo`) |
| `GET` | `/api/pacientes/:id/documentos` | Lista metadatos (sin `storageKey`) |
| `GET` | `/api/pacientes/:id/documentos/:docId/descarga` | Entrega el **binario**, con `Content-Type` verificado, `nosniff` y `Content-Disposition` |

> Con el proveedor local la descarga **no** es una URL firmada: pasa por la API,
> que es quien valida la firma del archivo antes de entregarlo. Cuando se conecte
> un almacenamiento de objetos, `leerDocumentoValidado` se sustituye por la firma
> de una URL temporal, manteniendo la misma comprobación previa.

---

## 10. Auditoría

- **Append-only**, sin `update` ni `delete` desde la aplicación.
- Campos: `tenantId`, `userId`, `accion`, `tabla`, `registroId`, `resultado`, `ip`, `userAgent`, `datosAnteriores`, `datosNuevos`.
- `AuditInterceptor` registra acciones críticas: login/logout, crear/editar/eliminar paciente, modificar odontograma, registrar/anular pago, cambio de configuración, creación de usuario, cambio de permisos, suspensión de cuenta.
- **No loggear** datos clínicos sensibles ni contraseñas (redactar `datosAnteriores/Nuevos`).
- Se registran también **intentos de acceso cruzado** (cuando la verificación de pertenencia falla).

---

## 11. Observabilidad y health checks

- Logs estructurados JSON: `timestamp, level, requestId, tenantId, userId, route, latency, status`.
- Métricas: latencia por endpoint, errores 4xx/5xx por tenant, CPU/RAM del VPS, conexiones Postgres, storage por tenant.
- Health checks:

```text
GET /health            → { status: "ok", database: "ok" }
GET /health/db
GET /health/storage
GET /health/version
```

---

## 12. Backups y recuperación

> Procedimiento ejecutable: [docs/backups.md](backups.md) (scripts
> `db:backup`, `db:restaurar` y `db:prueba-restauracion`, con simulacro en CI).

- Backups automáticos de Supabase + PITR (si el plan lo permite).
- Backup lógico adicional + backup de Storage.
- **Prueba de restauración periódica documentada** (no checklist, ejecución real).
- Export por tenant para offboarding.
- Documentar: frecuencia, retención, responsable, procedimiento, RTO, RPO.

---

## 13. Mejoras priorizadas

### Nivel 1 — Bloqueadores (no vender sin esto)

| # | Mejora | Estado actual | Corrección |
|---|---|---|---|
| 1 | Aislamiento garantizado | Sin multi-tenant | Extensión Prisma + TenantGuard + tests de aislamiento |
| 2 | Contraseñas por defecto en seeds | `123456`, `K3rb3r0s_iuc3ntr0` publicadas | Fallar si falta la clave; generar aleatoria e imprimir una vez |
| 3 | Rate limit de login | 100 req/min global sin `trust proxy` | Límite estricto por IP y email + `trust proxy` |
| 4 | Detección de solapamiento de citas | Solo compara `hora` exacta | `horaInicio` + `horaFin`/duración |
| 5 | Borrado en cascada de historia clínica | `DELETE /pacientes/:id` sin rol ni auditoría | Soft delete + borrado físico solo superadmin + auditoría |
| 6 | Numeración de recibos por tenant | `MAX()+1` global | Secuencia por tenant + `@@unique([tenantId, codigo])` |
| 7 | Filtro global de excepciones | 500 por inputs inválidos | Mapeo P2002/P2025/P2034/validación |
| 8 | Corregir orden TenantContext | Middleware lee `req.user` antes del guard | Crear contexto en el guard |

### Nivel 2 — Antes de cobrar suscripciones

| # | Mejora | Corrección |
|---|---|---|
| 9 | Entitlements con límites en backend | `FeatureGuard` + `EntitlementsService` con caché corta |
| 10 | Idempotencia y firma de webhooks | Clave idempotente por cobro + verificación de firma |
| 11 | Soft delete uniforme + auditoría | `deletedAt` en todas las entidades + `AuditInterceptor` |
| 12 | Argon2id + invalidar tokens al cambiar clave | `passwordChangedAt` en payload |
| 13 | MFA para `PLATFORM_ADMIN` | TOTP |
| 14 | Refresh token rotativo httpOnly | JWT 15 min + refresh en cookie |
| 15 | Versionado de texto firmado | `cuerpoSnapshot` en consentimientos |
| 16 | Versionado atómico del odontograma | `@@unique([tenantId, pacienteId, version])` + versión en transacción |

### Nivel 3 — Escala y operación (solo >3-5 clínicas)

| # | Mejora |
|---|---|
| 17 | Redis (caché de entitlements/sesiones) + colas/jobs (cuotas vencidas, recordatorios) |
| 18 | RLS con rol dedicado y `set_config` por transacción |
| 19 | Multi-sede real (permisos por sede) |
| 20 | OpenAPI/contrato generado (`@nestjs/swagger`) para eliminar drift frontend↔backend |
| 21 | Observabilidad: alertas por tasa de 5xx y por acceso cruzado |

---

## 14. Plan de implementación por fases

> Cada fase tiene entregables y **criterio de salida**. No se avanza sin que el criterio se cumpla.

### Fase 0 — Decisiones y cimientos (sin código, 1 semana)

- Aprobar los ADRs (secciones 4).
- Decidir monorepo vs repos separados (recomendado: **monorepo** para compartir tipos y simplificar CI; si se mantienen separados, generar los tipos de Prisma a un paquete compartido).
- Definir contrato de API (`/api` + prefijo `/api/platform` para el panel de plataforma).

**Salida:** ADRs aprobados, estructura de repo decidida.

### Fase 1 — Core multi-tenant (2-3 semanas)

- Nuevo `schema.prisma` (sección 6) + migración **no destructiva** (añadir `tenantId` con backfill, no reescribir).
- `TenantContext` + `TenantGuard` + `MembershipGuard` + extensión Prisma + filtro global de excepciones.
- Entidades SaaS: `Tenant`, `Sede`, `Membership`, `Role`, `Permission`, `RolePermission`, `Plan`, `PlanFeature`, `Subscription`, `PlatformUser`, `PlatformAuditLog`.
- `PlatformUser` + login de plataforma (separado del login de clínica).

**Salida:** una request autenticada resuelve `tenantId` en el contexto; la extensión inyecta `tenantId` en `create`/`findMany`; tests de aislamiento verdes.

### Fase 2 — Envolver módulos clínicos (2-3 semanas)

- Añadir `tenantId` a `Paciente`, `HistorialClinico`, `DocumentoPaciente`, `Especialidad`, `Tratamiento`, `Cita`, `Odontograma*`, `Consentimiento*`, `GoogleAccount`.
- Actualizar servicios para usar `requireTenant()` y verificación de pertenencia en mutaciones por id.
- Storage con prefijo `/tenants/{tenantId}/...`.
- Corregir solapamiento de citas (`horaFin`).

**Salida:** todos los flujos clínicos actuales funcionan aislados por tenant.

### Fase 3 — Envolver finanzas e inventario (2 semanas)

- `tenantId` en `Pago`, `PagoDetalle`, `Cuota`, `Proveedor`, `Insumo`, `MovimientoInventario`, `Compra`, `CompraDetalle`.
- Secuencias por tenant (recibos, tokens, códigos de compra).
- Corregir tope `montoPagado <= montoTotal`, anulación condicional, método/fecha por abono y cuota.

**Salida:** recibos de dos tenants no colisionan; arqueo de caja por tenant correcto.

### Fase 4 — Migración de la clínica actual (1 semana)

- Script idempotente: crear `Tenant` + `Sede` + `User` admin + `Membership` + roles; backfill de `tenantId`; verificar integridad referencial.
- Backup completo antes; validar en staging primero; rollback documentado.

**Salida:** la clínica actual opera como primer tenant sin pérdida de datos.

### Fase 5 — Roles, permisos y entitlements (2-3 semanas)

- RBAC granular + `FeatureGuard` + `EntitlementsService`.
- Frontend: `session.store` con `permissions`/`features`/`limits`; composables `usePermissions`/`useFeatures`; guards de ruta.

**Salida:** el plan "Consultorio" no puede ejecutar multi-sede; un recepcionista no puede anular pagos.

### Fase 6 — Panel de plataforma + auditoría (2 semanas)

- `/admin` separado: tenants, usuarios, membresías, planes, suscripciones, métricas, soporte, suspensión.
- `AuditInterceptor` + `PlatformAuditLog` + `Auditoria` por tenant.

**Salida:** el propietario del SaaS gestiona clínicas sin tocar datos de tenants.

### Fase 7 — Seguridad y operación (2 semanas)

- Argon2id, refresh token rotativo, rate limit de login, MFA admin, soft delete uniforme.
- Backups + prueba de restauración + export por tenant.
- Observabilidad básica + health checks.

**Salida:** checklist de seguridad (sección 8) cumplido.

### Fase 8 — Facturación del SaaS (2-3 semanas)

- Pasarela (Izipay/Mercado Pago/Culqi/Stripe), webhooks con firma, idempotencia, estados `PAST_DUE`/`SUSPENDED`, dunning.

**Salida:** cobro de suscripción sin duplicados y con estados correctos.

### Fase 9 — Hardening y producción (1-2 semanas)

- CI/CD con staging, pruebas de aislamiento en pipeline, rollback documentado, alertas.

**Salida:** producción estable con el primer cliente.

---

## 15. Estrategia de pruebas

### 15.1 Pruebas de aislamiento (obligatorias desde la Fase 1)

Fixture de **dos tenants** (`A`, `B`) y un test por módulo que intenta acceder al recurso del otro tenant esperando `404`/`403`:

- Pacientes: A no consulta/modifica pacientes de B.
- Citas: A no consulta/modifica citas de B.
- Pagos: A no ve pagos de B.
- Odontograma: A no accede al odontograma de un paciente de B.
- Documentos: A no descarga documentos de B.
- Usuarios: admin de A no administra usuarios de B.
- Suscripciones: un tenant no modifica su propia suscripción vía HTTP.

### 15.2 Capas de pruebas

| Capa | Herramienta | Alcance |
|---|---|---|
| Unitarias | Vitest | Lógica pura (numeración, redondeo, fechas, entitlements) |
| Integración | Supertest + BD de prueba | Servicios + guards + extensión |
| Aislamiento | Supertest + 2 tenants | Multi-tenancy |
| e2e | Playwright/Cypress (opcional) | Flujo completo clínico |
| Carga | k6 (etapa 2) | Login y endpoints calientes |

**Regla de CI:** ningún deploy sin tests verdes, incluidos los de aislamiento.

---

## 16. Evolución del software

### Etapa 1 — MVP SaaS (1–3 clínicas)

```
1 VPS + Docker · 1 API NestJS stateless · 1 PostgreSQL Supabase · 1 Frontend Vercel · Cloudflare
```

- Multi-tenant lógico + extensión Prisma + tests de aislamiento.
- RBAC + planes + entitlements.
- Facturación manual + auditoría + backups.

### Etapa 2 — Crecimiento (5–20 clínicas)

- **Redis** (caché de entitlements/sesiones, rate limiting distribuido).
- **Colas y jobs** (marcar cuotas vencidas, recordatorios WhatsApp/Google, export por tenant).
- **RLS** con rol dedicado + `set_config` por transacción.
- **Facturación automatizada** + dunning.
- **Multi-sede** completo (permisos e inventario por sede).
- **MFA** obligatorio para administradores.
- Monitoreo avanzado (Sentry + métricas).

### Etapa 3 — Escala (20+ clínicas)

- Múltiples instancias de API + load balancer.
- Réplicas de lectura PostgreSQL.
- Búsqueda avanzada (Elasticsearch) y analítica (ClickHouse) opcionales.
- CDN avanzada y multi-región.

> **Regla:** no implementar infraestructura de etapa 2/3 prematuramente. Cada etapa se activa por métrica (nº de tenants, latencia, carga de login), no por anticipación.

---

## 17. Checklist antes de vender

### Arquitectura
- [ ] Modelo multi-tenant implementado (extensión + guards).
- [ ] `tenantId` derivado de sesión/membresía, nunca del body.
- [ ] Ninguna consulta permite acceso cruzado (tests verdes).
- [ ] API stateless.
- [ ] Filtro global de excepciones.
- [ ] Health checks.

### Seguridad
- [ ] Sin credenciales por defecto.
- [ ] Rate limit de login + `trust proxy`.
- [ ] Argon2id (o bcrypt con plan de migración).
- [ ] JWT corto + refresh httpOnly.
- [ ] CORS correcto (con trim).
- [ ] Validación de DTO global.
- [ ] Control de archivos (MIME por contenido + contención de rutas).
- [ ] Secrets fuera del repo.

### Datos
- [ ] Migraciones Prisma versionadas.
- [ ] Índices y uniques por tenant.
- [ ] Soft delete uniforme.
- [ ] Backups + restauración probada.

### SaaS
- [ ] Tenants, sedes, membresías, roles.
- [ ] Planes, suscripciones, entitlements.
- [ ] Panel administrativo separado.
- [ ] Numeración por tenant.

### Operación
- [ ] Logs estructurados.
- [ ] Monitoreo y alertas.
- [ ] CI/CD con staging.
- [ ] Auditoría append-only.
- [ ] Documentación y procedimiento de soporte.

---

## 18. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Fuga de datos entre tenants | Media | Crítico | Extensión + tests de aislamiento + RLS (etapa 2) + auditoría de accesos cruzados |
| Migración destructiva de la clínica actual | Media | Crítico | Backup previo, staging, script idempotente, rollback documentado |
| Cobros duplicados de suscripción | Media | Alto | Idempotencia + firma de webhooks |
| Regresión del modelo clínico (NTS 188, consentimientos) | Alta (si se usa el v1) | Alto | Esquema de la sección 6 conserva el modelo actual |
| Errores silenciosos por `service_role` + RLS mal configurado | Media | Alto | RLS pospuesto a etapa 2 con rol dedicado |
| `TenantContext` sin tenant en peticiones públicas | Media | Alto | `requireTenant()` lanza excepción; solo `@Public()` queda fuera |
| Complejidad de RBAC/entitlements | Media | Medio | Empezar con roles fijos (`esSistema`) y permisos mínimos |

---

## 19. Próximos pasos

1. Aprobar los ADRs (sección 4) — especialmente ADR-002 (ID/FK) y ADR-006 (RLS).
2. Validar el esquema Prisma (sección 6) con `prisma validate` y `prisma migrate dev` en una BD de desarrollo.
3. Implementar Fase 0 y Fase 1.
4. Escribir los tests de aislamiento como primera tarea de la Fase 1 (test-first para el núcleo de aislamiento).
5. Migrar la clínica actual como primer tenant (Fase 4).
6. Incorporar el segundo cliente **solo** cuando las pruebas de aislamiento pasen en CI.

---

## 20. Registro de deuda técnica

Lo que se decidió **no** hacer todavía vive en [deuda-tecnica.md](deuda-tecnica.md).
Ahí está, como primera sección, la decisión sobre las integraciones de pago
(**solo Izipay**, en tres etapas: pagos únicos → suscripciones → embebido) con el
diseño de verificación de firma ya documentado por el proveedor, y a continuación
el resto de aplazamientos conscientes.

Regla: si algo está en ese documento, está pendiente **a propósito** y no debe
tratarse como un bug.

---

**Fin del documento.**
