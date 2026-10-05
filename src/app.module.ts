import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AuditInterceptor } from './core/audit/audit.interceptor.js';
import { GlobalExceptionFilter } from './core/filters/global-exception.filter.js';
import { LoggingInterceptor } from './core/logging/logging.interceptor.js';
import { FeatureGuard } from './core/guards/feature.guard.js';
import { JwtAuthGuard } from './core/guards/jwt-auth.guard.js';
import { PermissionsGuard } from './core/guards/permissions.guard.js';
import { TenantGuard } from './core/guards/tenant.guard.js';
import { PrismaModule } from './core/prisma/prisma.module.js';
import { TenantContextMiddleware } from './core/tenant-context/tenant-context.middleware.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CitasModule } from './modules/citas/citas.module.js';
import { ComprasModule } from './modules/compras/compras.module.js';
import { ConsentimientosModule } from './modules/consentimientos/consentimientos.module.js';
import { EspecialidadesModule } from './modules/especialidades/especialidades.module.js';
import { FacturacionModule } from './modules/facturacion/facturacion.module.js';
import { HistorialesModule } from './modules/historiales/historiales.module.js';
import { InsumosModule } from './modules/insumos/insumos.module.js';
import { OdontogramaModule } from './modules/odontograma/odontograma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MembershipsModule } from './modules/memberships/memberships.module.js';
import { PacientesModule } from './modules/pacientes/pacientes.module.js';
import { PagosModule } from './modules/pagos/pagos.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { ProveedoresModule } from './modules/proveedores/proveedores.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { SedesModule } from './modules/sedes/sedes.module.js';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module.js';
import { TratamientosModule } from './modules/tratamientos/tratamientos.module.js';
import { UsuariosModule } from './modules/usuarios/usuarios.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PacientesModule,
    CitasModule,
    TratamientosModule,
    PagosModule,
    InsumosModule,
    ProveedoresModule,
    ComprasModule,
    ConsentimientosModule,
    EspecialidadesModule,
    FacturacionModule,
    HistorialesModule,
    OdontogramaModule,
    HealthModule,
    MembershipsModule,
    PlatformModule,
    RolesModule,
    SedesModule,
    UsuariosModule,
    SubscriptionsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(cookieParser()).forRoutes('*');
    // El scope ALS debe envolver toda la petición (ver TenantContextMiddleware).
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
