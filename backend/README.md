# Backend — Dental SaaS (multi-tenant)

API NestJS + Prisma/PostgreSQL del SaaS dental multi-tenant. El esquema, los
módulos de negocio y la suite e2e de aislamiento y contratos viven en este
directorio. La aplicación arranca desde `src/main.ts` compilado a `dist/`.

## Contenido

| Ruta | Qué es |
|---|---|
| `prisma/schema.prisma` | Esquema multi-tenant completo (43 modelos/tablas). Validado con Prisma 7.10.0 |
| `prisma/migrations/` | 10 migraciones, desde `0_init` hasta `8_quitar_ubigeo_paciente` |
| `prisma.config.ts` | Configuración de Prisma (la `url` ya no va en el schema en Prisma 7) |
| `test/helpers/tenants-fixture.ts` | Fixture de dos tenants (A y B) con datos completos |
| `test/*.e2e-spec.ts` | 27 specs e2e sobre PostgreSQL real: aislamiento, contratos, agenda, etc. |
| `vitest.config.e2e.ts` | Runner de las pruebas e2e |

## Comandos

```bash
npm install
npm run db:validate       # valida el esquema
npm run db:migrate        # aplica migraciones (requiere DATABASE_URL)
npm run test:aislamiento  # e2e: requiere DATABASE_URL de dental_saas_test y JWT_SECRET
npm run build             # compila a dist/
```

## Estado de verificaciones

| Verificación | Estado |
|---|---|
| `prisma validate` | ✅ válido |
| `tsc --noEmit` | ✅ sin errores |
| `build` | ✅ |
| `test:aislamiento` | ✅ 27 archivos / 278 pruebas (PostgreSQL 16 en 5433) |

## Variables de entorno

Ver `prisma.config.ts` y `.env`. Para desarrollo: `DATABASE_URL`.
Para la suite e2e: `DATABASE_URL` apuntando a `dental_saas_test` (nunca a
`dental_saas_dev`) y `JWT_SECRET`; el comando exacto está en
[`docs/como-probar.md`](../docs/como-probar.md), sección 7.

## Documentación

- [Arquitectura, mejoras y plan](../docs/dental-saas-arquitectura-v2.md)
- [Plan de pruebas de aislamiento](../docs/plan-pruebas-aislamiento.md)
