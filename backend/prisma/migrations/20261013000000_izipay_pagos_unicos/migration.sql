CREATE TABLE "IntentoIzipay" (
 "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL UNIQUE,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
 "pagoId" TEXT NOT NULL REFERENCES "Pago"("id") ON DELETE CASCADE,
 "usuarioId" TEXT NOT NULL, "importeCentimos" BIGINT NOT NULL,
 "moneda" TEXT NOT NULL DEFAULT 'PEN', "metadata" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "IntentoIzipay_tenantId_pagoId_idx" ON "IntentoIzipay"("tenantId", "pagoId");
CREATE TABLE "EventoIzipay" (
 "id" TEXT PRIMARY KEY, "claveIdempotencia" TEXT NOT NULL UNIQUE,
 "orderId" TEXT NOT NULL, "transaccionId" TEXT NOT NULL, "tenantId" TEXT,
 "estadoProveedor" TEXT NOT NULL, "importeCentimos" BIGINT NOT NULL,
 "moneda" TEXT NOT NULL, "rawAnswer" TEXT NOT NULL, "firmaValida" BOOLEAN NOT NULL,
 "estado" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EventoIzipay_orderId_idx" ON "EventoIzipay"("orderId");
