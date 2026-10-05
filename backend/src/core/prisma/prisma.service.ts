import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { tenantExtension } from './tenant-extension.js';

/**
 * PrismaService con aislamiento multi-tenant (ADR-002 / ADR-003).
 *
 * Expone los delegados de modelo ya extendidos, de modo que
 * `prisma.paciente.findMany()` filtra por el `TenantContext` activo
 * y `prisma.paciente.create()` inyecta el `tenantId` del contexto.
 * `findUnique` por id global NO filtra (límite documentado): los
 * servicios verifican la pertenencia antes de mutar.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL no configurada');
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
    // Copia los delegados extendidos sobre esta instancia para que tanto
    // la aplicación como los tests (`app.get(PrismaService)`) usen la
    // extensión sin cambiar la forma de acceso (`prisma.paciente...`).
    const extended = this.$extends(tenantExtension) as unknown as Record<string, unknown>;
    for (const key of Object.keys(extended)) {
      if (key.startsWith('$')) continue;
      (this as unknown as Record<string, unknown>)[key] = extended[key];
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
