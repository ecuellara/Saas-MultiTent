import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/** Exige todos los códigos indicados (permisos del `TenantContext`). */
export const RequirePermission = (...codigos: string[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, codigos);
