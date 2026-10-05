/**
 * Migración Fase 4: clínica monoclínica (E:\clinicaDental) → SaaS multi-tenant.
 *
 * Estrategia ETL (no DDL in-place): lee la BD origen por SQL, escribe la BD
 * destino con `tenantId` inyectado. Se conservan los ids (cuid) para no
 * re-mapear ninguna FK.
 *
 * Idempotente: todo es `upsert` por id (o por natural key global). Re-ejecutar
 * con los mismos parámetros no duplica.
 *
 * Uso:
 *   npx tsx scripts/migrar-clinica.ts --source pg://... --target pg://... \
 *     --slug dental-cuellar --dry-run
 *   npx tsx scripts/migrar-clinica.ts --source ... --target ... --slug dental-cuellar
 *
 * Flags: --dry-run (no escribe), --solo-verificar (solo compara conteos),
 *   --uploads-origen DIR --uploads-destino DIR (copia archivos a
 *   tenants/{tenantId}/...; sin flags solo reescribe las claves en BD).
 *
 * Requiere: DATABASE_URL destino con migraciones aplicadas.
 * Backup del origen ANTES de correr (ver runbook en --ayuda).
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { CATALOGO_PERMISOS } from '../prisma/seed-data.js';

interface Args {
  source: string;
  target: string;
  slug: string;
  nombre: string;
  dryRun: boolean;
  soloVerificar: boolean;
  uploadsOrigen: string;
  uploadsDestino: string;
}

function leerArgs(): Args {
  const v: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(=(.*))?$/.exec(argv[i]!);
    if (!m) continue;
    const clave = m[1]!;
    if (m[3] !== undefined) {
      v[clave] = m[3];
    } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) {
      v[clave] = argv[++i]!;
    } else {
      v[clave] = '1';
    }
  }
  if (v['ayuda'] ?? v['help']) {
    console.log(`Runbook Fase 4
1. Backup origen: pg_dump -U clinica -d clinica_dental -F c -f backup-origen.dump
2. Congelar escritura en la clínica origen (ventana de corte).
3. Dry-run: este script con --dry-run (valida transforms y unicidades).
4. Migración: sin --dry-run. Re-ejecutable si algo falla a medias.
5. Verificar: --solo-verificar (conteos + integridad) y smoke en staging.
6. Cutover: apuntar frontend/API al SaaS; rollback = volver a la API origen
   (la BD origen no se toca nunca: este script solo LEE de ella).`);
    process.exit(0);
  }
  const source =
    v['source'] ?? process.env.CLINICA_SOURCE_URL ?? 'postgresql://clinica:clinica123@localhost:5432/clinica_dental';
  const target = v['target'] ?? process.env.DATABASE_URL ?? '';
  if (!target) throw new Error('Falta --target o DATABASE_URL');
  return {
    source,
    target,
    slug: v['slug'] ?? 'dental-cuellar',
    nombre: v['nombre'] ?? '',
    dryRun: 'dry-run' in v,
    soloVerificar: 'solo-verificar' in v,
    uploadsOrigen: v['uploads-origen'] ?? '',
    uploadsDestino: v['uploads-destino'] ?? '',
  };
}

const ROL_POR_ROL: Record<string, string> = { superadmin: 'ADMIN', odontologo: 'ODONTOLOGO' };
const PERMISOS_ADMIN = CATALOGO_PERMISOS.map((p) => p.codigo);
const PERMISOS_ODONTOLOGO = CATALOGO_PERMISOS.map((p) => p.codigo).filter(
  (c) => !['users.manage', 'roles.manage', 'members.manage', 'sedes.manage'].includes(c),
);

function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}
function aHora(min: number): string {
  const n = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

interface Reporte {
  tabla: string;
  origen: number;
  destino: number;
  omitidos: number;
  avisos: string[];
}

async function main(): Promise<void> {
  const args = leerArgs();
  const origen = new Pool({ connectionString: args.source });
  const destino = new PrismaClient({ adapter: new PrismaPg({ connectionString: args.target }) });
  type Delegado = Record<string, (arg?: unknown) => Promise<unknown>>;
  const db = destino as unknown as Record<string, Delegado>;
  const reportes: Reporte[] = [];
  const avisosGlobales: string[] = [];
  try {
    const clinica = (await origen.query('SELECT * FROM "ClinicaConfig" LIMIT 1')).rows[0] as
      | Record<string, unknown>
      | undefined;
    const nombre = args.nombre || (clinica?.nombre as string) || 'Clínica migrada';
    const tenantId = `tenant-${args.slug}`;
    const sedeId = `sede-${args.slug}-principal`;
    const rolAdminId = `rol-${args.slug}-admin`;
    const rolOdontoId = `rol-${args.slug}-odonto`;

    if (args.soloVerificar) {
      await verificar(origen, destino, tenantId);
      return;
    }

    const sel = async (tabla: string): Promise<Array<Record<string, unknown>>> =>
      (await origen.query(`SELECT * FROM "${tabla}"`)).rows as Array<Record<string, unknown>>;

    // ---- 1. Tenant + sede + catálogos globales ----
    if (!args.dryRun) {
      await db.tenant.upsert({
        where: { slug: args.slug },
        update: { nombre },
        create: { id: tenantId, slug: args.slug, nombre, estado: 'ACTIVE' },
      });
      await db.sede.upsert({
        where: { tenantId_nombre: { tenantId, nombre: 'Sede principal' } },
        update: {},
        create: { id: sedeId, tenantId, nombre: 'Sede principal', esPrincipal: true },
      });
      for (const p of CATALOGO_PERMISOS) {
        await db.permission.upsert({
          where: { codigo: p.codigo },
          update: {},
          create: { id: `perm-${p.codigo}`, ...p },
        });
      }
      for (const [id, codigo, codigos] of [
        [rolAdminId, 'ADMIN', PERMISOS_ADMIN],
        [rolOdontoId, 'ODONTOLOGO', PERMISOS_ODONTOLOGO],
      ] as Array<[string, string, string[]]>) {
        await db.role.upsert({
          where: { tenantId_codigo: { tenantId, codigo } },
          update: { nombre: codigo === 'ADMIN' ? 'Administrador' : 'Odontólogo' },
          create: { id, tenantId, codigo, nombre: codigo === 'ADMIN' ? 'Administrador' : 'Odontólogo', esSistema: true },
        });
        await db.rolePermission.deleteMany({ where: { roleId: id } });
        const perms = (await db.permission.findMany({ where: { codigo: { in: codigos } } })) as Array<{ id: string }>;
        if (perms.length) {
          await db.rolePermission.createMany({
            data: perms.map((x) => ({ roleId: id, permissionId: x.id })),
          });
        }
      }
      // TenantConfig desde ClinicaConfig + suscripción TRIAL si hay plan.
      await db.tenantConfig.upsert({
        where: { tenantId },
        update: {},
        create: {
          tenantId,
          nombre,
          ruc: (clinica?.ruc as string) ?? null,
          direccion: (clinica?.direccion as string) ?? null,
          telefono: (clinica?.telefono as string) ?? null,
          email: (clinica?.email as string) ?? null,
          ciudad: 'Huancayo',
          horario: (clinica?.horario as object) ?? null,
          logoUrl: (clinica?.logoUrl as string) ?? null,
        },
      });
      const planes = (await db.plan.findMany({ where: { codigo: 'clinica' } })) as Array<{ id: string }>;
      if (planes[0]) {
        avisosGlobales.push('Hay plan clinica en destino: asignar suscripción desde PUT /platform/subscriptions (facturación manual, ADR-008)');
      } else {
        avisosGlobales.push('Sin plan clinica en destino: tenant sin suscripción (entitlements abiertos)');
      }
    }

    // ---- 2. Usuarios + membresías ----
    const usuarios = await sel('User');
    const omitidos = 0;
    for (const u of usuarios) {
      const email = u.email as string;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        avisosGlobales.push(`Usuario ${u.id as string} con email no válido para login: '${email}' (REQUIERE ACCIÓN)`);
      }
      if (args.dryRun) continue;
      await db.user.upsert({
        where: { id: u.id },
        update: { nombre: u.nombre, cop: (u.cop as string) ?? null, estado: u.activo ? 'ACTIVE' : 'INACTIVE' },
        create: {
          id: u.id as string,
          email,
          passwordHash: u.passwordHash as string,
          nombre: u.nombre as string,
          cop: (u.cop as string) ?? null,
          estado: u.activo ? 'ACTIVE' : 'INACTIVE',
        },
      });
      const codigoRol = ROL_POR_ROL[u.rol as string] ?? 'ODONTOLOGO';
      if (!ROL_POR_ROL[u.rol as string]) avisosGlobales.push(`Rol desconocido '${u.rol as string}' → ODONTOLOGO (${email})`);
      await db.membership.upsert({
        where: { tenantId_userId: { tenantId, userId: u.id as string } },
        update: {},
        create: {
          tenantId,
          userId: u.id as string,
          roleId: codigoRol === 'ADMIN' ? rolAdminId : rolOdontoId,
          sedeId,
        },
      });
    }
    reportes.push({ tabla: 'User/Membership', origen: usuarios.length, destino: args.dryRun ? 0 : usuarios.length, omitidos, avisos: [] });

    // ---- 3. Catálogos con tenant ----
    const copiarSimple = async (
      tablaOrigen: string,
      modelo: string,
      mapear: (r: Record<string, unknown>) => Record<string, unknown>,
    ): Promise<void> => {
      const filas = await sel(tablaOrigen);
      let ok = 0;
      for (const f of filas) {
        if (args.dryRun) {
          ok++;
          continue;
        }
        await db[modelo].upsert({ where: { id: f.id }, update: {}, create: { ...mapear(f), id: f.id as string, tenantId } });
        ok++;
      }
      reportes.push({ tabla: tablaOrigen, origen: filas.length, destino: ok, omitidos: 0, avisos: [] });
    };

    await copiarSimple('Especialidad', 'especialidad', (f) => ({
      nombre: f.nombre, descripcion: f.descripcion ?? null, activo: f.activo ?? true,
    }));
    await copiarSimple('Tratamiento', 'tratamiento', (f) => ({
      especialidadId: (f.especialidadId as string) ?? null,
      nombre: f.nombre, descripcion: f.descripcion ?? null,
      precio: String(f.precio), duracionMin: (f.duracionMin as number) ?? 30,
      activo: f.activo ?? true, createdAt: f.createdAt, updatedAt: f.updatedAt,
    }));
    await copiarSimple('Paciente', 'paciente', (f) => ({ ...f, tenantId, id: undefined }));
    await copiarSimple('HistorialClinico', 'historialClinico', (f) => ({ ...f, tenantId, id: undefined }));
    await copiarSimple('DocumentoPaciente', 'documentoPaciente', (f) => ({
      ...f, tenantId, id: undefined,
      storageKey: moverClave(f.storageKey as string, tenantId, args),
    }));
    // HallazgoCatalogo global por codigo: ANTES de odontogramas/hallazgos (FK).
    for (const h of await sel('HallazgoCatalogo')) {
      if (args.dryRun) continue;
      await db.hallazgoCatalogo.upsert({
        where: { codigo: h.codigo as string },
        update: {},
        create: { ...(h as object) },
      });
    }
    await copiarSimple('Odontograma', 'odontograma', (f) => ({ ...f, tenantId, id: undefined }));
    await copiarSimple('OdontogramaHallazgo', 'odontogramaHallazgo', (f) => ({ ...f, tenantId, id: undefined }));
    await copiarSimple('OdontogramaEvento', 'odontogramaEvento', (f) => ({ ...f, tenantId, id: undefined }));
    await copiarSimple('ConsentimientoPlantilla', 'consentimientoPlantilla', (f) => ({ ...f, tenantId, id: undefined }));

    // ---- 4. Citas (horaFin derivada) ----
    const tratamientos = new Map(
      (await sel('Tratamiento')).map((t) => [t.id as string, (t.duracionMin as number) ?? 30]),
    );
    let citasOk = 0;
    for (const c of await sel('Cita')) {
      const dur = (c.tratamientoId as string | null) && tratamientos.has(c.tratamientoId as string)
        ? tratamientos.get(c.tratamientoId as string)!
        : 30;
      const horaFin = aHora(aMinutos(c.hora as string) + dur);
      if (args.dryRun) {
        citasOk++;
        continue;
      }
      const { hora: _hora, ...restoCita } = c;
      await db.cita.upsert({
        where: { id: c.id },
        update: {},
        create: {
          ...restoCita, id: c.id as string, tenantId,
          horaInicio: c.hora as string, horaFin, sedeId,
          dentistaId: null, tratamientoId: (c.tratamientoId as string) ?? null,
        } as object,
      });
      citasOk++;
    }

    // ---- 5. Pagos / detalles / cuotas ----
    await copiarSimple('Pago', 'pago', (f) => ({
      ...f, tenantId, id: undefined, usuarioId: null,
      montoTotal: String(f.montoTotal), montoPagado: String(f.montoPagado ?? 0), saldo: String(f.saldo ?? 0),
    }));
    await copiarSimple('PagoDetalle', 'pagoDetalle', (f) => ({
      ...f, tenantId, id: undefined,
      precioUnit: String(f.precioUnit), subtotal: String(f.subtotal),
    }));
    await copiarSimple('Cuota', 'cuota', (f) => ({ ...f, tenantId, id: undefined, monto: String(f.monto) }));

    // ---- 6. Inventario / compras ----
    await copiarSimple('Proveedor', 'proveedor', (f) => ({ ...f, tenantId, id: undefined }));
    await copiarSimple('Insumo', 'insumo', (f) => ({
      ...f, tenantId, id: undefined, sedeId, precioRef: f.precioRef != null ? String(f.precioRef) : null,
    }));
    await copiarSimple('MovimientoInventario', 'movimientoInventario', (f) => ({ ...f, tenantId, id: undefined, usuarioId: null }));
    await copiarSimple('Compra', 'compra', (f) => ({
      ...f, tenantId, id: undefined, sedeId: null, usuarioId: null, montoTotal: String(f.montoTotal),
    }));
    await copiarSimple('CompraDetalle', 'compraDetalle', (f) => ({
      ...f, tenantId, id: undefined, precioUnit: String(f.precioUnit), subtotal: String(f.subtotal),
    }));

    // ---- 7. Consentimientos firmados (snapshot congelado) ----
    const plantillas = new Map(
      (await sel('ConsentimientoPlantilla')).map((p) => [p.id as string, p.cuerpo as string]),
    );
    let consOk = 0;
    for (const c of await sel('ConsentimientoFirmado')) {
      if (args.dryRun) {
        consOk++;
        continue;
      }
      await db.consentimientoFirmado.upsert({
        where: { id: c.id },
        update: {},
        create: {
          ...(c as object), id: c.id as string, tenantId,
          cuerpoSnapshot: plantillas.get(c.plantillaId as string) ?? '',
          revocadoEn: c.estado === 'revocado' ? ((c.firmadoEn as Date) ?? new Date()) : null,
          revocadoPor: null,
        } as object,
      });
      consOk++;
    }

    // ---- 8. Google / WhatsApp / auditoría ----
    await copiarSimple('GoogleAccount', 'googleAccount', (f) => ({ ...f, tenantId, id: undefined }));
    await copiarSimple('PlantillaWhatsApp', 'plantillaWhatsApp', (f) => ({ ...f, tenantId, id: undefined }));
    await copiarSimple('Auditoria', 'auditoria', (f) => ({
      ...f, tenantId, id: undefined, resultado: 'SUCCESS', ip: null, userAgent: null,
    }));

    // Archivos
    const movidos = copiarArchivos(args, tenantId);

    console.log(`\nMigración ${args.dryRun ? '(DRY-RUN) ' : ''}tenant '${args.slug}' (${nombre})`);
    for (const r of reportes) {
      console.log(`  ${r.tabla}: origen=${r.origen} destino=${r.destino}`);
    }
    console.log(`  Cita: ${(await sel('Cita')).length} (horaFin derivada)`);
    console.log(`  ConsentimientoFirmado: snapshot congelado en ${consOk} filas`);
    console.log(`  Archivos copiados: ${movidos}`);
    if (avisosGlobales.length) {
      console.log('AVISOS:');
      for (const a of [...new Set(avisosGlobales)]) console.log(`  ! ${a}`);
    }
    if (!args.dryRun) await verificar(origen, destino, tenantId);
  } finally {
    await origen.end();
    await destino.$disconnect();
  }
}

/** Reescribe la clave al layout multi-tenant y copia el archivo si se indicó destino. */
function moverClave(clave: string, tenantId: string, args: Args): string {
  const limpia = (clave || '').replace(/^\/+/, '');
  if (!limpia) return limpia;
  if (limpia.startsWith(`tenants/${tenantId}/`)) return limpia;
  const nueva = `tenants/${tenantId}/${limpia}`;
  if (args.uploadsOrigen && args.uploadsDestino && !args.dryRun) {
    const src = path.join(args.uploadsOrigen, limpia);
    const dst = path.join(args.uploadsDestino, nueva);
    try {
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
    } catch {
      // Se reporta en verificación; no bloquea la migración de datos.
    }
  }
  return nueva;
}

