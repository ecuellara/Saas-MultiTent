/**
 * Arranque de DEMOSTRACIÓN: deja una clínica completa para poder probar la
 * aplicación en local sin depender de la base de datos de la clínica real.
 *
 * POR QUÉ EXISTE: el seed normal (`prisma/seed.ts`) solo crea el catálogo de
 * permisos, los planes y el usuario del panel de plataforma. Y **no hay forma de
 * crear una clínica por API** — no existe `POST /platform/tenants` — así que sin
 * este script la única vía para tener una cuenta de clínica era migrar la clínica
 * real con `npm run db:migrar-clinica`. Resultado: el sistema no se podía probar
 * en un entorno nuevo.
 *
 * Qué crea (todo idempotente):
 *   - catálogo de permisos (si falta),
 *   - la clínica `demo` con su configuración (horario de atención) y una sede,
 *   - el rol `ADMIN` con TODOS los permisos,
 *   - el usuario dueño y su membresía,
 *   - una suscripción al plan `clinica` (para que haya features que mostrar),
 *   - datos de ejemplo: 3 pacientes, 3 tratamientos y 2 citas.
 *
 * Requiere (sin valores por defecto, igual que el seed normal):
 *   DEMO_OWNER_EMAIL, DEMO_OWNER_PASSWORD (mín. 12 caracteres)
 *
 * Uso: `npm run db:seed-demo`
 *
 * NO usar en producción: crea datos de ejemplo con una contraseña conocida por
 * quien ejecute el comando.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { CATALOGO_PERMISOS } from './seed-data.js';

const SLUG = 'demo';

/** Horario de atención de la clínica demo (forma que entiende `CitasService`). */
const HORARIO = {
  lun: { inicio: '09:00', fin: '19:00' },
  mar: { inicio: '09:00', fin: '19:00' },
  mie: { inicio: '09:00', fin: '19:00' },
  jue: { inicio: '09:00', fin: '19:00' },
  vie: { inicio: '09:00', fin: '19:00' },
  sab: { inicio: '09:00', fin: '13:00' },
  dom: null,
};

/**
 * Se declara la interfaz (y no un array de literales con formas distintas) porque
 * al dispersar cada elemento hacia un `create` de Prisma, TypeScript infiere una
 * unión de formas y rechaza el objeto.
 */
interface PacienteDemo {
  tipoDoc: string;
  numDoc: string;
  nombres: string;
  apellidos: string;
  fechaNac: string;
  sexo: string;
  telefono: string;
  email?: string;
  alergias?: string;
}

const PACIENTES_DEMO: PacienteDemo[] = [
  {
    tipoDoc: 'DNI',
    numDoc: '70000001',
    nombres: 'Valeria',
    apellidos: 'Quispe Rojas',
    fechaNac: '1990-05-20',
    sexo: 'F',
    telefono: '999000111',
    email: 'valeria@ejemplo.pe',
  },
  {
    tipoDoc: 'DNI',
    numDoc: '70000002',
    nombres: 'Marco',
    apellidos: 'Salazar Ruiz',
    fechaNac: '1984-11-02',
    sexo: 'M',
    telefono: '999000222',
  },
  {
    tipoDoc: 'DNI',
    numDoc: '70000003',
    nombres: 'Ana',
    apellidos: 'Ferro Lazo',
    fechaNac: '2012-03-15',
    sexo: 'F',
    telefono: '999000333',
    alergias: 'Penicilina',
  },
];

const TRATAMIENTOS_DEMO = [
  { nombre: 'Limpieza dental', precio: 120, duracionMin: 30 },
  { nombre: 'Resina simple', precio: 180, duracionMin: 45 },
  { nombre: 'Endodoncia unirradicular', precio: 450, duracionMin: 60 },
];

