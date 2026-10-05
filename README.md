# Backend — Dental SaaS (multi-tenant)

Estado: **Fase 1 en preparación**. Este directorio contiene por ahora los cimientos
verificables: el esquema de datos multi-tenant validado y el contrato de pruebas de
aislamiento. La aplicación NestJS se implementa en la Fase 1.

## Contenido

| Ruta | Qué es |
|---|---|
| `prisma/schema.prisma` | Esquema multi-tenant completo (37 modelos/tablas). Validado con Prisma 7.10.0 |
| `prisma/migrations/0_init/migration.sql` | DDL inicial generado (738 líneas) |
| `prisma.config.ts` | Configuración de Prisma (la `url` ya no va en el schema en Prisma 7) |
| `test/helpers/tenants-fixture.ts` | Fixture de dos tenants (A y B) con datos completos |
| `test/aislamiento.e2e-spec.ts` | Spec de aislamiento multi-tenant (criterio de salida de Fase 1) |
| `vitest.config.e2e.ts` | Runner de las pruebas e2e |

## Comandos

```bash
npm install
npm run db:validate       # valida el esquema
npm run db:migrate        # aplica migraciones (requiere DATABASE_URL)
npm run test:aislamiento  # ejecuta las pruebas de aislamiento
```

## Estado de verificaciones

| Verificación | Estado |
|---|---|
| `prisma validate` | ✅ válido |
| `prisma format` | ✅ sin cambios estructurales |
| DDL generado | ✅ 37 tablas, 738 líneas |
| `test:aislamiento` | ⏳ se activa al implementar `src/app.module.ts` (Fase 1) |

## Variables de entorno

Ver `prisma.config.ts` y `.env`. Requeridas: `DATABASE_URL`.
En Fase 1 se añaden además `JWT_SECRET`, `FRONTEND_URL`, `PORT` y las de Google/Supabase.

## Documentación

- [Arquitectura, mejoras y plan](../docs/dental-saas-arquitectura-v2.md)
- [Plan de pruebas de aislamiento](../docs/plan-pruebas-aislamiento.md)
