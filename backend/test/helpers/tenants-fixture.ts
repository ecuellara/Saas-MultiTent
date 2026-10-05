/**
 * Fixture de dos tenants (A y B) para las pruebas de aislamiento multi-tenant.
 *
 * Objetivo: disponer de un juego de datos **completo y determinista** en dos
 * clínicas distintas, para poder afirmar cosas como "A no puede leer el
 * paciente de B" en cada módulo del sistema.
 *
 * Uso:
 *   const datos = await seedDosTenants(prisma);
 *   // datos.a.pacienteId, datos.b.pacienteId, ...
 *
 * Notas de implementación:
 *  - El fixture escribe `tenantId` de forma **explícita**: no depende de la
 *    TenantContext ni de la extensión Prisma, y por tanto puede usarse con un
 *    cliente "crudo" en el setup de las pruebas.
 *  - Los identificadores son deterministas (prefijo `ta-` / `tb-`) para que los
 *    fallos sean fáciles de leer y para poder limpiar por prefijo.
 *
 * IMPORTANTE: este archivo se activa en la Fase 1, cuando existan AppModule y
 * los servicios. Hasta entonces es la especificación ejecutable del contrato.
 */
import * as bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';

export const PASSWORD_PLAIN = 'Prueba-Aislamiento-2026!';

export interface TenantFixture {
  tenantId: string;
  slug: string;
  sedeId: string;
  userId: string;
  userEmail: string;
  roleId: string;
  membershipId: string;
  pacienteId: string;
  numDoc: string;
  historialId: string;
  citaId: string;
  citaToken: string;
  tratamientoId: string;
  odontogramaId: string;
  hallazgoId: string;
  pagoId: string;
  codigoRecibo: string;
  cuotaId: string;
  insumoId: string;
  proveedorId: string;
  compraId: string;
  documentoId: string;
  consentimientoId: string;
}

export interface DosTenants {
  a: TenantFixture;
  b: TenantFixture;
}

/** Códigos de permiso que el seed debe garantizar en la tabla `Permission`. */
export const PERMISOS_BASE = [
  { codigo: 'patients.read', recurso: 'patients', accion: 'read' },
  { codigo: 'patients.write', recurso: 'patients', accion: 'write' },
  { codigo: 'patients.delete', recurso: 'patients', accion: 'delete' },
  { codigo: 'appointments.write', recurso: 'appointments', accion: 'write' },
  { codigo: 'payments.write', recurso: 'payments', accion: 'write' },
  { codigo: 'payments.cancel', recurso: 'payments', accion: 'cancel' },
  { codigo: 'inventory.write', recurso: 'inventory', accion: 'write' },
  { codigo: 'consents.write', recurso: 'consents', accion: 'write' },
  { codigo: 'sedes.manage', recurso: 'sedes', accion: 'manage' },
  { codigo: 'roles.manage', recurso: 'roles', accion: 'manage' },
  { codigo: 'members.manage', recurso: 'members', accion: 'manage' },
  { codigo: 'users.manage', recurso: 'users', accion: 'manage' },
];

/** Códigos del catálogo NTS 188 que el seed debe garantizar. */
export const HALLAZGOS_BASE = [
  { codigo: 'CARIES', nombre: 'Lesión de caries dental', abreviatura: 'C', alcance: 'superficie', requiereSuperficie: true, requiereMaterial: false, colorDefecto: 'rojo' },
  { codigo: 'OBTURADO', nombre: 'Restauración', abreviatura: 'O', alcance: 'superficie', requiereSuperficie: true, requiereMaterial: true, colorDefecto: 'azul' },
];

/**
 * Crea los dos tenants con un juego de datos equivalente y aislado.
 * Devuelve las referencias necesarias para las aserciones.
 */
