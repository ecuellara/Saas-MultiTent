/**
 * Seed idempotente del SaaS (bloqueador #2: sin contraseñas por defecto).
 *
 * Crea/actualiza: catálogo de `Permission`, planes `consultorio`/`clinica`
 * con sus features, y el `PlatformUser` owner.
 *
 * Requiere (falla si faltan, nunca usa defaults):
 *   PLATFORM_OWNER_EMAIL, PLATFORM_OWNER_PASSWORD (mín. 12 caracteres)
 *
 * Uso: `npm run db:seed`
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { CATALOGO_PERMISOS, PLANES_BASE } from './seed-data.js';

async function main(): Promise<void> {
  const email = process.env.PLATFORM_OWNER_EMAIL;
  const password = process.env.PLATFORM_OWNER_PASSWORD;
  if (!email || !password) {
    throw new Error('Faltan PLATFORM_OWNER_EMAIL / PLATFORM_OWNER_PASSWORD (sin defaults)');
  }
  if (password.length < 12) {
    throw new Error('PLATFORM_OWNER_PASSWORD debe tener al menos 12 caracteres');
  }
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    for (const p of CATALOGO_PERMISOS) {
      await prisma.permission.upsert({
        where: { codigo: p.codigo },
        update: { recurso: p.recurso, accion: p.accion },
        create: { id: `perm-${p.codigo}`, ...p },
      });
    }
    for (const plan of PLANES_BASE) {
      const guardado = await prisma.plan.upsert({
        where: { codigo: plan.codigo },
        update: { nombre: plan.nombre, descripcion: plan.descripcion, precioMensual: plan.precioMensual },
        create: {
          codigo: plan.codigo,
          nombre: plan.nombre,
          descripcion: plan.descripcion,
          precioMensual: plan.precioMensual,
        },
      });
      for (const f of plan.features) {
        await prisma.planFeature.upsert({
          where: { planId_clave: { planId: guardado.id, clave: f.clave } },
          update: { habilitado: f.habilitado, limite: f.limite },
          create: { planId: guardado.id, clave: f.clave, habilitado: f.habilitado, limite: f.limite },
        });
      }
    }
    const existente = await prisma.platformUser.findUnique({ where: { email } });
    if (!existente) {
      const { hashPassword } = await import('../src/core/auth/passwords.js');
      await prisma.platformUser.create({
        data: { email, passwordHash: await hashPassword(password), passwordAlgo: 'argon2id', nombre: 'Owner plataforma', rol: 'owner' },
      });
      console.log(`PlatformUser owner creado: ${email}`);
    } else {
      console.log(`PlatformUser ya existe: ${email} (sin cambios)`);
    }
    console.log('Seed OK');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
