import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max } from 'class-validator';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { CreatePacienteDto, UpdatePacienteDto } from './pacientes.dto.js';
import { PacientesService } from './pacientes.service.js';

export class CreateDocumentoDto {
  @ApiProperty({ example: 'radiografia.png' })
  @IsString()
  nombreArchivo!: string;

  @ApiProperty({ example: 'RX_PERIAPICAL' })
  @IsString()
  tipo!: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  mimeType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Max(20 * 1024)
  tamanioKb?: number;

  // `storageKey` NO se acepta del cliente: la construye el servidor (doc §9).
}

@ApiTags('pacientes')
@Controller('pacientes')
export class PacientesController {
  constructor(private readonly service: PacientesService) {}

  // Toda lectura clínica exige `patients.read`: antes ningún GET lo pedía, de
  // modo que un rol acotado (p. ej. recepción sin acceso a historia clínica)
  // podía leer expedientes completos con solo estar autenticado.
  @Get()
  @RequirePermission('patients.read')
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
  @RequirePermission('patients.read')
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
  @RequirePermission('patients.read')
  historiales(@Param('id') id: string): Promise<unknown> {
    return this.service.historiales(id);
  }

  @Get(':id/documentos')
  @RequirePermission('patients.read')
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
  @RequirePermission('patients.read')
  descarga(@Param('id') id: string, @Param('docId') docId: string): Promise<unknown> {
    return this.service.descarga(id, docId);
  }

  @Get(':id/odontogramas')
  @RequirePermission('patients.read')
  odontogramas(@Param('id') id: string): Promise<unknown> {
    return this.service.odontogramas(id);
  }
}
