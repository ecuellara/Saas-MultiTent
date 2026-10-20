import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';
import {
  CATALOGO_PLANTILLAS,
  DESCRIPCION_MARCADORES,
} from '../../core/catalogo/plantillas.js';

/**
 * Plantillas de notificación por clínica (WhatsApp MANUAL vía `wa.me`).
 *
 * No hay envío desde el servidor, ni API de Meta, ni colas: el backend guarda
 * los textos y el cliente compone el enlace. El `GET` mezcla el catálogo (por
 * defecto) con la personalización del tenant; el `PATCH` hace upsert por
 * clave; `POST :clave/restaurar` vuelve al texto por defecto.
 */

export class ActualizarPlantillaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  texto?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export interface PlantillaVista {
  clave: string;
  nombre: string;
  texto: string;
  activo: boolean;
  esDefecto: boolean;
  marcadores: string[];
}

type FilaPlantilla = {
  clave: string;
  texto: string;
  activo: boolean;
};

type Db = {
  plantillaWhatsApp: {
    findMany: (a: unknown) => Promise<FilaPlantilla[]>;
    upsert: (a: unknown) => Promise<FilaPlantilla>;
    delete: (a: unknown) => Promise<FilaPlantilla>;
  };
};

@Injectable()
export class PlantillasService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  /** Catálogo con la personalización del tenant encima (aislado por clínica). */
  async listar(): Promise<{ plantillas: PlantillaVista[]; marcadores: typeof DESCRIPCION_MARCADORES }> {
    requireTenant();
    const filas = await this.db.plantillaWhatsApp.findMany({});
    const porClave = new Map(filas.map((f) => [f.clave, f]));
    return {
      plantillas: CATALOGO_PLANTILLAS.map((c) => {
        const fila = porClave.get(c.clave);
        return {
          clave: c.clave,
          nombre: c.nombre,
          texto: fila?.texto ?? c.texto,
          activo: fila?.activo ?? true,
          // «Por defecto» significa que el texto es el de fábrica, no que no
          // exista fila: el alta siembra las 3 y aun así son las de fábrica.
          esDefecto: !fila || fila.texto === c.texto,
          marcadores: [...c.marcadores],
        };
      }),
      marcadores: DESCRIPCION_MARCADORES,
    };
  }

  async actualizar(clave: string, dto: ActualizarPlantillaDto): Promise<PlantillaVista> {
    const ctx = requireTenant();
    const base = CATALOGO_PLANTILLAS.find((c) => c.clave === clave);
    if (!base) throw new NotFoundException('Plantilla desconocida');
    const texto = dto.texto?.trim();
    if (texto !== undefined && texto === '') {
      throw new BadRequestException('El texto no puede estar vacío');
    }
    if (texto === undefined && dto.activo === undefined) {
      throw new BadRequestException('Nada que actualizar');
    }
    const fila = await this.db.plantillaWhatsApp.upsert({
      where: { tenantId_clave: { tenantId: ctx.tenantId, clave } },
      update: {
        ...(texto !== undefined ? { texto } : {}),
        ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
      },
      create: {
        tenantId: ctx.tenantId,
        clave,
        texto: texto ?? base.texto,
        activo: dto.activo ?? true,
      },
    });
    return {
      clave,
      nombre: base.nombre,
      texto: fila.texto,
      activo: fila.activo,
      esDefecto: fila.texto === base.texto,
      marcadores: [...base.marcadores],
    };
  }

  /** Vuelve al texto por defecto (conserva el estado activo/inactivo). */
  async restaurar(clave: string): Promise<PlantillaVista> {
    const ctx = requireTenant();
    const base = CATALOGO_PLANTILLAS.find((c) => c.clave === clave);
    if (!base) throw new NotFoundException('Plantilla desconocida');
    // `findMany` ya filtra por el tenant del contexto (extensión Prisma): si
    // hay fila, es propia.
    const filas = await this.db.plantillaWhatsApp.findMany({ where: { clave } });
    const fila = filas[0];
    if (!fila) {
      return {
        clave,
        nombre: base.nombre,
        texto: base.texto,
        activo: true,
        esDefecto: true,
        marcadores: [...base.marcadores],
      };
    }
    const db = this.prisma as unknown as {
      plantillaWhatsApp: { update: (a: unknown) => Promise<FilaPlantilla> };
    };
    const final = await db.plantillaWhatsApp.update({
      where: { tenantId_clave: { tenantId: ctx.tenantId, clave } },
      data: { texto: base.texto },
    });
    return {
      clave,
      nombre: base.nombre,
      texto: final.texto,
      activo: final.activo,
      esDefecto: final.texto === base.texto,
      marcadores: [...base.marcadores],
    };
  }
}

@ApiTags('plantillas-whatsapp')
@Controller('plantillas-whatsapp')
export class PlantillasController {
  constructor(private readonly service: PlantillasService) {}

  @Get()
  @RequirePermission('appointments.read')
  listar(): Promise<unknown> {
    return this.service.listar();
  }

  @Patch(':clave')
  @RequirePermission('appointments.write')
  actualizar(
    @Param('clave') clave: string,
    @Body() dto: ActualizarPlantillaDto,
  ): Promise<unknown> {
    return this.service.actualizar(clave, dto);
  }

  @Post(':clave/restaurar')
  @RequirePermission('appointments.write')
  restaurar(@Param('clave') clave: string): Promise<unknown> {
    return this.service.restaurar(clave);
  }
}

@Module({ controllers: [PlantillasController], providers: [PlantillasService] })
export class PlantillasModule {}
