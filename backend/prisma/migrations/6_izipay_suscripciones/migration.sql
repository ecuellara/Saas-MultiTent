-- Izipay pasa a cobrar SUSCRIPCIONES (etapa 1 = plan de la clínica).
-- Sin datos que conservar (solo intentos/eventos de prueba): se vacía
-- IntentoIzipay para poder exigir cobroSuscripcionId NOT NULL desde el día uno.
DELETE FROM "IntentoIzipay";

ALTER TABLE "IntentoIzipay" DROP CONSTRAINT "IntentoIzipay_pagoId_fkey";
ALTER TABLE "IntentoIzipay" DROP COLUMN "pagoId";
ALTER TABLE "IntentoIzipay" ADD COLUMN "cobroSuscripcionId" TEXT NOT NULL;
ALTER TABLE "EventoIzipay" ADD COLUMN "cobroSuscripcionId" TEXT;

-- NOTA: no hay DROP INDEX de tenantId_pagoId: PostgreSQL ya lo eliminó
-- automáticamente con el DROP COLUMN (índice dependiente).
CREATE INDEX "IntentoIzipay_tenantId_cobroSuscripcionId_idx" ON "IntentoIzipay"("tenantId", "cobroSuscripcionId");
CREATE INDEX "EventoIzipay_cobroSuscripcionId_idx" ON "EventoIzipay"("cobroSuscripcionId");

ALTER TABLE "IntentoIzipay" ADD CONSTRAINT "IntentoIzipay_cobroSuscripcionId_fkey" FOREIGN KEY ("cobroSuscripcionId") REFERENCES "CobroSuscripcion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventoIzipay" ADD CONSTRAINT "EventoIzipay_cobroSuscripcionId_fkey" FOREIGN KEY ("cobroSuscripcionId") REFERENCES "CobroSuscripcion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
