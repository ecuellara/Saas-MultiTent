# Planes comerciales SaaS Dental — 2026

**Moneda:** soles peruanos (PEN)  
**Modelo:** software como servicio (SaaS), multi-tenant  
**Modalidades:** pago mensual o anual anticipado  
**Estado:** propuesta comercial pendiente de validación de costos e impuestos

## 1. Planes y precios

| Plan | Pago mensual | Total 12 mensualidades | Pago anual anticipado | Ahorro anual | Descuento |
|---|---:|---:|---:|---:|---:|
| Consultorio | S/ 79 | S/ 948 | S/ 790 | S/ 158 | 16.67 % |
| Profesional | S/ 149 | S/ 1,788 | S/ 1,490 | S/ 298 | 16.67 % |
| Clínica | S/ 249 | S/ 2,988 | S/ 2,490 | S/ 498 | 16.67 % |

El pago anual equivale a pagar **10 meses y utilizar 12**. El importe anual se cobra por adelantado; no es un cobro mensual fraccionado.

## 1.1 Comisión de la pasarela (la asume la clínica)

Izipay cobra **3,44 % del valor de la operación más 18 % de IGV** sobre esa comisión
(**4,0592 %** efectivo), y además **S/ 0,69 más IGV** por canal virtual (**S/ 0,8142**
por operación).

Para que la clínica reciba el precio del plan **íntegro**, el importe que se cobra es:

```text
total = (precio + 0,8142) / (1 − 0,040592)   →  redondeado HACIA ARRIBA al céntimo
```

| Plan | Precio del plan | Comisión pasarela | **Total a pagar** |
|---|---:|---:|---:|
| Consultorio | S/ 79,00 | S/ 4,20 | **S/ 83,20** |
| Profesional | S/ 149,00 | S/ 7,16 | **S/ 156,16** |
| Clínica | S/ 249,00 | S/ 11,39 | **S/ 260,39** |

El redondeo hacia arriba garantiza que la clínica nunca reciba menos que el precio del
plan. El año anual se calcula con la misma fórmula sobre el importe anual.

**Cómo se comunica:** en la pantalla de pago se muestra el desglose (precio del plan +
comisión = total) y una nota: «*El importe incluye la comisión de la pasarela de pago,
que asume la clínica*». Al continuar, el usuario acepta las condiciones del servicio.
El cobro registrado en el sistema sigue siendo el **precio del plan**; la comisión es un
coste de la operación y no un ingreso.
## 2. Capacidad por plan

| Límite | Consultorio | Profesional | Clínica |
|---|---:|---:|---:|
| Sedes | 1 | 1 | Hasta 3 |
| Odontólogos | 1 | Hasta 3 | Hasta 8 |
| Usuarios totales | Hasta 2 | Hasta 5 | Hasta 15 |
| Gestión multisede | No | No | Sí |
| Soporte | Estándar | Prioritario | Prioritario |

Los límites de usuarios incluyen las cuentas de odontólogos y personal administrativo; esta definición evita duplicar cupos. Los límites y precios de ampliaciones deberán configurarse antes del lanzamiento.

## 3. Funcionalidades

### Funciones clínicas esenciales en los tres planes

- Registro y gestión de pacientes.
- Historia clínica odontológica.
- Odontograma con nomenclatura FDI.
- Agenda y gestión de citas.
- Tratamientos, presupuestos y seguimiento.
- Registro de pagos y cuotas.
- Gestión básica de inventario.
- Enlaces y plantillas manuales de WhatsApp.
- Gestión de cuentas y permisos básicos.

### Funcionalidades administrativas diferenciadas

| Funcionalidad | Consultorio | Profesional | Clínica |
|---|---|---|---|
| Reportes | Básicos | Avanzados | Avanzados y por sede |
| Inventario | Básico | Completo | Completo por sede |
| Proveedores y compras | Básico | Completo | Completo por sede |
| Roles y permisos | Básicos | Avanzados | Avanzados por sede |
| Auditoría de cambios | No | Sí | Sí |
| Personalización de marca (logo y 2 colores) | Sí | Sí | Sí |
| Administración de múltiples sedes | No | No | Sí |

Las funciones clínicas esenciales no se bloquean por plan; las diferencias se concentran en capacidad y herramientas administrativas.

## 4. Condiciones de contratación y renovación

1. **Mensual:** acceso por un mes desde la activación o renovación, con fecha de vencimiento registrada.
2. **Anual:** acceso por 12 meses, pagado por adelantado, con descuento equivalente a dos mensualidades.
3. **Avisos:** recordatorios sugeridos 15, 7 y 3 días antes del vencimiento.
4. **Gracia:** siete días después del vencimiento; se define contractualmente qué operaciones siguen habilitadas.
5. **Suspensión:** al concluir la gracia, suspender operaciones según la política de servicio, sin borrar automáticamente historias clínicas ni documentos.
6. **Reactivación:** al confirmar el pago, restaurar el acceso correspondiente al plan vigente.
7. **Cambio de plan:** permitir ampliaciones y calcular un ajuste proporcional por el tiempo restante; definir reglas específicas para reducciones.
8. **Cancelación:** desactivar la renovación futura y conservar acceso hasta el final del período pagado, sujeto a las condiciones contratadas.
9. **Datos clínicos:** definir por contrato plazos de conservación, mecanismos de exportación, respaldo y eliminación conforme a la normativa aplicable.
10. **Impuestos:** confirmar antes de publicar si los precios incluyen IGV y las obligaciones de comprobantes electrónicos.

