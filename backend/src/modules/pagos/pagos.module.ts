import { Module } from '@nestjs/common';
import { PagosController } from './pagos.controller.js';
import { PagosService } from './pagos.service.js';
import { IzipayService } from './izipay.service.js';

@Module({ controllers: [PagosController], providers: [PagosService, IzipayService], exports: [IzipayService] })
export class PagosModule {}