export async function seedDosTenants(prisma: PrismaClient): Promise<DosTenants> {
  const passwordHash = await bcrypt.hash(PASSWORD_PLAIN, 10);

  // Catálogos globales (idempotentes)
  for (const p of PERMISOS_BASE) {
    await prisma.permission.upsert({
      where: { codigo: p.codigo },
      update: {},
      create: { id: `perm-${p.codigo}`, ...p },
    });
  }
  for (const h of HALLAZGOS_BASE) {
    await prisma.hallazgoCatalogo.upsert({
      where: { codigo: h.codigo },
      update: {},
      create: { id: `hallazgo-${h.codigo}`, ...h },
    });
  }

  const a = await seedTenant(prisma, {
    prefijo: 'ta',
    slug: 'clinica-a',
    nombre: 'Clínica A',
    email: 'admin-a@test.pe',
    numDocPaciente: '11111111',
    passwordHash,
  });

  const b = await seedTenant(prisma, {
    prefijo: 'tb',
    slug: 'clinica-b',
    nombre: 'Clínica B',
    email: 'admin-b@test.pe',
    numDocPaciente: '22222222',
    passwordHash,
  });

  return { a, b };
}

interface ParametrosTenant {
  prefijo: string;
  slug: string;
  nombre: string;
  email: string;
  numDocPaciente: string;
  passwordHash: string;
}

