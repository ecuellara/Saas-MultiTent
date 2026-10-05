# Plan de pruebas de aislamiento multi-tenant

> **Fase:** 1 (core multi-tenant) — es el **criterio de salida** de la fase y la primera tarea a escribir (test-first).
> **Complementa a:** [dental-saas-arquitectura-v2.md](dental-saas-arquitectura-v2.md) §14 (Fase 1), §15 (Estrategia de pruebas), §17 (Checklist) y ADR-002.

---

## 1. Objetivo

Demostrar, de forma **automática y repetible**, que ninguna clínica puede leer, modificar ni borrar información de otra, ni manipular su propia suscripción. El aislamiento no puede depender de que el desarrollador recuerde añadir `tenantId` en cada consulta.

**Criterio de salida de la Fase 1:** todos los casos de este plan en verde dentro del pipeline. Sin esto, no se incorpora un segundo cliente.

---

## 2. Artefactos

| Archivo | Rol |
|---|---|
| `backend/test/helpers/tenants-fixture.ts` | Crea dos tenants (A y B) con datos completos y equivalentes, de forma determinista |
| `backend/test/aislamiento.e2e-spec.ts` | Spec HTTP + verificación en base de datos de los casos de aislamiento |
| `backend/vitest.config.e2e.ts` | Configuración del runner e2e |

---

## 3. Capas de prueba

```text
        /\
       /  \      e2e de flujo clínico (Playwright/Cypress)   — etapa 2
      /----\
     /      \    AISLAMIENTO  (este plan)                   — Fase 1, obligatorio
    /--------\
   /          \  Integración: guards + extensión + servicios — Fase 1
  /------------\
 /              \ Unitarias: numeración, redondeo, fechas    — continuo
/----------------\
```

Este plan cubre la franja **aislamiento** y parte de **integración**.

---

## 4. Principio de respuesta: 404, no 403

Ante un recurso de otro tenant, la API responde **404 Not Found**, no 403:

- Con **403** se confirma que el recurso existe → filtra información (un atacante puede enumerar identificadores válidos de otra clínica).
- Con **404** la respuesta es indistinguible de "no existe".

**Excepción:** cuando el usuario **no es miembro** del tenant que declara (sección 1 del spec), un **403** es correcto y honesto: no revela nada del recurso, sino del vínculo usuario–clínica.

---

## 5. Matriz de casos

### 5.1 Autenticación y contexto (spec §1)

| # | Caso | Esperado |
|---|---|---|
| 1.1 | Petición sin token | 401 |
| 1.2 | Petición sin cabecera `X-Tenant-Id` | 400/403 |
| 1.3 | Token de A + tenant de B (no es miembro) | 403/404 |
| 1.4 | `X-Tenant-Id` inexistente | 403/404 |

### 5.2 Lectura cruzada (spec §2)

| Recurso | Ruta | Esperado |
|---|---|---|
| Paciente | `GET /api/pacientes/:id` | 404 |
| Historiales | `GET /api/pacientes/:id/historiales` | 404 |
| Documentos | `GET /api/pacientes/:id/documentos` | 404 |
| Descarga de documento | `GET /api/pacientes/:id/documentos/:docId/descarga` | 404 |
| Cita | `GET /api/citas/:id` | 404 |
| Tratamiento | `GET /api/tratamientos/:id` | 404 |
| Odontogramas | `GET /api/pacientes/:id/odontogramas` | 404 |
| Pago | `GET /api/pagos/:id` | 404 |
| Insumo | `GET /api/insumos/:id` | 404 |
| Proveedor | `GET /api/proveedores/:id` | 404 |
| Compra | `GET /api/compras/:id` | 404 |
| Consentimiento | `GET /api/consentimientos/:id` | 404 |
| Usuario | `GET /api/usuarios/:id` | 404 |
| **Control negativo** | A lee su propio paciente | **200** |
| **Control negativo** | El listado de A no contiene ids de B | **verificado** |

> Los controles negativos son imprescindibles: sin ellos, un `404` podría deberse a una ruta mal escrita y el test pasaría por el motivo equivocado.

### 5.3 Escritura y borrado cruzados (spec §3)

| Operación | Esperado | Verificación en BD |
|---|---|---|
| `PATCH /api/pacientes/:idB` | 404 | `nombres` de B intacto |
| `DELETE /api/pacientes/:idB` | 404 | la fila de B sigue existiendo |
| `PATCH /api/citas/:idB` | 404 | `horaInicio` de B intacta |
| `PATCH /api/pagos/:idB/anular` | 404 | `estado` de B no es `anulado` |
| `POST /api/insumos/:idB/salidas` | 404 | `stockActual` de B intacto |
| `PATCH /api/consentimientos/:idB/estado` | 404 | `estado` de B sigue `borrador` |

