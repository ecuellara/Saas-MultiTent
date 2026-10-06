import { SetMetadata } from '@nestjs/common';

export const IS_TENANT_OPCIONAL_KEY = 'tenantOpcional';

/**
 * Marca una ruta donde `X-Tenant-Id` es OPCIONAL (ADR-003 / ADR-005).
 *
 * - **Sin cabecera**: `TenantGuard` no valida nada y deja pasar. El
 *   `TenantContext` queda con `validado: false`, exactamente igual que en las
 *   rutas `@Public`, así que la extensión Prisma NO filtra y el servicio debe
 *   acotar sus consultas con el `userId` / `tenantId` explícitos.
 * - **Con cabecera**: el comportamiento no cambia (valida tenant + membresía,
 *   puebla el contexto, o responde 403).
 *
 * NO equivale a `@Public`: el token sigue siendo obligatorio (lo exige
 * `JwtAuthGuard`). Existe para `GET /auth/sesion`, donde el usuario necesita
 * saber a qué clínicas pertenece ANTES de poder elegir una (problema del huevo
 * y la gallina: `GET /memberships` ya exige `X-Tenant-Id` y `members.manage`).
 */
export const TenantOpcional = () => SetMetadata(IS_TENANT_OPCIONAL_KEY, true);
