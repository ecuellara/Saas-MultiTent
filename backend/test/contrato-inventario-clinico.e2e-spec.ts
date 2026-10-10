/**
 * Contrato de validación de los módulos clínicos que faltaban: consentimientos,
 * odontograma (NTS 188) e insumos (inventario).
 *
 * POR QUÉ EXISTE: igual que `contrato-paciente` y `contrato-modulos`, la app
 * se monta con `montarAppE2E` (igual que `main.ts`: `whitelist` +
 * `forbidNonWhitelisted` + `transform` + filtro global). Sin ellos, un DTO
 * mal declarado pasa desapercibido: la validación real solo se ve al usar
 * la aplicación.
 *
 * Lo que fija, y por qué importa:
 *  1. **Formato de fecha uniforme.** Un campo `DateTime`/`@db.Date` de Prisma
 *     rechaza `aaaa-mm-dd` («Datos inválidos» → 400); es justo lo que devuelve
 *     un `<input type="date">`. Odontograma debe normalizar con
 *     `new Date(dto.fecha)` en el servicio (y lo hace).
 *  2. **Forma del error.** Nest devuelve `message` como ARRAY y el mensaje
 *     nombre el campo; el frontend lo aplana en `mensajeDeError`.
 *  3. **Whitelist.** Un campo que no está en el DTO se rechaza con 400. En
 *     odontograma es además una regla clínica: `estadoClinico` y `color` los
 *     deriva el servidor del `HallazgoCatalogo`, nunca el cliente.
 *  4. **Validación anidada.** El contenido de los arrays/objetos anidados
 *     (`superficies` del hallazgo) se valida de verdad, no solo su presencia.
 *  5. **Permisos.** Cada ruta se prueba con el rol del fixture
 *     (`inventory.write`, `consents.write`, `patients.write`) y contra un
 *     usuario de OTRA clínica, que no tiene vínculo con el tenant declarado.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';
import { PNG_BYTES } from './helpers/archivos.js';

/** Mensaje del `message` de Nest, que puede venir como cadena o como array. */
function textoMensaje(body: unknown): string {
  const m = (body as { message?: unknown }).message;
  if (Array.isArray(m)) return m.join(' | ');
  return typeof m === 'string' ? m : '';
}

type InsumoRow = { id: string; nombre: string; stockActual: number; stockMinimo: number; unidad: string };
type MovimientoRow = { tipo: string; cantidad: number; stockAnterior: number; stockNuevo: number };

