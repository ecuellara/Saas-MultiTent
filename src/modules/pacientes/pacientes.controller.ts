import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { CreatePacienteDto, UpdatePacienteDto } from './pacientes.dto.js';
import { PacientesService } from './pacientes.service.js';

export class CreateDocumentoDto {
  @IsString()
  nombreArchivo!: string;

  @IsString()
  tipo!: string;

  @IsString()
  mimeType!: string;

  @IsOptional()
  @IsInt()
  @Max(20 * 1024)
  tamanioKb?: number;

  @IsOptional()
  @IsString()
  storageKey?: string;
}

@Controller('pacientes')
export class PacientesController {
  constructor(private readonly service: PacientesService) {}

  @Get()
  listar(@Query('limit') limit?: string): Promise<unknown> {
    const n = limit !== undefined ? Number.parseInt(limit, 10) : 100;
    return this.service.listar(Number.isNaN(n) ? 100 : n);
  }

  @Post()
  @RequirePermission('patients.write')
  crear(@Body() dto: CreatePacienteDto): Promise<unknown> {
    return this.service.crear(dto as unknown as Record<string, unknown>);
  }

  @Get(':id')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }

  @Patch(':id')
  @RequirePermission('patients.write')
  actualizar(@Param('id') id: string, @Body() dto: UpdatePacienteDto): Promise<unknown> {
    return this.service.actualizar(id, dto as unknown as Record<string, unknown>);
  }

  @Delete(':id')
  @RequirePermission('patients.delete')
  eliminar(@Param('id') id: string): Promise<unknown> {
    return this.service.eliminar(id);
  }

  @Get(':id/historiales')
  historiales(@Param('id') id: string): Promise<unknown> {
    return this.service.historiales(id);
  }

  @Get(':id/documentos')
  documentos(@Param('id') id: string): Promise<unknown> {
    return this.service.documentos(id);
  }

  @Post(':id/documentos')
  @RequirePermission('patients.write')
  registrarDocumento(
    @Param('id') id: string,
    @Body() dto: CreateDocumentoDto,
  ): Promise<unknown> {
    return this.service.registrarDocumento(id, dto);
  }

  @Get(':id/documentos/:docId/descarga')
  descarga(@Param('id') id: string, @Param('docId') docId: string): Promise<unknown> {
    return this.service.descarga(id, docId);
  }

  @Get(':id/odontogramas')
  odontogramas(@Param('id') id: string): Promise<unknown> {
    return this.service.odontogramas(id);
  }
}
