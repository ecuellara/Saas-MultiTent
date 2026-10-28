import { Global, Module } from '@nestjs/common';
import { StorageService } from '../storage/storage.service.js';
import { BrandingService } from './branding.service.js';

/**
 * Marca de la clínica disponible para el módulo de configuración, el panel de
 * plataforma y la ruta pública del logo. `Global` evita registrar el storage
 * en tres módulos distintos.
 */
@Global()
@Module({
  providers: [StorageService, BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
