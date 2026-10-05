import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Injectable, Module, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { EntitlementsService } from '../../core/entitlements/entitlements.service.js';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

export class CreateSedeDto {
  @ApiProperty({ example: 'Sede norte' })
  @IsString()
  nombre!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  esPrincipal?: boolean;
}

type SedeRow = Record<string, unknown> & { id: string; tenantId: string };

type Db = {
  sede: {
    findMany: (a: unknown) => Promise<SedeRow[]>;
    findUnique: (a: unknown) => Promise<SedeRow | null>;
    create: (a: unknown) => Promise<SedeRow>;
  };
};

/**
 * Sedes (Fase 5). La primera sede es libre; a partir de la segunda se exige
 * la feature `multi_sede` y el límite `max_sedes` del plan (el plan
 * "Consultorio" recibe 403, no solo se oculta el botón).
 */
@Injectable()
export class SedesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}
  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  listar(): Promise<SedeRow[]> {
    requireTenant();
    return this.db.sede.findMany({ where: { deletedAt: null }, orderBy: { esPrincipal: 'desc' } });
  }

  async obtener(id: string): Promise<SedeRow> {
    const ctx = requireTenant();
    const s = await this.db.sede.findUnique({ where: { id } });
    if (!s || s.tenantId !== ctx.tenantId || (s as { deletedAt?: Date | null }).deletedAt) {
      throw new NotFoundException('Sede no encontrada');
    }
    return s;
  }

  async crear(dto: CreateSedeDto): Promise<SedeRow> {
    const ctx = requireTenant();
    const existentes = await this.db.sede.findMany({ where: { deletedAt: null } });
    if (existentes.length >= 1) {
      await this.entitlements.requireFeature(ctx.tenantId, 'multi_sede');
    }
    await this.entitlements.checkLimit(ctx.tenantId, 'max_sedes', existentes.length);
    return this.db.sede.create({
      data: {
        tenantId: ctx.tenantId,
        nombre: dto.nombre,
        direccion: dto.direccion ?? null,
        telefono: dto.telefono ?? null,
        esPrincipal: existentes.length === 0 ? true : (dto.esPrincipal ?? false),
      },
    });
  }
}

@ApiTags('sedes')
@Controller('sedes')
export class SedesController {
  constructor(private readonly service: SedesService) {}

  @Get()
  listar(): Promise<unknown> {
    return this.service.listar();
  }

  @Post()
  @RequirePermission('sedes.manage')
  crear(@Body() dto: CreateSedeDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }
}

@Module({ controllers: [SedesController], providers: [SedesService] })
export class SedesModule {}
