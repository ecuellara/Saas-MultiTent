import { SetMetadata } from '@nestjs/common';

export const IS_PLATFORM_KEY = 'isPlatform';

/**
 * Marca un controlador como parte del panel de plataforma.
 * `JwtAuthGuard` y `TenantGuard` lo omiten; `PlatformGuard` lo protege.
 */
export const Platform = () => SetMetadata(IS_PLATFORM_KEY, true);
