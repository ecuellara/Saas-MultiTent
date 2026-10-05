-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EstadoSuscripcion" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('pendiente', 'confirmada', 'recordatorio_enviado', 'reprogramada', 'cancelada', 'realizada', 'no_asistio');

-- CreateEnum
CREATE TYPE "EstadoConsentimiento" AS ENUM ('borrador', 'firmado', 'revocado', 'anulado');

-- CreateEnum
CREATE TYPE "TipoPago" AS ENUM ('ingreso', 'egreso');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('pendiente', 'parcial', 'pagado', 'anulado');

-- CreateEnum
CREATE TYPE "EstadoCuota" AS ENUM ('pendiente', 'pagada', 'vencida');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('entrada', 'salida', 'ajuste');

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "precioMensual" DECIMAL(10,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'PEN',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanFeature" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "limite" INTEGER,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "estado" "EstadoSuscripcion" NOT NULL DEFAULT 'TRIAL',
    "iniciadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodoInicio" TIMESTAMP(3) NOT NULL,
    "periodoFin" TIMESTAMP(3) NOT NULL,
    "canceladaEn" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" TEXT NOT NULL DEFAULT 'soporte',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "recursoId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "razonSocial" TEXT,
    "estado" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sede" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "telefono" TEXT,
    "esPrincipal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Sede_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "sedeId" TEXT,
    "estado" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "esSistema" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "descripcion" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Ubigeo" (
    "codigo" TEXT NOT NULL,
    "departamento" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "distrito" TEXT NOT NULL,

    CONSTRAINT "Ubigeo_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "Paciente" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tipoDoc" TEXT NOT NULL DEFAULT 'DNI',
    "numDoc" TEXT,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "fechaNac" TIMESTAMP(3),
    "sexo" TEXT,
    "grupoSanguineo" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "direccion" TEXT,
    "ubigeoCodigo" TEXT,
    "contactoEmergenciaNombre" TEXT,
    "contactoEmergenciaTelefono" TEXT,
    "representanteNombre" TEXT,
    "representanteDni" TEXT,
    "representanteDomicilio" TEXT,
    "representanteParentesco" TEXT,
    "alergias" TEXT,
    "enfermedades" TEXT,
    "medicamentos" TEXT,
    "habitos" TEXT,
    "antecedentes" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoPaciente" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "nombreArchivo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "tamanioKb" INTEGER,
    "storageKey" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentoPaciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Especialidad" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Especialidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tratamiento" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "especialidadId" TEXT,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "precio" DECIMAL(10,2) NOT NULL,
    "duracionMin" INTEGER NOT NULL DEFAULT 30,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tratamiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cita" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "tratamientoId" TEXT,
    "sedeId" TEXT,
    "dentistaId" TEXT,
    "fecha" DATE NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "estado" "EstadoCita" NOT NULL DEFAULT 'pendiente',
    "observacion" TEXT,
    "recordatorioEnviadoEn" TIMESTAMP(3),
    "googleEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Cita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistorialClinico" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "citaId" TEXT,
    "fecha" DATE NOT NULL,
    "hora" TEXT,
    "motivo" TEXT NOT NULL,
    "sintomas" TEXT,
    "diagnostico" TEXT,
    "tratamientoRealizado" TEXT,
    "prescripcion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistorialClinico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Odontograma" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'inicial',
    "version" INTEGER NOT NULL DEFAULT 1,
    "estado" TEXT NOT NULL DEFAULT 'borrador',
    "piezas" JSONB NOT NULL,
    "observaciones" TEXT,
    "fecha" DATE NOT NULL,
    "firmadoPor" TEXT,
    "firmadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Odontograma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HallazgoCatalogo" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "abreviatura" TEXT NOT NULL,
    "alcance" TEXT NOT NULL,
    "requiereSuperficie" BOOLEAN NOT NULL DEFAULT false,
    "requiereMaterial" BOOLEAN NOT NULL DEFAULT false,
    "colorDefecto" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "HallazgoCatalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OdontogramaHallazgo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "odontogramaId" TEXT NOT NULL,
    "pieza" TEXT NOT NULL,
    "piezas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hallazgoCodigo" TEXT NOT NULL,
    "superficies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estadoClinico" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "material" TEXT,
    "tipoDetalle" TEXT,
    "especificaciones" TEXT,
    "tratamientoId" TEXT,
    "citaId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OdontogramaHallazgo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OdontogramaEvento" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "odontogramaId" TEXT NOT NULL,
    "pieza" TEXT NOT NULL,
    "estadoAnterior" TEXT,
    "estadoNuevo" TEXT NOT NULL,
    "tratamientoId" TEXT,
    "citaId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacion" TEXT,

    CONSTRAINT "OdontogramaEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentimientoPlantilla" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL DEFAULT '',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentimientoPlantilla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentimientoFirmado" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "plantillaId" TEXT NOT NULL,
    "citaId" TEXT,
    "tratamiento" TEXT,
    "datosSnapshot" JSONB NOT NULL,
    "cuerpoSnapshot" TEXT,
    "firmaPacienteKey" TEXT,
    "firmaOdontologoKey" TEXT,
    "pdfKey" TEXT,
    "estado" "EstadoConsentimiento" NOT NULL DEFAULT 'borrador',
    "firmadoEn" TIMESTAMP(3),
    "revocadoEn" TIMESTAMP(3),
    "revocadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentimientoFirmado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailGoogle" TEXT,
    "refreshToken" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "conectadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pago" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "codigoRecibo" TEXT NOT NULL,
    "tipo" "TipoPago" NOT NULL,
    "pacienteId" TEXT,
    "citaId" TEXT,
    "concepto" TEXT NOT NULL,
    "montoTotal" DECIMAL(10,2) NOT NULL,
    "montoPagado" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "saldo" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "metodoPago" TEXT,
    "estado" "EstadoPago" NOT NULL DEFAULT 'pendiente',
    "referenciaTipo" TEXT,
    "referenciaId" TEXT,
    "fecha" DATE NOT NULL,
    "observacion" TEXT,
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagoDetalle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pagoId" TEXT NOT NULL,
    "tratamientoId" TEXT,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "precioUnit" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "PagoDetalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cuota" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pagoId" TEXT NOT NULL,
    "nroCuota" INTEGER NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "fechaVencimiento" DATE NOT NULL,
    "fechaPago" DATE,
    "metodoPago" TEXT,
    "estado" "EstadoCuota" NOT NULL DEFAULT 'pendiente',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proveedor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ruc" TEXT,
    "nombre" TEXT NOT NULL,
    "contacto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "direccion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insumo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "unidad" TEXT NOT NULL DEFAULT 'und',
    "stockActual" INTEGER NOT NULL DEFAULT 0,
    "stockMinimo" INTEGER NOT NULL DEFAULT 0,
    "precioRef" DECIMAL(10,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Insumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoInventario" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "tipo" "TipoMovimiento" NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "stockAnterior" INTEGER NOT NULL,
    "stockNuevo" INTEGER NOT NULL,
    "motivo" TEXT,
    "referenciaTipo" TEXT,
    "referenciaId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT,

    CONSTRAINT "MovimientoInventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Compra" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "sedeId" TEXT,
    "codigo" TEXT,
    "fecha" DATE NOT NULL,
    "montoTotal" DECIMAL(10,2) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'registrada',
    "observacion" TEXT,
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompraDetalle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "compraId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnit" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "CompraDetalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantConfig" (
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL DEFAULT 'Mi Consultorio',
    "ruc" TEXT,
    "direccion" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "ciudad" TEXT NOT NULL DEFAULT 'Huancayo',
    "horario" JSONB,
    "descansos" JSONB,
    "logoUrl" TEXT,
    "colores" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantConfig_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "PlantillaWhatsApp" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlantillaWhatsApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "tabla" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "usuarioId" TEXT,
    "resultado" TEXT NOT NULL DEFAULT 'SUCCESS',
    "ip" TEXT,
    "userAgent" TEXT,
    "datosAnteriores" JSONB,
    "datosNuevos" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_codigo_key" ON "Plan"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "PlanFeature_planId_clave_key" ON "PlanFeature"("planId", "clave");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Sede_tenantId_idx" ON "Sede"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Sede_tenantId_nombre_key" ON "Sede"("tenantId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_tenantId_estado_idx" ON "Membership"("tenantId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_tenantId_userId_key" ON "Membership"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tenantId_codigo_key" ON "Role"("tenantId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_codigo_key" ON "Permission"("codigo");

-- CreateIndex
CREATE INDEX "Ubigeo_departamento_provincia_idx" ON "Ubigeo"("departamento", "provincia");

-- CreateIndex
CREATE INDEX "Paciente_tenantId_apellidos_nombres_idx" ON "Paciente"("tenantId", "apellidos", "nombres");

-- CreateIndex
CREATE INDEX "Paciente_tenantId_telefono_idx" ON "Paciente"("tenantId", "telefono");

-- CreateIndex
CREATE UNIQUE INDEX "Paciente_tenantId_tipoDoc_numDoc_key" ON "Paciente"("tenantId", "tipoDoc", "numDoc");

-- CreateIndex
CREATE INDEX "DocumentoPaciente_tenantId_pacienteId_tipo_idx" ON "DocumentoPaciente"("tenantId", "pacienteId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "Especialidad_tenantId_nombre_key" ON "Especialidad"("tenantId", "nombre");

-- CreateIndex
CREATE INDEX "Tratamiento_tenantId_activo_nombre_idx" ON "Tratamiento"("tenantId", "activo", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Tratamiento_tenantId_nombre_key" ON "Tratamiento"("tenantId", "nombre");

-- CreateIndex
CREATE INDEX "Cita_tenantId_fecha_estado_idx" ON "Cita"("tenantId", "fecha", "estado");

-- CreateIndex
CREATE INDEX "Cita_tenantId_pacienteId_fecha_idx" ON "Cita"("tenantId", "pacienteId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "Cita_tenantId_token_key" ON "Cita"("tenantId", "token");

-- CreateIndex
CREATE INDEX "HistorialClinico_tenantId_pacienteId_fecha_idx" ON "HistorialClinico"("tenantId", "pacienteId", "fecha");

-- CreateIndex
CREATE INDEX "Odontograma_tenantId_pacienteId_fecha_idx" ON "Odontograma"("tenantId", "pacienteId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "Odontograma_tenantId_pacienteId_version_key" ON "Odontograma"("tenantId", "pacienteId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "HallazgoCatalogo_codigo_key" ON "HallazgoCatalogo"("codigo");

-- CreateIndex
CREATE INDEX "OdontogramaHallazgo_tenantId_odontogramaId_pieza_activo_idx" ON "OdontogramaHallazgo"("tenantId", "odontogramaId", "pieza", "activo");

-- CreateIndex
CREATE INDEX "OdontogramaEvento_tenantId_odontogramaId_pieza_idx" ON "OdontogramaEvento"("tenantId", "odontogramaId", "pieza");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentimientoPlantilla_tenantId_clave_key" ON "ConsentimientoPlantilla"("tenantId", "clave");

-- CreateIndex
CREATE INDEX "ConsentimientoFirmado_tenantId_pacienteId_estado_idx" ON "ConsentimientoFirmado"("tenantId", "pacienteId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAccount_tenantId_userId_key" ON "GoogleAccount"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "Pago_tenantId_tipo_fecha_idx" ON "Pago"("tenantId", "tipo", "fecha");

-- CreateIndex
CREATE INDEX "Pago_tenantId_pacienteId_estado_idx" ON "Pago"("tenantId", "pacienteId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Pago_tenantId_codigoRecibo_key" ON "Pago"("tenantId", "codigoRecibo");

-- CreateIndex
CREATE UNIQUE INDEX "Pago_tenantId_referenciaTipo_referenciaId_key" ON "Pago"("tenantId", "referenciaTipo", "referenciaId");

-- CreateIndex
CREATE INDEX "PagoDetalle_tenantId_pagoId_idx" ON "PagoDetalle"("tenantId", "pagoId");

-- CreateIndex
CREATE INDEX "Cuota_tenantId_fechaVencimiento_estado_idx" ON "Cuota"("tenantId", "fechaVencimiento", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Cuota_tenantId_pagoId_nroCuota_key" ON "Cuota"("tenantId", "pagoId", "nroCuota");

-- CreateIndex
CREATE INDEX "Proveedor_tenantId_activo_nombre_idx" ON "Proveedor"("tenantId", "activo", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Proveedor_tenantId_ruc_key" ON "Proveedor"("tenantId", "ruc");

-- CreateIndex
CREATE INDEX "Insumo_tenantId_activo_nombre_idx" ON "Insumo"("tenantId", "activo", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Insumo_tenantId_sedeId_nombre_key" ON "Insumo"("tenantId", "sedeId", "nombre");

-- CreateIndex
CREATE INDEX "MovimientoInventario_tenantId_insumoId_fecha_idx" ON "MovimientoInventario"("tenantId", "insumoId", "fecha");

-- CreateIndex
CREATE INDEX "Compra_tenantId_proveedorId_fecha_idx" ON "Compra"("tenantId", "proveedorId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "Compra_tenantId_codigo_key" ON "Compra"("tenantId", "codigo");

-- CreateIndex
CREATE INDEX "CompraDetalle_tenantId_compraId_idx" ON "CompraDetalle"("tenantId", "compraId");

-- CreateIndex
CREATE UNIQUE INDEX "PlantillaWhatsApp_tenantId_clave_key" ON "PlantillaWhatsApp"("tenantId", "clave");

-- CreateIndex
CREATE INDEX "Auditoria_tenantId_createdAt_idx" ON "Auditoria"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Auditoria_tenantId_tabla_registroId_idx" ON "Auditoria"("tenantId", "tabla", "registroId");

-- AddForeignKey
ALTER TABLE "PlanFeature" ADD CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sede" ADD CONSTRAINT "Sede_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paciente" ADD CONSTRAINT "Paciente_ubigeoCodigo_fkey" FOREIGN KEY ("ubigeoCodigo") REFERENCES "Ubigeo"("codigo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paciente" ADD CONSTRAINT "Paciente_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoPaciente" ADD CONSTRAINT "DocumentoPaciente_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoPaciente" ADD CONSTRAINT "DocumentoPaciente_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Especialidad" ADD CONSTRAINT "Especialidad_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tratamiento" ADD CONSTRAINT "Tratamiento_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tratamiento" ADD CONSTRAINT "Tratamiento_especialidadId_fkey" FOREIGN KEY ("especialidadId") REFERENCES "Especialidad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_tratamientoId_fkey" FOREIGN KEY ("tratamientoId") REFERENCES "Tratamiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialClinico" ADD CONSTRAINT "HistorialClinico_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialClinico" ADD CONSTRAINT "HistorialClinico_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialClinico" ADD CONSTRAINT "HistorialClinico_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "Cita"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Odontograma" ADD CONSTRAINT "Odontograma_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Odontograma" ADD CONSTRAINT "Odontograma_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdontogramaHallazgo" ADD CONSTRAINT "OdontogramaHallazgo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdontogramaHallazgo" ADD CONSTRAINT "OdontogramaHallazgo_odontogramaId_fkey" FOREIGN KEY ("odontogramaId") REFERENCES "Odontograma"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdontogramaHallazgo" ADD CONSTRAINT "OdontogramaHallazgo_hallazgoCodigo_fkey" FOREIGN KEY ("hallazgoCodigo") REFERENCES "HallazgoCatalogo"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdontogramaHallazgo" ADD CONSTRAINT "OdontogramaHallazgo_tratamientoId_fkey" FOREIGN KEY ("tratamientoId") REFERENCES "Tratamiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdontogramaHallazgo" ADD CONSTRAINT "OdontogramaHallazgo_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "Cita"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdontogramaEvento" ADD CONSTRAINT "OdontogramaEvento_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdontogramaEvento" ADD CONSTRAINT "OdontogramaEvento_odontogramaId_fkey" FOREIGN KEY ("odontogramaId") REFERENCES "Odontograma"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdontogramaEvento" ADD CONSTRAINT "OdontogramaEvento_tratamientoId_fkey" FOREIGN KEY ("tratamientoId") REFERENCES "Tratamiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdontogramaEvento" ADD CONSTRAINT "OdontogramaEvento_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "Cita"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentimientoPlantilla" ADD CONSTRAINT "ConsentimientoPlantilla_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentimientoFirmado" ADD CONSTRAINT "ConsentimientoFirmado_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentimientoFirmado" ADD CONSTRAINT "ConsentimientoFirmado_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentimientoFirmado" ADD CONSTRAINT "ConsentimientoFirmado_plantillaId_fkey" FOREIGN KEY ("plantillaId") REFERENCES "ConsentimientoPlantilla"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAccount" ADD CONSTRAINT "GoogleAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "Cita"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoDetalle" ADD CONSTRAINT "PagoDetalle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoDetalle" ADD CONSTRAINT "PagoDetalle_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "Pago"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoDetalle" ADD CONSTRAINT "PagoDetalle_tratamientoId_fkey" FOREIGN KEY ("tratamientoId") REFERENCES "Tratamiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cuota" ADD CONSTRAINT "Cuota_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cuota" ADD CONSTRAINT "Cuota_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "Pago"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proveedor" ADD CONSTRAINT "Proveedor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventario" ADD CONSTRAINT "MovimientoInventario_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventario" ADD CONSTRAINT "MovimientoInventario_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraDetalle" ADD CONSTRAINT "CompraDetalle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraDetalle" ADD CONSTRAINT "CompraDetalle_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraDetalle" ADD CONSTRAINT "CompraDetalle_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantillaWhatsApp" ADD CONSTRAINT "PlantillaWhatsApp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
