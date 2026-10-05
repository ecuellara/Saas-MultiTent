import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca una ruta como pública (login, health). Omite JwtAuthGuard y TenantGuard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
