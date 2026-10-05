import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { CreateCitaDto, UpdateCitaDto } from './citas.dto.js';
import { CitasService } from './citas.service.js';

@ApiTags('citas')
@Controller('citas')
export class CitasController {
  constructor(private readonly service: CitasService) {}

  @Get()
  listar(@Query('fecha') fecha?: string): Promise<unknown> {
    return this.service.listar(fecha);
  }

  @Post()
  @RequirePermission('appointments.write')
  crear(@Body() dto: CreateCitaDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
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
