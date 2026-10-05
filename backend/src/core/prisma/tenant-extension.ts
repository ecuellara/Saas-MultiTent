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
        if (!ctx?.tenantId || !TENANT_MODELS.has(model)) {
          return query(args);
        }
        if (READ_OPS.has(operation) || WRITE_MANY_OPS.has(operation)) {
          (args as Record<string, unknown>).where = {
            ...((args as Record<string, unknown>).where as object | undefined),
            tenantId: ctx.tenantId,
          };
        }
        if (operation === 'create') {
          (args as Record<string, unknown>).data = {
            ...((args as Record<string, unknown>).data as object | undefined),
            tenantId: ctx.tenantId,
          };
        }
        if (operation === 'createMany') {
          const data = (args as Record<string, unknown>).data as
            | Record<string, unknown>
            | Array<Record<string, unknown>>;
          if (Array.isArray(data)) {
            (args as Record<string, unknown>).data = data.map((d) => ({
              ...d,
              tenantId: ctx.tenantId,
            }));
          } else if (data && typeof data === 'object') {
            (args as Record<string, unknown>).data = { ...data, tenantId: ctx.tenantId };
          }
        }
        return query(args);
      },
    },
  },
});
