# Primeros pasos de una clínica nueva

Guía del primer día para el dueño de una clínica recién dada de alta desde el
panel. La clínica nace lista pero VACÍA (probado de punta a punta en
`backend/test/aceptacion-alta.e2e-spec.ts`): 1 sede, rol ADMIN completo,
configuración con nombre y suscripción activa. Nada de tratamientos,
especialidades, plantillas ni insumos.

Cada paso dice **qué pasa si te lo saltas**: el orden importa.

---

## 1. Horario y descansos (Configuración)

Fija el horario de atención por día (`lun`…`dom`, `null` = cerrado) y los
descansos (feriados, vacaciones).

**Si te lo saltas:** la agenda acepta CUALQUIER hora, incluidas las 03:00 de
un domingo. Es deliberado (para no dejar sin agenda a quien aún no configuró),
no un bug: pero una clínica operando así cita fuera de turno sin que nadie se
entere. Configúralo el primer día y verifica con una cita de prueba fuera de
hora (debe rechazarse nombrando el horario).

## 2. Tratamientos y precios (Tratamientos)

Crea cada tratamiento con nombre, precio y duración (p. ej. «Limpieza dental»,
S/ 120, 30 min). La especialidad es opcional al inicio. Atajo: desde el panel,
en la ficha de la clínica, el botón **«Cargar catálogo de ejemplo»** crea los
típicos de una vez (no duplica ni pisa lo que ya creaste); **revisa sus precios
antes de cobrar**, son de ejemplo.

**Si te lo saltas:** no hay nada que cobrar ni nada que agendar con nombre:
las citas quedan sin tratamiento y los pagos, sin concepto asociado al
nomenclador. Los precios se pueden cambiar después; lo ya cobrado no se
reescribe (el recibo guarda sus propios importes).

## 3. Sedes, si hay más de una (Sedes)

La clínica nace con «Sede principal». Si atiende en más locales, crea las
demás aquí. (Con el plan Consultorio solo vale una; el sistema lo rechaza con
403, no es un aviso que se pueda ignorar.)

**Si te lo saltas:** todo cuelga de la sede principal. No rompe nada, pero las
citas, el inventario y los usuarios quedan sin sede real donde pertenecen.

## 4. Usuarios y roles (Usuarios)

Crea las cuentas del equipo con su rol y su sede. Revisa quién puede qué
**antes** de repartir claves:

- Quien cobra necesita el permiso de pagos; quien agenda, el de citas.
- Recepción típica: agenda y lectura de pacientes, SIN anular pagos ni
  configurar (el backend lo rechaza con 403 aunque la interfaz lo ocultara).
- El rol ADMIN lo tiene todo: no se lo des a nadie por comodidad.

**Si te lo saltas:** todo el equipo trabaja con la cuenta del dueño. Además
de inseguro, la auditoría no distingue quién hizo qué (todas las filas quedan
a nombre del dueño) y un despido obliga a cambiar la clave maestra.

## 5. Plantillas de consentimiento (Consentimientos)

Crea una plantilla por tratamiento que la requiera (endodoncia, ortodoncia…):
título + texto con `{paciente}`, `{dni}`, `{fecha}`. Al firmar, el texto se
congela: lo que el paciente vio queda guardado aunque la plantilla cambie
después.

**Si te lo saltas:** no se puede firmar nada desde el sistema (el
consentimiento exige plantilla). El papel escaneado como documento es el
sustituto, pero pierde el congelado de texto.

## 6. Opcional: insumos (Inventario)

Si quiere controlar stock (guantes, resinas, anestesia), créelos con su stock
mínimo y registre las compras. Sin compras, el stock empieza en lo que se
declare al crear el insumo.

**Si te lo saltas:** nada se rompe; simplemente no hay control de stock ni
valorizado. Se puede empezar meses después sin migrar nada.

---

## Lista de comprobación del primer día

- [ ] Horario configurado + cita de prueba fuera de hora rechazada.
- [ ] Al menos un tratamiento con precio.
- [ ] Cuentas del equipo (nadie comparte la del dueño).
- [ ] Una plantilla de consentimiento si se hace endodoncia/ortodoncia.
- [ ] Un paciente, una cita y un cobro de prueba que cuadren.
