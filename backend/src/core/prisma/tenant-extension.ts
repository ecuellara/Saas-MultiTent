import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { tenantContext } from '../tenant-context/tenant-context.js';

/**
 * Modelos con columna `tenantId` denormalizada (ADR-002).
 * La extensión inyecta/filtra `tenantId` automáticamente.
 * `findUnique`/`update`/`delete` por id NO se tocan (límite conocido de
 * Prisma): los servicios verifican `registro.tenantId === ctx.tenantId`.
 */
export const TENANT_MODELS = new Set([
  'Sede',
  'Membership',
  'Role',
  'Paciente',
  'DocumentoPaciente',
  'Especialidad',
  'Tratamiento',
  'Cita',
  'HistorialClinico',
  'Odontograma',
  'OdontogramaHallazgo',
  'OdontogramaEvento',
  'ConsentimientoPlantilla',
  'ConsentimientoFirmado',
  'GoogleAccount',
  'Pago',
  'PagoDetalle',
  'Cuota',
  'Proveedor',
  'Insumo',
  'MovimientoInventario',
  'Compra',
  'CompraDetalle',
  'TenantConfig',
  'PlantillaWhatsApp',
  'Auditoria',
  'CobroSuscripcion',
]);

const READ_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_MANY_OPS = new Set(['updateMany', 'deleteMany']);

export const tenantExtension = Prisma.defineExtension({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = tenantContext.getStore();
        // Solo con contexto VALIDADO por TenantGuard. En rutas @Public/@Platform el
        // store queda sin validar y la extensión no debe filtrar (el panel de
        // plataforma necesita acceso cruzado legítimo).
        if (!ctx?.validado || !ctx.tenantId || !TENANT_MODELS.has(model)) {
          return query(args);
        }
        const a = args as Record<string, unknown>;
        // Nunca sobrescribir en silencio un `tenantId` explícito distinto: si un
        // servicio declara otro tenant es un bug (o un intento de acceso cruzado).
        const declarado = (a.where as Record<string, unknown> | undefined)?.tenantId;
        const declaradoData = Array.isArray(a.data)
          ? undefined
          : (a.data as Record<string, unknown> | undefined)?.tenantId;
        if (
          (declarado !== undefined && declarado !== ctx.tenantId) ||
          (declaradoData !== undefined && declaradoData !== ctx.tenantId)
        ) {
          throw new ForbiddenException('tenantId declarado distinto del tenant de la sesión');
        }
        if (READ_OPS.has(operation) || WRITE_MANY_OPS.has(operation)) {
          a.where = {
            ...(a.where as object | undefined),
            tenantId: ctx.tenantId,
          };
        }
        if (operation === 'create') {
          a.data = {
            ...(a.data as object | undefined),
            tenantId: ctx.tenantId,
          };
        }
        if (operation === 'createMany') {
          const data = a.data as Record<string, unknown> | Array<Record<string, unknown>>;
          if (Array.isArray(data)) {
            a.data = data.map((d) => ({ ...d, tenantId: ctx.tenantId }));
          } else if (data && typeof data === 'object') {
            a.data = { ...data, tenantId: ctx.tenantId };
          }
        }
        return query(args);
      },
    },
  },
});