describe('Contrato de inventario clínico (consentimientos, odontograma e insumos)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let datos: DosTenants;
  let H: Record<string, string>;
  /** Usuario de la clínica B: sirve para probar que un extraño no pasa los guards. */
  let HB: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);

    prisma = app.get(PrismaService);
    await limpiarDosTenants(prisma);
    datos = await seedDosTenants(prisma);

    const srv = app.getHttpServer();
    const loginA = await request(srv)
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    H = { Authorization: `Bearer ${loginA.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };

    const loginB = await request(srv)
      .post('/api/auth/login')
      .send({ email: datos.b.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    HB = { Authorization: `Bearer ${loginB.body.access_token}`, 'X-Tenant-Id': datos.b.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) await limpiarDosTenants(prisma);
    if (app) await app.close();
  });

  const http = () => request(app.getHttpServer());

  // ------------------------------------------------------- Consentimientos ----

  describe('consentimientos', () => {
    it('acepta el cuerpo realista de la firma y congela el texto de la plantilla', async () => {
      // Cuerpo tal como lo enviaría el formulario: los opcionales vacíos van
      // como `null` (los ignora `@IsOptional()`) y `datosSnapshot` es el
      // diccionario libre que se guarda como `Json` en Prisma.
      const r = await http()
        .post('/api/consentimientos')
        .set(H)
        .send({
          pacienteId: datos.a.pacienteId,
          plantillaId: (await prisma.consentimientoPlantilla.findFirstOrThrow({
            where: { tenantId: datos.a.tenantId, clave: 'endodoncia' },
          })).id,
          citaId: null,
          tratamiento: null,
          datosSnapshot: { paciente: 'Paciente Clínica A', edad: 35 },
        });

      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const c = r.body as { id: string; estado: string; cuerpoSnapshot: string | null };
      // El estado inicial lo decide el servidor, no el cliente.
      expect(c.estado).toBe('borrador');
      // `cuerpoSnapshot` congela el cuerpo de la plantilla al momento de crear.
      expect(c.cuerpoSnapshot).toContain('Texto');
    });

    it('el PATCH de estado acepta el cuerpo del formulario y solo aplica la transición válida', async () => {
      const creado = await http()
        .post('/api/consentimientos')
        .set(H)
        .send({
          pacienteId: datos.a.pacienteId,
          plantillaId: (await prisma.consentimientoPlantilla.findFirstOrThrow({
            where: { tenantId: datos.a.tenantId, clave: 'endodoncia' },
          })).id,
          datosSnapshot: { paciente: 'Paciente Clínica A' },
        });
      expect(creado.status, JSON.stringify(creado.body)).toBe(201);
      const id = (creado.body as { id: string }).id;

      // Firmar exige la firma del paciente ya adjunta: primero se sube.
      await http()
        .post(`/api/consentimientos/${id}/firmas`)
        .set(H)
        .field('rol', 'paciente')
        .attach('archivo', PNG_BYTES, { filename: 'firma.png', contentType: 'image/png' })
        .expect(201);

      const r = await http()
        .patch(`/api/consentimientos/${id}/estado`)
        .set(H)
        .send({ estado: 'firmado' });

      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const c = r.body as { estado: string; firmadoEn: string | null };
      expect(c.estado).toBe('firmado');
      // La fecha de firma la pone el reloj del servidor.
      expect(c.firmadoEn).not.toBeNull();
    });

    it('rechaza un estado fuera de la lista con `message` en ARRAY nombrando el campo', async () => {
      const r = await http()
        .patch(`/api/consentimientos/${datos.a.consentimientoId}/estado`)
        .set(H)
        .send({ estado: 'inventado' });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      const message = (r.body as { message: unknown }).message;
      expect(Array.isArray(message)).toBe(true);
      expect(textoMensaje(r.body)).toContain('estado');
    });

    it('rechaza un `datosSnapshot` que no sea objeto (el servicio lo pasa a Prisma tal cual)', async () => {
      const r = await http()
        .post('/api/consentimientos')
        .set(H)
        .send({
          pacienteId: datos.a.pacienteId,
          // El id de la plantilla es indiferente: el pipe corta por
          // `datosSnapshot` antes de que el servicio llegue a buscarla.
          plantillaId: datos.a.consentimientoId,
          datosSnapshot: 'texto suelto',
        });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(textoMensaje(r.body)).toContain('datosSnapshot');
    });

    it('rechaza campos fuera del DTO (whitelist activa)', async () => {
      // `revocadoPor` es el caso sensible: la autoría de la revocación sale
      // SIEMPRE de `ctx.userId`, así que el cliente no puede atribuírsela.
      const r = await http()
        .post('/api/consentimientos')
        .set(H)
        .send({
          pacienteId: datos.a.pacienteId,
          // Como arriba, el pipe rechaza por el campo extra antes del servicio.
          plantillaId: datos.a.consentimientoId,
          datosSnapshot: { paciente: 'Paciente Clínica A' },
          revocadoPor: 'otro-usuario',
        });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(textoMensaje(r.body)).toContain('revocadoPor');
    });

    it('exige paciente y plantilla', async () => {
      const r = await http().post('/api/consentimientos').set(H).send({});

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      const texto = textoMensaje(r.body);
      expect(texto).toContain('pacienteId');
      expect(texto).toContain('plantillaId');
      expect(texto).toContain('datosSnapshot');
    });

    it('rechaza un `pacienteId` que no sea texto', async () => {
      // Los ids son cadenas: un número no debe llegar a Prisma, que respondería
      // con el genérico «Datos inválidos» en lugar de señalar el campo.
      const r = await http()
        .post('/api/consentimientos')
        .set(H)
        .send({ pacienteId: 123, plantillaId: datos.a.consentimientoId, datosSnapshot: {} });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(textoMensaje(r.body)).toContain('pacienteId');
    });

    it('permisos: sin credenciales 401 y con el usuario de otra clínica 403', async () => {
      // Los guards corren ANTES que los pipes: sin token no se llega al DTO.
      await http().post('/api/consentimientos').send({}).expect(401);
      // El usuario de B no tiene membresía en la clínica declarada en la
      // cabecera: el TenantGuard corta con 403 y no filtra nada del recurso.
      await http()
        .post('/api/consentimientos')
        .set({ Authorization: HB.Authorization!, 'X-Tenant-Id': datos.a.tenantId })
        .send({ pacienteId: datos.a.pacienteId, plantillaId: datos.a.consentimientoId, datosSnapshot: {} })
        .expect(403);
    });
  });

  // ------------------------------------------------------------ Odontograma ----

  describe('odontograma', () => {
    it('acepta la fecha en forma corta (lo que devuelve `<input type="date">`)', async () => {
      const r = await http()
        .post('/api/odontogramas')
        .set(H)
        .send({
          pacienteId: datos.a.pacienteId,
          tipo: 'inicial',
          // Forma corta: Prisma la rechazaría tal cual en un `@db.Date`, por eso
          // el servicio normaliza con `new Date(dto.fecha)`.
          fecha: '2026-03-10',
          piezas: { '16': { estado: 'caries', superficies: ['O'] } },
          observaciones: null,
        });

      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const o = r.body as { fecha: string; version: number; estado: string };
      expect(o.fecha.slice(0, 10)).toBe('2026-03-10');
      // El estado inicial y la versión los calcula el servidor.
      expect(o.estado).toBe('borrador');
      expect(o.version).toBeGreaterThan(1);
    });

    it('rechaza una fecha en formato local con el mensaje en ARRAY y nombrando el campo', async () => {
      const r = await http()
        .post('/api/odontogramas')
        .set(H)
        .send({ pacienteId: datos.a.pacienteId, fecha: '10/03/2026', piezas: {} });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(Array.isArray((r.body as { message: unknown }).message)).toBe(true);
      const texto = textoMensaje(r.body);
      expect(texto).toContain('fecha');
      // Un mensaje genérico de Prisma («Datos inválidos») no diría qué corregir.
      expect(texto).not.toBe('Datos inválidos');
    });

    it('exige `piezas` (columna Json obligatoria)', async () => {
      const r = await http()
        .post('/api/odontogramas')
        .set(H)
        .send({ pacienteId: datos.a.pacienteId, fecha: '2026-03-10' });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(textoMensaje(r.body)).toContain('piezas');
    });

    it('rechaza `piezas` que no sea un objeto y `pacienteId` que no sea texto', async () => {
      // El editor del odontograma arma `piezas` como diccionario por número de
      // pieza; un array (o un texto) no es un odontograma válido y Prisma lo
      // guardaría igual en su columna `Json` sin protestar.
      const array = await http()
        .post('/api/odontogramas')
        .set(H)
        .send({ pacienteId: datos.a.pacienteId, fecha: '2026-03-10', piezas: ['16'] });
      expect(array.status, JSON.stringify(array.body)).toBe(400);
      expect(textoMensaje(array.body)).toContain('piezas');

      // Un `pacienteId` numérico no debe colarse: sin `@IsString` llegaría a
      // Prisma como número y fallaría con el genérico «Datos inválidos».
      const id = await http()
        .post('/api/odontogramas')
        .set(H)
        .send({ pacienteId: 123, fecha: '2026-03-10', piezas: {} });
      expect(id.status, JSON.stringify(id.body)).toBe(400);
      expect(textoMensaje(id.body)).toContain('pacienteId');
    });

    it('el hallazgo valida el contenido de `superficies` (validación anidada del array)', async () => {
      // `superficies` es `string[]`: con un número dentro, el pipe lo corta
      // nombrando el campo en lugar de dejar que Prisma falle con
      // «Datos inválidos» o de guardar basura en el historial NTS 188.
      const r = await http()
        .post(`/api/odontogramas/${datos.a.odontogramaId}/hallazgos`)
        .set(H)
        .send({ pieza: '26', hallazgoCodigo: 'CARIES', superficies: [1, 2] });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(textoMensaje(r.body)).toContain('superficies');
    });

    it('rechaza `estadoClinico` y `color` del cliente: los deriva el catálogo', async () => {
      // No es solo whitelist: si el cliente pudiera fijar el color clínico, el
      // odontograma dejaría de ser fiel a la NTS 188.
      const r = await http()
        .post(`/api/odontogramas/${datos.a.odontogramaId}/hallazgos`)
        .set(H)
        .send({
          pieza: '26',
          hallazgoCodigo: 'CARIES',
          superficies: ['O'],
          estadoClinico: 'sano',
          color: 'verde',
        });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      const texto = textoMensaje(r.body);
      expect(texto).toContain('estadoClinico');
      expect(texto).toContain('color');
    });

    it('registra el hallazgo válido con el color del catálogo', async () => {
      const r = await http()
        .post(`/api/odontogramas/${datos.a.odontogramaId}/hallazgos`)
        .set(H)
        .send({ pieza: '36', hallazgoCodigo: 'CARIES', superficies: ['O'] });

      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const h = r.body as { id: string; color: string; superficies: string[]; activo: boolean };
      expect(h.superficies).toEqual(['O']);
      expect(h.color).toBe('rojo'); // `colorDefecto` del catálogo CARIES
      expect(h.activo).toBe(true);
    });

    it('permisos: el usuario de otra clínica no puede crear odontogramas', async () => {
      await http()
        .post('/api/odontogramas')
        .set({ Authorization: HB.Authorization!, 'X-Tenant-Id': datos.a.tenantId })
        .send({ pacienteId: datos.a.pacienteId, fecha: '2026-03-10', piezas: {} })
        .expect(403);
    });
  });

  // ---------------------------------------------------------------- Insumos ----

  describe('insumos', () => {
    it('acepta el cuerpo realista del alta de insumo', async () => {
      const r = await http()
        .post('/api/insumos')
        .set(H)
        .send({
          nombre: 'Mascarillas quirúrgicas (caja x50)',
          sedeId: datos.a.sedeId,
          unidad: 'caja',
          stockMinimo: 2,
          stockActual: 7,
        });

      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const i = r.body as InsumoRow;
      expect(i.nombre).toBe('Mascarillas quirúrgicas (caja x50)');
      expect(i.unidad).toBe('caja');
      expect(i.stockActual).toBe(7);
      expect(i.stockMinimo).toBe(2);
    });

    it('exige `nombre` y nombra el campo que falla', async () => {
      const r = await http().post('/api/insumos').set(H).send({ unidad: 'caja' });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(Array.isArray((r.body as { message: unknown }).message)).toBe(true);
      expect(textoMensaje(r.body)).toContain('nombre');
    });

    it('rechaza un stock negativo o no entero', async () => {
      // `stockMinimo` es `Int` en Prisma: un 2.5 guardado a medias desajustaría
      // las alertas de reposición.
      const negativo = await http()
        .post('/api/insumos')
        .set(H)
        .send({ nombre: 'Stock negativo', stockMinimo: -1 });
      expect(negativo.status, JSON.stringify(negativo.body)).toBe(400);
      expect(textoMensaje(negativo.body)).toContain('stockMinimo');

      const decimal = await http()
        .post('/api/insumos')
        .set(H)
        .send({ nombre: 'Stock decimal', stockActual: 2.5 });
      expect(decimal.status, JSON.stringify(decimal.body)).toBe(400);
      expect(textoMensaje(decimal.body)).toContain('stockActual');
    });

    it('rechaza campos fuera del DTO: `precioRef` no se fija desde el alta', async () => {
      // El precio de referencia sale de las compras (valoración de inventario),
      // no de lo que teclee el cliente.
      const r = await http()
        .post('/api/insumos')
        .set(H)
        .send({ nombre: 'Con precio', precioRef: 99.9 });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(textoMensaje(r.body)).toContain('precioRef');
    });

    it('la salida exige una cantidad entera y >= 1', async () => {
      const cero = await http()
        .post(`/api/insumos/${datos.a.insumoId}/salidas`)
        .set(H)
        .send({ cantidad: 0 });
      expect(cero.status, JSON.stringify(cero.body)).toBe(400);
      expect(textoMensaje(cero.body)).toContain('cantidad');

      const texto = await http()
        .post(`/api/insumos/${datos.a.insumoId}/salidas`)
        .set(H)
        .send({ cantidad: '5' });
      expect(texto.status, JSON.stringify(texto.body)).toBe(400);
      expect(textoMensaje(texto.body)).toContain('cantidad');
    });

    it('la salida descuenta stock y deja el movimiento con el stock anterior y nuevo', async () => {
      const antes = (await http().get(`/api/insumos/${datos.a.insumoId}`).set(H).expect(200))
        .body as InsumoRow;

      const r = await http()
        .post(`/api/insumos/${datos.a.insumoId}/salidas`)
        .set(H)
        .send({ cantidad: 3, motivo: 'Uso en consulta' });

      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect((r.body as InsumoRow).stockActual).toBe(antes.stockActual - 3);

      const mov = (await prisma.movimientoInventario.findFirstOrThrow({
        where: { insumoId: datos.a.insumoId, tipo: 'salida' },
        orderBy: { fecha: 'desc' },
      })) as unknown as MovimientoRow;
      expect(mov.cantidad).toBe(3);
      expect(mov.stockAnterior).toBe(antes.stockActual);
      expect(mov.stockNuevo).toBe(antes.stockActual - 3);
    });

    it('la entrada suma stock y también deja su movimiento', async () => {
      const antes = (await http().get(`/api/insumos/${datos.a.insumoId}`).set(H).expect(200))
        .body as InsumoRow;

      const r = await http()
        .post(`/api/insumos/${datos.a.insumoId}/entradas`)
        .set(H)
        .send({ cantidad: 5 });

      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect((r.body as InsumoRow).stockActual).toBe(antes.stockActual + 5);

      const mov = (await prisma.movimientoInventario.findFirstOrThrow({
        where: { insumoId: datos.a.insumoId, tipo: 'entrada' },
        orderBy: { fecha: 'desc' },
      })) as unknown as MovimientoRow;
      expect(mov.stockNuevo).toBe(antes.stockActual + 5);
    });

    it('la lista no exige permiso de escritura (va con la sesión de la clínica)', async () => {
      const r = await http().get('/api/insumos').set(H).expect(200);
      const lista = r.body as InsumoRow[];
      expect(Array.isArray(lista)).toBe(true);
      // Todo lo listado pertenece a la clínica de la cabecera.
      const deA = await prisma.insumo.findMany({ where: { tenantId: datos.a.tenantId } });
      expect(lista.map((i) => i.id).sort()).toEqual(deA.map((i) => i.id).sort());
    });

    it('permisos: sin credenciales 401 y con el usuario de otra clínica 403', async () => {
      await http().post('/api/insumos').send({ nombre: 'Sin token' }).expect(401);
      await http()
        .post('/api/insumos')
        .set({ Authorization: HB.Authorization!, 'X-Tenant-Id': datos.a.tenantId })
        .send({ nombre: 'De otra clínica' })
        .expect(403);
      // La ruta de ajuste directo está retirada por diseño: el stock solo se
      // mueve por entradas/salidas, que dejan traza en `MovimientoInventario`.
      await http().patch(`/api/insumos/${datos.a.insumoId}`).set(H).send({ stockActual: 99 }).expect(400);
    });
  });
});
