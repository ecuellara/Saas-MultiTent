-- Facturación SaaS (Fase 8, ADR-008)
-- CreateEnum
CREATE TYPE "EstadoCobro" AS ENUM ('pendiente', 'pagado', 'fallido', 'reembolsado');
-- CreateEnum
CREATE TYPE "EstadoWebhook" AS ENUM ('recibido', 'procesado', 'error');

-- CreateTable
CREATE TABLE "CobroSuscripcion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "proveedor" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'PEN',
    "estado" "EstadoCobro" NOT NULL DEFAULT 'pendiente',
    "claveIdempotencia" TEXT NOT NULL,
    "referenciaExterna" TEXT,
    "periodoInicio" TIMESTAMP(3) NOT NULL,
    "periodoFin" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CobroSuscripcion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CobroSuscripcion_claveIdempotencia_key" ON "CobroSuscripcion"("claveIdempotencia");
CREATE UNIQUE INDEX "CobroSuscripcion_referenciaExterna_key" ON "CobroSuscripcion"("referenciaExterna");
CREATE INDEX "CobroSuscripcion_tenantId_estado_idx" ON "CobroSuscripcion"("tenantId", "estado");

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "proveedor" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "estado" "EstadoWebhook" NOT NULL DEFAULT 'recibido',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");
CREATE INDEX "WebhookEvent_proveedor_estado_idx" ON "WebhookEvent"("proveedor", "estado");

-- AddForeignKey
ALTER TABLE "CobroSuscripcion" ADD CONSTRAINT "CobroSuscripcion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
