import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Module } from '@nestjs/common';
import { Public } from '../../core/auth/public.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async raiz(): Promise<{ status: string; database: string }> {
    return { status: 'ok', database: await this.ping() };
  }

  @Public()
  @Get('db')
  async db(): Promise<{ database: string }> {
    return { database: await this.ping() };
  }

  @Public()
  @Get('version')
  version(): { version: string } {
    return { version: '0.2.0-fase2' };
  }

  private async ping(): Promise<string> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch {
      return 'error';
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
