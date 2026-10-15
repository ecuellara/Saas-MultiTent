-- Se elimina el ubigeo del paciente.
--
-- Era una columna heredada del DDL del proyecto antiguo: se planificó (aparecía
-- como característica en la especificación) pero nunca se cargó el catálogo ni
-- se usó para nada. Como el formulario lo enviaba como texto libre contra una
-- clave foránea, cualquier código producía P2003 y el filtro global respondía
-- «Referencia inválida» sin explicar nada. Pasó en el sistema antiguo y volvió a
-- pasar aquí, así que se retira la funcionalidad completa.
--
-- Sin datos que conservar (despliegue de pruebas, sin clientes reales).
-- `IF EXISTS` en ambas sentencias: la migración no debe fallar por el nombre de
-- la restricción en una base creada con otra versión de las migraciones.
--
-- La tabla `Ubigeo` SE CONSERVA: es el catálogo oficial del Perú
-- (departamento/provincia/distrito), está vacía y es su sitio natural si algún
-- día se quiere un selector de distrito. No hay que migrar nada para usarla.

ALTER TABLE "Paciente" DROP CONSTRAINT IF EXISTS "Paciente_ubigeoCodigo_fkey";
ALTER TABLE "Paciente" DROP COLUMN IF EXISTS "ubigeoCodigo";
