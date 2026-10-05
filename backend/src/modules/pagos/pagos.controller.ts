import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { AbonoDto, CreatePagoDto } from './pagos.dto.js';
import { PagosService } from './pagos.service.js';

@ApiTags('pagos')
@Controller('pagos')
export class PagosController {
  constructor(private readonly service: PagosService) {}

  @Get()
  listar(): Promise<unknown> {
    return this.service.listar();
  }

  @Post()
  @RequirePermission('payments.write')
  crear(@Body() dto: CreatePagoDto): Promise<unknown> {
    return this.service.crear(dto);
  }

  @Get(':id')
  obtener(@Param('id') id: string): Promise<unknown> {
    return this.service.obtener(id);
  }

  @Post(':id/abonos')
  @RequirePermission('payments.write')
  abonar(@Param('id') id: string, @Body() dto: AbonoDto): Promise<unknown> {
    return this.service.abonar(id, dto);
  }

  @Patch(':id/anular')
  @RequirePermission('payments.cancel')
  anular(@Param('id') id: string): Promise<unknown> {
    return this.service.anular(id);
  }
}
