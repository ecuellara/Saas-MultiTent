/**
 * Ubigeo del paciente: el `ubigeoCodigo` es FK a `Ubigeo` pero el formulario lo
 * envía como texto libre y el catálogo está VACÍO. Sin validación previa,
 * Prisma responde P2003 y el filtro global devuelve «Referencia inválida» sin
 * explicar nada.
 *
 * Contrato: código desconocido → 400 con mensaje claro; sin código → guarda
 * bien; código existente → guarda bien.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

function cuerpo(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tipoDoc: 'DNI',
    numDoc: `UBG-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    nombres: 'Paciente',
    apellidos: 'Ubigeo',
    telefono: '999000111',
    ...extra,
  };
}

describe('Ubigeo del paciente', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let datos: DosTenants;
  let H: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);

    prisma = app.get(PrismaService);
    await limpiarDosTenants(prisma);
    datos = await seedDosTenants(prisma);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    H = { Authorization: `Bearer ${login.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      const db = prisma as unknown as { ubigeo: { deleteMany: (a: unknown) => Promise<unknown> } };
      await db.ubigeo.deleteMany({ where: { codigo: { startsWith: 'UBG-TEST-' } } });
      await limpiarDosTenants(prisma);
    }
    if (app) await app.close();
  });

  it('código desconocido → 400 con mensaje claro (no «Referencia inválida»)', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/pacientes')
      .set(H)
      .send(cuerpo({ ubigeoCodigo: 'UBIGEO-INEXISTENTE-XYZ' }))
      .expect(400);
    const texto = JSON.stringify(r.body);
    expect(texto).toContain('ubigeo');
    expect(texto).toContain('catálogo');
    expect(texto).not.toContain('Referencia inválida');
  });

  it('código desconocido en PATCH → 400 con el mismo mensaje', async () => {
    await request(app.getHttpServer())
      .patch(`/api/pacientes/${datos.a.pacienteId}`)
      .set(H)
      .send({ ubigeoCodigo: 'UBIGEO-INEXISTENTE-XYZ' })
      .expect(400)
      .expect((r) => {
        expect(JSON.stringify(r.body)).toContain('ubigeo');
      });
  });

  it('sin código guarda bien (201) y cadena vacía se vuelve null', async () => {
    await request(app.getHttpServer()).post('/api/pacientes').set(H).send(cuerpo()).expect(201);
    const r = await request(app.getHttpServer())
      .post('/api/pacientes')
      .set(H)
      .send(cuerpo({ ubigeoCodigo: '' }))
      .expect(201);
    expect(r.body.ubigeoCodigo).toBeNull();
  });

  it('código existente en el catálogo guarda bien', async () => {
    const db = prisma as unknown as { ubigeo: { create: (a: unknown) => Promise<unknown> } };
    await db.ubigeo.create({
      data: { codigo: 'UBG-TEST-150101', departamento: 'Lima', provincia: 'Lima', distrito: 'Lima' },
    });
    const r = await request(app.getHttpServer())
      .post('/api/pacientes')
      .set(H)
      .send(cuerpo({ ubigeoCodigo: 'UBG-TEST-150101' }))
      .expect(201);
    expect(r.body.ubigeoCodigo).toBe('UBG-TEST-150101');
  });

  it('el estado del catálogo dice si hay datos para el formulario', async () => {
    const r = await request(app.getHttpServer()).get('/api/ubigeos/estado').set(H).expect(200);
    expect(typeof r.body.total).toBe('number');
  });
});
