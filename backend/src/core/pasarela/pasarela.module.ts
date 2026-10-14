import { Module } from '@nestjs/common';
import { PasarelaService } from './pasarela.service.js';

@Module({ providers: [PasarelaService], exports: [PasarelaService] })
export class PasarelaModule {}
