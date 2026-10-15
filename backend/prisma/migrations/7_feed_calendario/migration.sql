-- Feed ICS suscribible (sin OAuth): un token secreto por feed da acceso de
-- solo lectura a la agenda de SU clínica. Sin datos que conservar (tabla nueva).
CREATE TABLE "FeedCalendario" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sedeId" TEXT,
  "dentistaId" TEXT,
  "token" TEXT NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeedCalendario_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeedCalendario_token_key" ON "FeedCalendario"("token");
CREATE INDEX "FeedCalendario_tenantId_activo_idx" ON "FeedCalendario"("tenantId", "activo");

ALTER TABLE "FeedCalendario" ADD CONSTRAINT "FeedCalendario_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
