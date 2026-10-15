import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { CreateCitaDto, DisponibilidadQuery, ListarCitasQuery, UpdateCitaDto } from './citas.dto.js';
import { CitasService } from './citas.service.js';

@ApiTags('citas')
@Controller('citas')
export class CitasController {
  constructor(private readonly service: CitasService) {}

  @Get()
  @RequirePermission('appointments.read')
  listar(@Query() q: ListarCitasQuery): Promise<unknown> {
    return this.service.listar(q);
  }

  /**
   * Rejilla de disponibilidad (pasos de 15 minutos). Va ANTES de `:id`: si no,
   * `disponibilidad` caería en `obtener` y devolvería 404.
   */
  @Get('disponibilidad')
  @RequirePermission('appointments.read')
  disponibilidad(@Query() q: DisponibilidadQuery): Promise<unknown> {
    return this.service.disponibilidad(q);
  }

  @Post()
  @RequirePermission('appointments.write')
  crear(@Body() dto: CreateCitaDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  @RequirePermission('appointments.read')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }

  @Patch(':id')
  @RequirePermission('appointments.write')
  actualizar(@Param('id') id: string, @Body() dto: UpdateCitaDto): Promise<unknown> {
    return this.service.actualizar(id, dto);
  }

  @Patch(':id/cancelar')
  @RequirePermission('appointments.write')
  cancelar(@Param('id') id: string): Promise<unknown> {
    return this.service.cancelar(id);
  }
}
