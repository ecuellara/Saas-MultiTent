import { Global, Module } from '@nestjs/common';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { SecuenciasService } from '../secuencias/secuencias.service.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, SecuenciasService, EntitlementsService],
  exports: [PrismaService, SecuenciasService, EntitlementsService],
})
export class PrismaModule {}