## 5. Servicios y costos adicionales

- **Mensajería:** los enlaces `wa.me` y las plantillas manuales pueden estar incluidos; la automatización mediante WhatsApp Business Platform y sus cargos se cotizan aparte.
- **Archivos clínicos:** establecer cuotas de almacenamiento por plan para fotografías, radiografías y documentos, y precios por capacidad adicional.
- **Sedes, odontólogos y usuarios extra:** ofrecer ampliaciones según límites técnicos y comerciales aún por definir.
- **Migración de datos y capacitación:** evaluar un pago único según el trabajo requerido.
- **Implementación personalizada:** cotizar por separado las integraciones o desarrollos fuera del alcance estándar.

## 6. Arquitectura técnica propuesta

```text
Usuarios / Consultorios / Clínicas
              |
          Cloudflare
              |
      Frontend + API SaaS
     (DigitalOcean / Docker)
              |
        Supabase Postgres
              |
  Tenant + Plan + Suscripción
              |
  Control de permisos y límites
```

**Principios:**

- Aplicación compartida multi-tenant con separación lógica estricta por `tenant_id`.
- Validación de permisos, estado de suscripción y límites en el backend, no solo en el frontend.
- Políticas RLS en Supabase para los datos accesibles desde clientes, cuando corresponda.
- Separación de datos clínicos, facturación, suscripciones y auditoría.
- Backups probados y política de recuperación documentada.

## 7. Modelo de datos mínimo para facturación

### `plans`

- `id`, `code`, `name`, `is_active`
- `monthly_price_pen`, `annual_price_pen`
- `max_branches`, `max_dentists`, `max_users`
- `features` (JSONB o relación normalizada)

### `tenants`

- `id`, `name`, `status`, `created_at`

### `subscriptions`

- `id`, `tenant_id`, `plan_id`
- `billing_cycle`: `MONTHLY` o `ANNUAL`
- `status`: `TRIALING`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELED`, `EXPIRED`
- `starts_at`, `current_period_start`, `current_period_end`
- `grace_ends_at`, `cancel_at_period_end`, `next_billing_at`
- `agreed_price_pen`, `created_at`, `updated_at`

### `subscription_payments`

- `id`, `subscription_id`, `tenant_id`
- `amount_pen`, `currency`, `status`
- `payment_method`, `external_reference`
- `paid_at`, `period_start`, `period_end`, `created_at`

**Regla importante:** registrar el precio pactado y los importes realmente pagados como datos históricos. Cambiar el precio de un plan no debe modificar retroactivamente los pagos ni los contratos existentes.

## 8. Reglas de negocio

- Un tenant puede tener un historial de suscripciones, pero solo una suscripción operativa vigente a la vez.
- La capacidad disponible depende del plan activo y de las ampliaciones contratadas.
- Una suscripción anual no debe cobrar automáticamente cada mes.
- La renovación genera un nuevo período de servicio y su registro de pago correspondiente.
- Los pagos pendientes no se contabilizan como ingresos cobrados.
- La suspensión comercial no debe provocar la eliminación inmediata de información clínica.
- Los cambios de plan deben conservar pacientes, historias clínicas, odontogramas y transacciones.
- Toda modificación administrativa de suscripciones y pagos debe quedar auditada.

## 9. Ejemplo de ingresos recurrentes

| Clientes | Plan | Ingreso mensual teórico |
|---:|---|---:|
| 10 | Consultorio | S/ 790 |
| 5 | Profesional | S/ 745 |
| 2 | Clínica | S/ 498 |
| **17** | **Total** | **S/ 2,033** |

**Ingreso anual equivalente con esos clientes pagando mensualmente:** S/ 24,396.  
**Cobro anual anticipado si los 17 contrataran planes anuales:** S/ 20,330.

Estas cifras son ingresos brutos, sin deducir impuestos, infraestructura, comisiones, soporte ni otros gastos. Los pagos anuales representan cobros anticipados; no deben confundirse con ingresos mensuales efectivamente cobrados.

## 10. Decisiones pendientes antes del lanzamiento

- Validar que S/ 79, S/ 149 y S/ 249 cubren los costos reales por cliente.
- Definir si los precios publicados incluyen IGV.
- Determinar las cuotas de almacenamiento y los precios de ampliación.
- Precisar la política de conservación y exportación de historias clínicas.
- Definir medios de pago, facturación y proceso de conciliación.
- Documentar términos del servicio, tratamiento de datos personales y acuerdo de confidencialidad aplicable.

---

**Propuesta comercial:** Consultorio **S/ 79 mensual / S/ 790 anual**; Profesional **S/ 149 mensual / S/ 1,490 anual**; Clínica **S/ 249 mensual / S/ 2,490 anual**.