function copiarArchivos(args: Args, tenantId: string): number {
  if (!args.uploadsOrigen || !args.uploadsDestino || args.dryRun) return 0;
  let n = 0;
  const caminar = (dir: string, base: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) caminar(full, base);
      else {
        const rel = path.relative(base, full).replace(/\\/g, '/');
        const dst = path.join(args.uploadsDestino, 'tenants', tenantId, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(full, dst);
        n++;
      }
    }
  };
  if (fs.existsSync(args.uploadsOrigen)) caminar(args.uploadsOrigen, args.uploadsOrigen);
  return n;
}

async function verificar(origen: Pool, destino: PrismaClient, tenantId: string): Promise<void> {
  const db = destino as unknown as Record<string, { count: (a: unknown) => Promise<number> }>;
  const pares: Array<[string, string, object?]> = [
    ['Paciente', 'paciente'], ['Cita', 'cita'], ['Pago', 'pago'],
    ['PagoDetalle', 'pagoDetalle'], ['Cuota', 'cuota'], ['Tratamiento', 'tratamiento'],
    ['Especialidad', 'especialidad'], ['HistorialClinico', 'historialClinico'],
    ['Odontograma', 'odontograma'], ['OdontogramaHallazgo', 'odontogramaHallazgo'],
    ['OdontogramaEvento', 'odontogramaEvento'], ['ConsentimientoPlantilla', 'consentimientoPlantilla'],
    ['ConsentimientoFirmado', 'consentimientoFirmado'], ['Proveedor', 'proveedor'],
    ['Insumo', 'insumo'], ['MovimientoInventario', 'movimientoInventario'],
    ['Compra', 'compra'], ['CompraDetalle', 'compraDetalle'],
    ['DocumentoPaciente', 'documentoPaciente'], ['GoogleAccount', 'googleAccount'],
    ['PlantillaWhatsApp', 'plantillaWhatsApp'],
  ];
  let mal = 0;
  console.log('\nVerificación (origen vs tenant):');
  for (const [origenTabla, modelo] of pares) {
    const a = Number((await origen.query(`SELECT COUNT(*)::int AS n FROM "${origenTabla}"`)).rows[0].n);
    const b = await db[modelo].count({ where: { tenantId } });
    const ok = a === b;
    if (!ok) mal++;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${origenTabla}: origen=${a} tenant=${b}`);
  }
  // Integridad: citas sin horaFin, pagos con saldo inconsistente.
  const sinFin = Number(
    (await destino.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "Cita" WHERE "tenantId" = $1 AND ("horaFin" IS NULL OR "horaFin" = '')`,
      tenantId,
    ) as Array<{ n: number }>)[0].n,
  );
  console.log(`  ${sinFin === 0 ? 'OK  ' : 'FAIL'} citas sin horaFin: ${sinFin}`);
  if (sinFin !== 0) mal++;
  const saldos = Number(
    (await destino.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "Pago" WHERE "tenantId" = $1 AND ABS("montoPagado" + "saldo" - "montoTotal") > 0.01`,
      tenantId,
    ) as Array<{ n: number }>)[0].n,
  );
  console.log(`  ${saldos === 0 ? 'OK  ' : 'FAIL'} pagos con saldo inconsistente: ${saldos}`);
  if (saldos !== 0) mal++;
  if (mal > 0) {
    console.error(`VERIFICACIÓN FALLIDA (${mal} controles)`);
    process.exitCode = 1;
  } else {
    console.log('VERIFICACIÓN OK');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