async function seedTenant(prisma: PrismaClient, p: ParametrosTenant): Promise<TenantFixture> {
  const t = p.prefijo;
  const tenantId = `${t}-tenant`;
  const sedeId = `${t}-sede`;
  const roleId = `${t}-role-admin`;
  const userId = `${t}-user`;
  const year = 2026;

  // ---- Tenant, config y sede ----
  await prisma.tenant.create({
    data: {
      id: tenantId,
      slug: p.slug,
      nombre: p.nombre,
      config: {
        create: { nombre: p.nombre, ciudad: 'Huancayo' },
      },
      sedes: {
        create: { id: sedeId, nombre: 'Sede principal', esPrincipal: true },
      },
    },
  });

  // ---- Rol + permisos del rol ----
  await prisma.role.create({
    data: { id: roleId, tenantId, codigo: 'ADMIN', nombre: 'Administrador', esSistema: true },
  });
  for (const perm of PERMISOS_BASE) {
    await prisma.rolePermission.create({
      data: { roleId, permissionId: `perm-${perm.codigo}` },
    });
  }

  // ---- Usuario + membresía ----
  await prisma.user.create({
    data: {
      id: userId,
      email: p.email,
      passwordHash: p.passwordHash,
      nombre: `Admin ${p.nombre}`,
      memberships: { create: { tenantId, roleId, sedeId } },
    },
  });
  const membership = await prisma.membership.findFirstOrThrow({ where: { tenantId, userId } });

  // ---- Paciente + historial ----
  const pacienteId = `${t}-paciente`;
  await prisma.paciente.create({
    data: {
      id: pacienteId,
      tenantId,
      tipoDoc: 'DNI',
      numDoc: p.numDocPaciente,
      nombres: 'Paciente',
      apellidos: p.nombre,
      fechaNac: new Date('1990-05-20'),
      telefono: '999000111',
    },
  });
  const historial = await prisma.historialClinico.create({
    data: {
      tenantId,
      pacienteId,
      fecha: new Date('2026-03-10'),
      hora: '09:00',
      motivo: 'Control',
      diagnostico: 'Sin hallazgos',
    },
  });

  // ---- Tratamiento ----
  const tratamiento = await prisma.tratamiento.create({
    data: {
      tenantId,
      nombre: `Limpieza dental ${t}`,
      precio: 120,
      duracionMin: 30,
    },
  });

  // ---- Cita ----
  const citaToken = `CIT-${t.toUpperCase()}0001`;
  const cita = await prisma.cita.create({
    data: {
      tenantId,
      token: citaToken,
      pacienteId,
      tratamientoId: tratamiento.id,
      sedeId,
      fecha: new Date('2026-03-10'),
      horaInicio: '09:00',
      horaFin: '09:30',
      estado: 'confirmada',
    },
  });

  // ---- Odontograma versionado + hallazgo ----
  const odontograma = await prisma.odontograma.create({
    data: {
      tenantId,
      pacienteId,
      version: 1,
      tipo: 'inicial',
      estado: 'borrador',
      fecha: new Date('2026-03-10'),
      piezas: { '16': { estado: 'caries', superficies: ['O'] } },
    },
  });
  const hallazgo = await prisma.odontogramaHallazgo.create({
    data: {
      tenantId,
      odontogramaId: odontograma.id,
      pieza: '16',
      hallazgoCodigo: 'CARIES',
      superficies: ['O'],
      estadoClinico: 'patologico',
      color: 'rojo',
    },
  });

  // ---- Pago + cuota ----
  // Deliberadamente el MISMO código de recibo en ambos tenants: es la prueba de
  // que la unicidad es por tenant (REC-2026-0001 puede existir en A y en B).
  const codigoRecibo = `REC-${year}-0001`;
  const pago = await prisma.pago.create({
    data: {
      tenantId,
      codigoRecibo,
      tipo: 'ingreso',
      pacienteId,
      citaId: cita.id,
      concepto: 'Limpieza dental',
      montoTotal: 120,
      montoPagado: 60,
      saldo: 60,
      metodoPago: 'efectivo',
      estado: 'parcial',
      fecha: new Date('2026-03-10'),
      usuarioId: userId,
      detalles: {
        create: {
          tenantId,
          descripcion: 'Limpieza dental',
          cantidad: 1,
          precioUnit: 120,
          subtotal: 120,
        },
      },
      cuotas: {
        create: {
          tenantId,
          nroCuota: 1,
          monto: 60,
          fechaVencimiento: new Date('2026-04-10'),
          estado: 'pendiente',
        },
      },
    },
    include: { cuotas: true },
  });

  // ---- Inventario: proveedor, insumo, compra ----
  const proveedor = await prisma.proveedor.create({
    data: { tenantId, nombre: `Proveedor ${t}`, ruc: `${t === 'ta' ? '20111111111' : '20222222222'}` },
  });
  const insumo = await prisma.insumo.create({
    data: { tenantId, sedeId, nombre: `Guantes ${t}`, unidad: 'caja', stockActual: 10, stockMinimo: 2, precioRef: 25 },
  });
  const compra = await prisma.compra.create({
    data: {
      tenantId,
      proveedorId: proveedor.id,
      sedeId,
      codigo: `CMP-${t.toUpperCase()}-0001`,
      fecha: new Date('2026-03-01'),
      montoTotal: 250,
      usuarioId: userId,
      detalles: {
        create: { tenantId, insumoId: insumo.id, cantidad: 10, precioUnit: 25, subtotal: 250 },
      },
    },
  });

  // ---- Documento del paciente ----
  const documento = await prisma.documentoPaciente.create({
    data: {
      tenantId,
      pacienteId,
      nombreArchivo: `radiografia-${t}.png`,
      tipo: 'RX_PERIAPICAL',
      mimeType: 'image/png',
      tamanioKb: 120,
      storageKey: `tenants/${tenantId}/patients/${pacienteId}/documents/radiografia-${t}.png`,
    },
  });

  // ---- Consentimiento ----
  const plantilla = await prisma.consentimientoPlantilla.create({
    data: { tenantId, clave: 'endodoncia', titulo: 'Consentimiento de endodoncia', cuerpo: 'Texto {{paciente}}' },
  });
  const consentimiento = await prisma.consentimientoFirmado.create({
    data: {
      tenantId,
      pacienteId,
      plantillaId: plantilla.id,
      datosSnapshot: { paciente: 'Paciente ' + p.nombre, edad: 35 },
      cuerpoSnapshot: 'Texto Paciente ' + p.nombre,
      estado: 'borrador',
    },
  });

  return {
    tenantId,
    slug: p.slug,
    sedeId,
    userId,
    userEmail: p.email,
    roleId,
    membershipId: membership.id,
    pacienteId,
    numDoc: p.numDocPaciente,
    historialId: historial.id,
    citaId: cita.id,
    citaToken,
    tratamientoId: tratamiento.id,
    odontogramaId: odontograma.id,
    hallazgoId: hallazgo.id,
    pagoId: pago.id,
    codigoRecibo,
    cuotaId: pago.cuotas[0]!.id,
    insumoId: insumo.id,
    proveedorId: proveedor.id,
    compraId: compra.id,
    documentoId: documento.id,
    consentimientoId: consentimiento.id,
  };
}

/** Borra todo lo creado por el fixture (por prefijo de id, sin tocar catálogos). */
export async function limpiarDosTenants(prisma: PrismaClient): Promise<void> {
  // El orden importa menos porque las FK son CASCADE desde Tenant.
  for (const prefijo of ['ta-', 'tb-']) {
    await prisma.tenant.deleteMany({ where: { id: { startsWith: prefijo } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefijo } } });
  }
}
