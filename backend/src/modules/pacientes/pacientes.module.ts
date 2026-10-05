import { Module } from '@nestjs/common';
import { StorageService } from '../../core/storage/storage.service.js';
import { PacientesController } from './pacientes.controller.js';
import { PacientesService } from './pacientes.service.js';

@Module({
  controllers: [PacientesController],
  providers: [PacientesService, StorageService],
})
export class PacientesModule {}
