-- Interruptor de sede activa (pantalla /sedes): sin columna propia,
-- desactivar una sede obligaba a borrarla (o a esconderla por `deletedAt`,
-- que la sacaba del listado y la dejaba sin estado visible).
ALTER TABLE "Sede" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