> Cada caso **relee la base de datos** después del intento. Un `404` devuelto por un servicio que ya mutó antes de comprobar la pertenencia sería un falso positivo.

### 5.4 Spoofing de tenant (spec §4)

| Caso | Esperado |
|---|---|
| `POST /api/pacientes` con `tenantId` del tenant ajeno en el body | 400 (rechazo por whitelist) **o** 201 con el recurso asignado al tenant de la sesión |
| Invariante | El número de pacientes del tenant B **no cambia** |

### 5.5 Unicidad por tenant (spec §5)

| Caso | Esperado |
|---|---|
| A y B tienen ambos `REC-2026-0001` | Ambos existen y son accesibles |
| Duplicar `codigoRecibo` dentro del mismo tenant | Falla (P2002 → 409) |
| `Odontograma` versión 1 en A y en B | Coexisten (unicidad `[tenantId, pacienteId, version]`) |

### 5.6 Suscripciones (spec §6)

| Caso | Esperado |
|---|---|
| A lee la suscripción de B | 403/404 |
| A modifica su propio `planId` por HTTP | 403/404/405 |

### 5.7 Extensión Prisma (spec §7)

| Caso | Esperado |
|---|---|
| `findMany()` en contexto A | Solo filas de A |
| `findUnique({where:{id}})` de un id de B en contexto A | **Devuelve la fila** (límite conocido) |

---

## 6. Modelo de enforcement real (y sus dos límites)

La estrategia de identificadores de ADR-002 usa **id global único** (UUID) + `tenantId` como columna. El aislamiento se apoya en la extensión Prisma, pero **solo funciona si se cumplen tres condiciones**, todas verificadas en ejecución con sondas instrumentadas:

### 6.1 El contexto debe estar `validado`

El middleware crea el scope `AsyncLocalStorage` **sin leer la cabecera**; solo `TenantGuard`, tras validar tenant + membresía, pone `validado: true`. La extensión comprueba ese flag antes de filtrar.

Sin él, en las rutas `@Public()`/`@Platform()` (donde ningún guard sustituye la cabecera) bastaba enviar `X-Tenant-Id: <otro tenant>` para que la extensión filtrara —y **sobrescribiera** el filtro explícito del servicio— con un valor del cliente: `GET /api/platform/tenants/A/export` con `X-Tenant-Id: B` devolvía el dataset de B etiquetado como A.

### 6.2 `$transaction` debe venir del cliente extendido

`PrismaService` copia los delegados extendidos, pero si `this.$transaction` es el del cliente base, el `tx` que recibe el callback **no lleva la extensión**: toda consulta dentro de una transacción queda sin filtro de tenant. El constructor hace `this.$transaction = extended.$transaction.bind(extended)`.

### 6.3 Límite de propagación de `AsyncLocalStorage`

Comprobado con una sonda: el hook de la extensión **sí** ve el store cuando el `run()` envuelve la **petición completa** (el caso real de la API, que es lo que ejercitan las secciones 2 y 3 de este plan), pero **no** cuando envuelve una llamada suelta a Prisma:

```typescript
// Envuelto por el middleware (petición HTTP)  -> el hook VE el contexto  -> filtra
// tenantContext.run(store, () => prisma.paciente.findMany())  -> el hook NO ve el contexto
```

**Consecuencia práctica:** el aislamiento **no debe depender de la extensión**. En scripts, seeds, migraciones y cron —que corren fuera de una petición HTTP— hay que pasar `tenantId` explícito y verificar pertenencia. El spec §7 documenta este límite como aserción.

### 6.4 Obligación derivada: mutaciones por id

`findUnique`/`update`/`delete` por `id` **no** se filtran (Prisma no admite `tenantId` en el `where` de `findUnique`), así que toda mutación por id verifica la pertenencia antes de operar:

```typescript
async function obtenerPacienteDelTenant(id: string) {
  const ctx = requireTenant();
  const p = await this.prisma.paciente.findUnique({ where: { id } });
  if (!p || p.tenantId !== ctx.tenantId) {
    throw new NotFoundException('Paciente no encontrado'); // 404, no 403
  }
  return p;
}
```

**Las secciones 2 y 3 del spec son la prueba de que esa verificación existe** en cada módulo: si alguien la olvida en un servicio nuevo, el test de lectura cruzada de ese módulo lo detecta.

> Si en el futuro se migra a claves compuestas `@@id([tenantId, id])` (alternativa A de ADR-002), las aserciones de §7 cambian y las verificaciones manuales podrían retirarse.

---

