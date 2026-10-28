import { Controller, Get, Module, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../core/auth/public.decorator.js';
import { BrandingService } from '../../core/branding/branding.service.js';

/**
 * Recursos públicos de la clínica. El único por ahora es el logo: el login no
 * tiene sesión ni `X-Tenant-Id`, y el bucket de archivos es privado, así que la
 * imagen se lee en el servidor y se entrega por esta ruta.
 */
@ApiTags('publico')
@Controller('publico')
export class PublicoController {
  constructor(private readonly branding: BrandingService) {}

  @Public()
  @Get('logo/:slug')
  async logo(@Param('slug') slug: string, @Res() res: Response): Promise<void> {
    const logo = await this.branding.leerLogo(slug);
    if (!logo) throw new NotFoundException('Logo no encontrado');
    res.setHeader('Content-Type', logo.mimeType);
    res.setHeader('Content-Length', String(logo.buffer.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Se puede cachear en el navegador, pero corto: si el logo cambia debe
    // refrescarse sin esperar horas. La clave del objeto es fija.
    res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    res.end(logo.buffer);
  }
}

@Module({ controllers: [PublicoController] })
export class PublicoModule {}