/** Fecha civil `aaaa-mm-dd` de un `Date`, en hora local de quien ejecuta. */
function fechaCivil(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * Próximo día con atención (lunes a sábado). Se evita el domingo porque el
 * horario de la demo no atiende y `CitasService` rechazaría la cita.
 */
function proximoDiaHabil(): string {
  const d = new Date();
  for (let i = 0; i < 7; i++) {
    const iso = fechaCivil(d);
    // El día de la semana se lee del valor que se va a guardar (UTC medianoche).
    if (new Date(`${iso}T00:00:00.000Z`).getUTCDay() !== 0) return iso;
    d.setDate(d.getDate() + 1);
  }
  return fechaCivil(new Date());
}

async function main(): Promise<void> {
  const email = process.env.DEMO_OWNER_EMAIL;
  const password = process.env.DEMO_OWNER_PASSWORD;
  if (!email || !password) {
    throw new Error('Faltan DEMO_OWNER_EMAIL / DEMO_OWNER_PASSWORD (sin valores por defecto)');
  }
  if (password.length < 12) {
    throw new Error('DEMO_OWNER_PASSWORD debe tener al menos 12 caracteres');
  }
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // ---- Catálogo de permisos -------------------------------------------------
    for (const p of CATALOGO_PERMISOS) {
      await prisma.permission.upsert({
        where: { codigo: p.codigo },
        update: { recurso: p.recurso, accion: p.accion },
        create: { id: `perm-${p.codigo}`, ...p },
      });
    }

    // ---- Plan (lo crea `npm run db:seed`) ------------------------------------
    const plan = await prisma.plan.findUnique({ where: { codigo: 'clinica' } });
    if (!plan) throw new Error('Falta el plan «clinica». Ejecuta antes: npm run db:seed');

    // ---- Clínica, configuración y sede ---------------------------------------
    const tenant = await prisma.tenant.upsert({
      where: { slug: SLUG },
      update: { nombre: 'Clínica Demo' },
      create: { slug: SLUG, nombre: 'Clínica Demo' },
    });

    await prisma.tenantConfig.upsert({
      where: { tenantId: tenant.id },
      update: { horario: HORARIO, descansos: [] },
      create: {
        tenantId: tenant.id,
        nombre: 'Clínica Demo',
        ciudad: 'Huancayo',
        telefono: '064000000',
        email,
        horario: HORARIO,
        descansos: [],
      },
    });

    const sede =
      (await prisma.sede.findFirst({ where: { tenantId: tenant.id } })) ??
      (await prisma.sede.create({
        data: { tenantId: tenant.id, nombre: 'Sede principal', esPrincipal: true },
      }));

    // ---- Rol ADMIN con todos los permisos ------------------------------------
    const rol =
      (await prisma.role.findFirst({ where: { tenantId: tenant.id, codigo: 'ADMIN' } })) ??
      (await prisma.role.create({
        data: { tenantId: tenant.id, codigo: 'ADMIN', nombre: 'Administrador', esSistema: true },
      }));

    const permisos = await prisma.permission.findMany({
      where: { codigo: { in: CATALOGO_PERMISOS.map((p) => p.codigo) } },
    });
    // `skipDuplicates` evita depender del nombre de la clave compuesta.
    await prisma.rolePermission.createMany({
      data: permisos.map((p) => ({ roleId: rol.id, permissionId: p.id })),
      skipDuplicates: true,
    });

    // ---- Usuario dueño + membresía -------------------------------------------
    const { hashPassword } = await import('../src/core/auth/passwords.js');
    const existente = await prisma.user.findUnique({ where: { email } });
    const usuario =
      existente ??
      (await prisma.user.create({
        data: {
          email,
          passwordHash: await hashPassword(password),
          passwordAlgo: 'argon2id',
          nombre: 'Dueño Demo',
        },
      }));

    const membresia = await prisma.membership.findFirst({
      where: { tenantId: tenant.id, userId: usuario.id },
    });
    if (!membresia) {
      await prisma.membership.create({
        data: { tenantId: tenant.id, userId: usuario.id, roleId: rol.id, sedeId: sede.id },
      });
    }

    // ---- Suscripción (es lo que da features al tenant) -----------------------
    const ahora = new Date();
    const enUnMes = new Date(ahora);
    enUnMes.setMonth(enUnMes.getMonth() + 1);
    await prisma.subscription.upsert({
      where: { tenantId: tenant.id },
      update: { planId: plan.id, estado: 'ACTIVE' },
      create: {
        tenantId: tenant.id,
        planId: plan.id,
        estado: 'ACTIVE',
        periodoInicio: ahora,
        periodoFin: enUnMes,
      },
    });

    // ---- Datos de ejemplo ----------------------------------------------------
    for (const p of PACIENTES_DEMO) {
      const yaEsta = await prisma.paciente.findFirst({
        where: { tenantId: tenant.id, tipoDoc: p.tipoDoc, numDoc: p.numDoc },
      });
      if (!yaEsta) {
        await prisma.paciente.create({
          data: {
            tenantId: tenant.id,
            tipoDoc: p.tipoDoc,
            numDoc: p.numDoc,
            nombres: p.nombres,
            apellidos: p.apellidos,
            fechaNac: new Date(`${p.fechaNac}T00:00:00.000Z`),
            sexo: p.sexo,
            telefono: p.telefono,
            email: p.email ?? null,
            alergias: p.alergias ?? null,
          },
        });
      }
    }

    const tratamientos: string[] = [];
    for (const t of TRATAMIENTOS_DEMO) {
      const yaEsta = await prisma.tratamiento.findFirst({
        where: { tenantId: tenant.id, nombre: t.nombre },
      });
      const guardado =
        yaEsta ??
        (await prisma.tratamiento.create({
          data: {
            tenantId: tenant.id,
            nombre: t.nombre,
            precio: t.precio,
            duracionMin: t.duracionMin,
          },
        }));
      tratamientos.push(guardado.id);
    }

    const pacientes = await prisma.paciente.findMany({
      where: { tenantId: tenant.id, deletedAt: null },
      orderBy: { numDoc: 'asc' },
      take: 3,
    });
    const dia = proximoDiaHabil();
    const fechaCita = new Date(`${dia}T00:00:00.000Z`);
    const citasDemo = [
      { token: 'CIT-DEMO0001', horaInicio: '10:00', horaFin: '10:30', estado: 'confirmada' },
      { token: 'CIT-DEMO0002', horaInicio: '11:00', horaFin: '11:45', estado: 'pendiente' },
    ] as const;
    for (let i = 0; i < citasDemo.length; i++) {
      const c = citasDemo[i];
      const paciente = pacientes[i];
      if (!paciente) break;
      const yaEsta = await prisma.cita.findFirst({ where: { tenantId: tenant.id, token: c.token } });
      if (!yaEsta) {
        await prisma.cita.create({
          data: {
            tenantId: tenant.id,
            token: c.token,
            pacienteId: paciente.id,
            tratamientoId: tratamientos[i] ?? null,
            sedeId: sede.id,
            fecha: fechaCita,
            horaInicio: c.horaInicio,
            horaFin: c.horaFin,
            estado: c.estado,
            observacion: 'Cita de ejemplo creada por el seed de demostración',
          },
        });
      }
    }

    // ---- Resumen -------------------------------------------------------------
    console.log('\n  Entorno de demostración listo.\n');
    console.log(`  Clínica    : Clínica Demo (slug: ${SLUG})`);
    console.log('  Entrar en  : http://localhost:5173/login');
    console.log(`  Correo     : ${email}`);
    console.log('  Contraseña : (la que pasaste en DEMO_OWNER_PASSWORD)');
    console.log(`\n  Citas de ejemplo: ${dia}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
