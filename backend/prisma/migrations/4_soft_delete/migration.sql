-- Soft delete uniforme: Role.deletedAt (el borrado físico queda fuera de la API)
ALTER TABLE "Role" ADD COLUMN "deletedAt" TIMESTAMP(3);