## 7. Cómo ejecutar

```bash
# 1. Base de datos de pruebas (nunca producción)
#    Opción A: Docker local
docker run -d --name dental-test -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=dental_saas_test -p 5433:5432 postgres:16

#    Opción B: rama/BD de Supabase para staging

# 2. Variables de entorno de prueba (archivo .env.test, no versionado)
DATABASE_URL="postgresql://postgres:test@localhost:5433/dental_saas_test"

# 3. Esquema y migraciones
npx prisma migrate deploy

# 4. Ejecutar las pruebas de aislamiento
npx vitest run --config vitest.config.e2e.ts --fileParallelism=false
```

**Requisitos:**
- `--fileParallelism=false`: las pruebas comparten base de datos y se pisan entre sí si corren en paralelo.
- La BD de pruebas **nunca** es la de producción; el fixture borra y recrea datos.

> ⚠️ **Para los tests de concurrencia usa PostgreSQL real, no PGlite.** El
> proyecto incluye `@electric-sql/pglite-socket` (Postgres embebido, útil para el
> resto de la suite porque no requiere Docker), pero **no soporta consultas
> concurrentes**: un `Promise.all` de 5 consultas cierra la conexión (`P1017`) o
> rompe el protocolo (`08P01: bind message supplies 2 parameters, but prepared
> statement "" requires 10`) y el error se propaga como un 500 o una aserción
> fallida que **no es del código**. Está reproducido con Prisma crudo y sin
> código de aplicación, así que no es un defecto de los servicios.
>
> Receta verificada (69/69 en verde sobre `postgres:16`):
>
> ```bash
> docker run -d --name dental-saas-test \
>   -e POSTGRES_PASSWORD=test -e POSTGRES_DB=dental_saas_test \
>   -p 5433:5432 postgres:16
> until docker exec dental-saas-test pg_isready -U postgres | grep -q accepting; do sleep 1; done
>
> export DATABASE_URL="postgresql://postgres:test@127.0.0.1:5433/dental_saas_test?sslmode=disable"
> npx prisma migrate deploy
> npx vitest run --config vitest.config.e2e.ts
> ```

---

## 8. Integración en CI

```yaml
# .github/workflows/ci.yml (extracto)
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_PASSWORD: test
      POSTGRES_DB: dental_saas_test
    ports: ['5432:5432']
    options: >-
      --health-cmd pg_isready --health-interval 10s
      --health-timeout 5s --health-retries 5

steps:
  - run: npx prisma migrate deploy
    env:
      DATABASE_URL: postgresql://postgres:test@localhost:5432/dental_saas_test
  - run: npx vitest run --config vitest.config.e2e.ts --fileParallelism=false
    env:
      DATABASE_URL: postgresql://postgres:test@localhost:5432/dental_saas_test
      JWT_SECRET: secreto-de-pruebas-de-al-menos-32-caracteres
```

**Regla:** el pipeline falla si falla cualquier caso de aislamiento. No hay excepciones ni `skip`.

---

## 9. Definition of Done de la Fase 1

- [ ] `prisma validate` en verde con el esquema multi-tenant.
- [ ] Migración aplicada en la BD de pruebas.
- [ ] `TenantContext` creado **en el guard** (no en middleware) y verificable.
- [ ] Extensión Prisma inyectando `tenantId` en `create`/`findMany`.
- [ ] Verificación de pertenencia en **todas** las mutaciones por id.
- [ ] Todos los casos de las secciones 5.1 a 5.7 en verde.
- [ ] Controles negativos en verde (A accede a lo suyo con 200).
- [ ] El pipeline ejecuta las pruebas de aislamiento en cada PR.
- [ ] Auditoría de intentos de acceso cruzado registrada (`Auditoria.resultado = FAILURE`).

---

## 10. Extensiones previstas (Fase 2 en adelante)

| Área | Caso añadido |
|---|---|
| **Storage** | A no puede obtener una URL firmada para un archivo de B, ni aunque conozca la clave exacta |
| **Sedes** | Un usuario con membresía en la sede 1 de A no opera sobre la sede 2 (si el plan lo restringe) |
| **Entitlements** | El plan "Consultorio" recibe 403 al intentar multi-sede (no solo se oculta el botón) |
| **Límites de plan** | Superar `limitValue` de usuarios/sedes devuelve 403 con mensaje de upgrade |
| **Export por tenant** | El ZIP de exportación de A jamás incluye filas de B |
| **Backups** | La restauración de un tenant no introduce filas de otro |

---

**Relacionado:** [dental-saas-arquitectura-v2.md](dental-saas-arquitectura-v2.md) · [schema.prisma](../backend/prisma/schema.prisma)
