# Deuda técnica — Dental SaaS

> **Estado:** registro vivo. Última actualización: octubre 2026.
> **Regla:** este documento no es una lista de deseos. Cada entrada tiene un motivo
> por el que **hoy** no se hace, y un disparador que la reactiva.

---

## 1. Propósito

Concentrar en un solo lugar lo que se decidió **no** hacer todavía, para que no se
pierda ni se confunda con un bug pendiente. Lo que sí está corregido y verificado
vive en el código y en [plan-pruebas-aislamiento.md](plan-pruebas-aislamiento.md).

> Este documento registra **solo lo que sigue abierto**. Cuando una entrada se
> cierra, se retira de aquí (el histórico está en el repositorio, no en la lista).

---

## 2. Integraciones de pago (deuda aceptada)

### 2.1 Decisión

**Se integra únicamente con Izipay**, y **no ahora**. El alcance se hará en tres
etapas, en este orden:

| Etapa | Alcance | Producto y modo |
|---|---|---|
| **1** | **Pagos únicos** (cobro puntual al paciente) | Izipay **REST V4.0** (`micuentaweb`) — **formulario incrustado** a partir de un `formToken` |
| **2** | **Suscripciones** del SaaS (cobro recurrente a la clínica) | **La MISMA documentación** REST V4.0 (`CreatePayment`); cambia la periodicidad y el guardado del token |
| **3** | Migración a la experiencia nueva | Izipay **web-core**, modalidad **embebido** (SDK y esquema de firma distintos) |

**Motivo de aplazarlo:** la facturación del SaaS sigue siendo **manual** por el
panel de plataforma (ADR-008) y eso es suficiente para las primeras clínicas. No
hay urgencia de negocio que justifique asumir ahora el coste de una integración
de pagos (credenciales, conciliación, devoluciones, soporte del gateway).

**Disparador de la etapa 1:** la primera clínica que pida pagar a sus pacientes
desde el software, o la primera que necesite cobro con tarjeta en mostrador.

**Disparador de la etapa 2:** más clínicas de las que se puedan facturar a mano.

> **Devoluciones:** quedan **fuera** de este alcance y usan **otra documentación**
> del proveedor (API de `refund`), distinta de `CreatePayment`. Cuando se pidan,
> tratar como una entrada nueva, no como una extensión de la etapa 1.

### 2.1.1 Flujo de pago único (REST V4, formulario incrustado)

```text
1. Frontend  →  POST <api>/payments/form-token      { orderId, amount, currency, customer }
2. Backend   →  POST https://api.micuentaweb.pe/api-payment/V4/Charge/CreatePayment
                Authorization: Basic BASE64(USERNAME:PASSWORD)
                ← { status: "SUCCESS", answer: { formToken } }
3. Frontend  ←  { formToken, publicKey }             (nada más: ni usuario ni clave)
4. Frontend  →  KRGlue.loadLibrary('https://static.micuentaweb.pe', publicKey)
                KR.setFormConfig({ formToken, 'kr-language': 'es-ES' })
                KR.attachForm('#micuentawebstd_rest_wrapper') → KR.showForm(result.formId)
5. Usuario paga en el formulario incrustado en nuestro <div>
6. Frontend  →  KR.onSubmit → POST <api>/payments/validate
                { 'kr-answer': paymentData.rawClientAnswer, 'kr-hash': paymentData.hash }
7. Backend   →  valida firma → analiza estado → compara con la orden interna → responde
8. Izipay    →  IPN servidor-a-servidor a POST <api>/payments/ipn   ← FUENTE DE VERDAD
```

Datos concretos que hay que respetar:

- **El importe viaja en unidades mínimas**: `S/ 59.90 → 5990` (`amount * 100`).
- Cuerpo de `CreatePayment`: `amount`, `currency` (`PEN`), `orderId`, y
  `customer.email` + `customer.billingDetails` (`firstName`, `lastName`,
  `phoneNumber`, `identityType`, `identityCode`, `address`, `country`, `city`,
  `state`, `zipCode`).
- El HTML necesita un contenedor propio:
  `<div id="micuentawebstd_rest_wrapper"><div class="kr-embedded"></div></div>`,
  más los recursos CSS/JS del cliente Krypton.
- La librería del formulario es `@lyracom/embedded-form-glue`.

Reglas que no se deben reinterpretar:

- **Las credenciales viven solo en el backend.** El navegador recibe únicamente
  `formToken` y `publicKey`; nunca usuario, contraseña ni la clave HMAC.
- El **`formToken` no se puede fabricar en el cliente**: lo emite Izipay a
  petición del backend.
- **El frontend no confirma el pago.** Un `if (frontendPaymentSuccess)` que ponga
  el pedido en `PAID` es exactamente lo que hay que evitar: la confirmación pasa
  por validación de firma + importe + orden + **IPN**.
- **La IPN es la fuente de verdad** y se procesa de forma **idempotente**.
- El endpoint `POST /api/payments/ipn` debe estar **fuera** de la autenticación
  normal (es servidor a servidor) y validar la firma antes de tocar nada.

### 2.1.2 Flujo de suscripciones: mismo producto, operaciones adicionales

Comparte producto, credenciales y validación de firma con el pago único (es la
misma referencia REST V4), pero **no es una variación del pago único**: añade
tokenización y recurrencia, y su modelo de datos es distinto.

```text
1. Cliente registra la tarjeta   →  Izipay guarda los datos sensibles
2. Backend: POST /api-payment/V4/Charge/CreateToken        →  paymentMethodToken
3. Backend guarda el token (NUNCA el PAN ni el CVV)
4. Backend: POST /api-payment/V4/Charge/CreateSubscription
   { amount, currency, effectDate, paymentMethodToken, rrule, orderId }
   →  { subscriptionId }
5. Cada renovación es una TRANSACCIÓN INDEPENDIENTE (no una sola)
6. Cancelación: POST /api-payment/V4/Subscription/Cancel
```

- La recurrencia se define con **RRULE (iCalendar/RFC5545)**: por ejemplo
  `RRULE:FREQ=MONTHLY;INTERVAL=1`, `FREQ=WEEKLY;INTERVAL=2`,
  `FREQ=MONTHLY;COUNT=12` (12 meses).
- **`effectDate` es delicado**: mal calculado provoca doble cobro, una primera
  cuota inesperada, fechas en pasado o corrimientos por zona horaria. En algunos
  flujos se recomienda que la recurrencia empiece **después** de la creación para
  no duplicar el primer pago.
- El **precio lo pone el backend desde el plan almacenado**, nunca el cliente
  (si no, un `amount: 0.01` cambiaría el precio de la suscripción).
- **La recurrencia debe estar habilitada por Izipay** para el comercio/MID: hay
  que confirmarlo antes de prometer la función.

**Relación de datos:** 1 cliente → N suscripciones → N transacciones. Mezclar la
suscripción con una única transacción impide cambiar de plan, reintentar, cancelar
y reportar.

### 2.1.3 Referencias

Especificación técnica completa (la que aportó el usuario, copiada al repositorio):
- [izipay-integracion.md](izipay-integracion.md) — arquitectura, endpoints,
  payloads, RRULE, modelo de datos, estados, idempotencia, seguridad, logging,
  pruebas y checklist de producción

Ejemplo oficial a seguir:
- [Embedded-PaymentForm-React](https://github.com/izipay-pe/Embedded-PaymentForm-React) — flujo completo comentado (formtoken → librería → onSubmit → validación → IPN)

API y guías:
- [Referencia API REST V4](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/api/reference.html)
- [`CreatePayment`](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/api/playground/Charge/CreatePayment)
- [SmartForm / Quick Start](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/javascript/redirection/quick_start_smartform.html)
- [Formulario incrustado: prueba rápida](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/javascript/quick_start_js.html)
- [Analizar el resultado del pago](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/kb/payment_done.html)
- [Analizar la IPN](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/api/kb/ipn_usage.html)
- [Tarjetas de prueba](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/api/kb/test_cards.html)
- [Obtener credenciales del Back Office](https://github.com/izipay-pe/obtener-credenciales-de-conexion)
- Servidor de referencia en nuestro stack: [Server-PaymentForm-NodeJS](https://github.com/izipay-pe/Server-PaymentForm-NodeJS)
- Tokenización y recurrencia (Lyra Collect): [documento técnico](https://docs.lyra.com/content/lyradoc/en/collect/form-payment/subscription-token/tla1430209986491.pdf)

Producto nuevo (etapa 3):
- [web-core — Embebido](https://developers.izipay.pe/web-core/modalidades/embebido/)
- [web-core — Validación de firma](https://developers.izipay.pe/web-core/modalidades/firma-validation/)
- [web-core — Servicio de notificaciones (IPN)](https://developers.izipay.pe/web-core/notifications/)

### 2.2 Qué existe hoy en el código

**Ya está hecho y es reutilizable** (no es deuda):

- El modelo de planes y suscripciones: `Plan`, `PlanFeature`, `Subscription`
  (estados `TRIAL | ACTIVE | PAST_DUE | SUSPENDED | CANCELLED | EXPIRED`),
  `EntitlementsService` con límites y features, y el **dunning** que degrada a
  `PAST_DUE` y luego `SUSPENDED` cortando el acceso al tenant.
- La **idempotencia** del alta de cobro (`CobroSuscripcion.claveIdempotencia`
  única + recuperación ante la carrera `P2002`).
- El **registro de eventos** de webhook (`WebhookEvent.eventId` único) con
  detección de duplicados.
- El panel de plataforma para asignar plan y suspender/reactivar clínicas
  (`@PlatformRoles`), que sirve tal cual para la facturación manual.

**Es lo que se retira o se reescribe con Izipay:**

| Archivo | Qué es | Destino |
|---|---|---|
| `src/modules/facturacion/verificadores.ts` | Verificación `hmac` genérica y **MercadoPago** | Se conserva `hmac` como referencia; **MP se retira** |
| `src/modules/facturacion/facturacion.module.ts` | `WebhooksController` (`POST /webhooks/:proveedor`), `BillingService.procesar`, checkout manual | El controlador se reutiliza; se añade el proveedor `izipay` |
| `BILLING_HMAC_SECRET`, `BILLING_MP_SECRET` | Secretos de los proveedores provisionales | Se sustituyen por las credenciales de Izipay |

### 2.2.1 Mapeo entre la especificación y nuestro esquema

La especificación propone seis tablas. Así encajan (y qué falta) en el modelo actual:

| Especificación | En nuestro esquema | Estado |
|---|---|---|
| `plans` | `Plan` + `PlanFeature` | ✅ Existe y se reutiliza tal cual |
| `subscriptions` | `Subscription` | ⚠️ Existe pero **le faltan** `providerSubscriptionId`, `paymentMethodId`, `effectDate`, `rrule`, `nextPaymentAt` |
| `payments` | `CobroSuscripcion` | ⚠️ Existe con `claveIdempotencia` y `referenciaExterna`; **falta** separar `providerStatus` de `internalStatus` y el `orderId` |
| `payment_events` | `WebhookEvent` | ⚠️ Existe con `eventId` único y `payload`; **falta `signature_valid`** (hoy no se persiste si la firma era válida) |
| `payment_methods` | — | ❌ **No existe.** Es imprescindible para la etapa 2 (tokenización): lo que se guarda es el token, nunca el PAN ni el CVV |
| `customers` | `Tenant` (para el SaaS) y `Paciente` (para el cobro al paciente) | ✅ No hace falta tabla nueva: la relación ya está |
| `orders` | — | ❌ **No existe.** Hace falta algo que correlacione `orderId` ↔ formToken ↔ pago, porque el `Pago` del módulo de clínica es el registro contable, no el intento de pago |

**Consecuencias de diseño que esto implica:**

1. **Un intento de pago no es un pago.** Un formToken puede quedar abandonado o
   rechazado sin que exista un `Pago`. Meter los intentos en `Pago` ensuciaría el
   arqueo de caja del módulo de clínica (que hoy cuadra) y obligaría a filtrar
   estados del gateway en todos los reportes.
2. **Estados separados.** La propuesta de `provider_status` + `internal_status` es
   correcta y evita acoplar el negocio a los nombres de Izipay (`CAPTURED` →
   nuestro `PAID`).
3. **Idempotencia ya resuelta en parte.** `WebhookEvent.eventId` único y
   `CobroSuscripcion.claveIdempotencia` única cubren lo que la especificación pide
   (`provider + external_transaction_id + event_type`); solo hay que **construir la
   clave con esos tres campos** y reutilizar la recuperación ante `P2002` que ya
   está implementada.
4. **`signature_valid` es un hueco real de auditoría** de la integración: sin esa
   columna no se puede distinguir un evento verificado de uno que llegó con firma
   inválida (que hoy simplemente se rechaza con 401 y no se registra).

### 2.3 Etapa 1 — Pagos únicos

**Objetivo:** cobrar un importe puntual (por ejemplo el saldo de un tratamiento)
con tarjeta, y que quede reflejado en el módulo de Pagos.

Puntos de diseño a decidir al implementar:

1. **Dónde encaja en el dominio.** El pago puntual corresponde a un `Pago` de
   `tipo = 'ingreso'` con un `pacienteId`. Hay que decidir si se guarda el
   identificador de la transacción del gateway en `Pago.referenciaId` /
   `referenciaTipo = 'izipay'` (hoy `referenciaTipo` se usa para vincular el
   egreso de una compra) o si se crea una tabla de intentos de pago. **Recomendado:
   tabla propia de intentos**, porque un intento puede fallar o quedar abandonado
   sin que exista un `Pago` todavía.
2. **Quién genera el `orderNumber`.** Debe ser nuestro (correlativo por tenant,
   reutilizando `SecuenciasService`) y viajar en la petición, para poder conciliar
   el IPN contra algo que controlamos.
3. **El importe nunca se confía al retorno del navegador.** La confirmación válida
   es el **IPN** (ver 2.7); el retorno del navegador solo se usa para la pantalla de
   resultado, y siempre después de que el backend valide `kr-hash`.
4. **El `formToken` exige una llamada servidor a servidor.** Lo genera el backend
   con las credenciales del comercio; **no puede generarse en el navegador**. Es el
   punto que más se subestima, y condiciona el diseño: el frontend necesita dos
   endpoints propios (`/formtoken` y `/validate`) desde el primer día.

### 2.4 Etapa 2 — Suscripciones (la MISMA documentación)

**Objetivo:** cobrar la suscripción de la clínica sin intervención manual,
reutilizando `Subscription`, `EntitlementsService` y el dunning ya existentes.

**El flujo de pago es el mismo `CreatePayment` de la etapa 1** (formToken →
formulario incrustado → validación → IPN). Lo que cambia es **la periodicidad**
—hay que poder cobrar sin que el usuario esté presente— y, por tanto, **el
guardado del medio de pago**. No es una integración nueva: es la misma con un
job delante.

Puntos a resolver:

1. **Tokenización de la tarjeta.** El cobro recurrente sin intervención exige un
   token/cryptograma guardado. Eso convierte a `CobroSuscripcion.metadata` (o a una
   tabla nueva) en un dato **sensible**: hay que cifrarlo en reposo y tratarlo como
   secreto, igual que ya se hace con el refresh token de Google
   (AES-256-GCM, `GOOGLE_TOKEN_KEY`).
2. **Programación del cobro.** Requiere un job (Redis + cola, o un cron con lock)
   que aún no existe: hoy no hay ningún proceso en segundo plano en el proyecto.
   Es el mismo trabajo pendiente que el marcado de cuotas vencidas.
3. **Reintentos y dunning.** Cuando el cobro recurrente falla, `PAST_DUE` →
   `SUSPENDED` ya está implementado; hay que decidir la política de reintentos
   (cuántos, con qué separación) antes de degradar.
4. **Idempotencia del cobro recurrente.** La clave debe incluir el periodo
   (`chk-<tenant>-<plan>-<YYYYMM>` ya es el formato manual): reutilizarla evita
   cobrar dos veces el mismo mes si el job se ejecuta dos veces.

### 2.5 Etapa 3 — Migración a web-core embebido

**Objetivo:** sustituir el cliente de pago (`micuentaweb` REST V4.0) por el
producto nuevo **web-core**, que también incrusta un formulario en la página, sin
cambiar el modelo de datos ni la conciliación. **No es «pasar de redirección a
embebido»**: la etapa 1 ya es embebida. Lo que cambia es **el SDK y el esquema de
firma** (ver 2.7).

Lo que ya sabemos de la documentación de web-core (modalidad *embebido*):

- La configuración es un objeto `iziConfig` con `action`, `merchantCode`,
  `transactionId`, `order` (`orderNumber`, `currency`, `amount`, `processType`,
  `merchantBuyerId`, `dateTimeTransaction`), `billing`, `shipping` y
  `render: { typeForm: 'embedded', container, showButtonProcessForm }`.
- Se instancia `new Izipay({ config })` y se muestra con
  `checkout.LoadForm({ authorization, keyRSA, callbackResponse })`, donde
  `authorization` es el **token de sesión** que emite el backend y `keyRSA` la
  clave pública.
- El script del SDK se carga con
  `.../payments/v1/js/index.js?mode=embedded&container=<id>`, y el `container`
  debe existir en el DOM o el formulario no se muestra.

**Implicación de arquitectura:** el `authorization` y el `keyRSA` salen de una
llamada servidor a servidor. Eso significa que el frontend necesita un endpoint
propio («preparar pago») que devuelva esos valores y **nunca** las credenciales
del comercio. Si en la etapa 1 ya se implementa ese endpoint, la etapa 3 es
prácticamente cambiar el script del SDK y el `typeForm`.

### 2.6 Lo que queda por confirmar (con Izipay, no en la documentación)

Tras leer la especificación adjunta ya no hay dudas de flujo, endpoints ni
payloads. Lo que **no** depende de la documentación, sino del contrato del
comercio, y hay que confirmar **con Izipay antes de prometer la función**:

1. Que la **funcionalidad de recurrencia está habilitada** para el comercio/MID.
2. Qué **métodos de pago** pueden usarse para recurrencia en ese MID.
3. Qué **endpoints REST V4 están habilitados** para la cuenta.
4. Los **parámetros exactos** que exige la versión actual de la API: los de la
   especificación son conceptuales.
5. Las **reglas de `effectDate`** aplicables (ver 2.1.2).
6. Qué **eventos IPN están habilitados**.
7. El **mecanismo de autenticación y firma** de cada operación.
8. Las **condiciones comerciales y regulatorias** del cobro recurrente.

Quedan dos huecos que ni la documentación accesible ni la especificación fijan:

- la **forma exacta del IPN** y con qué se comprueba su autenticidad;
- cómo se pide una **devolución** (fuera de alcance: usa otra documentación).

> Para el protocolo clásico de campos `vads_` la especificación recuerda el
> procedimiento (ordenar alfabéticamente, UTF-8, concatenar con `+`, añadir la
> clave, HMAC-SHA-256; SHA-1 es legado), pero **ese no es el camino de REST V4**:
> ahí manda `kr-answer`/`kr-hash` (etapas 1-2) y `payloadHttp`/`signature`
> (etapa 3), como se detalla en 2.7.

### 2.7 Verificación de firma: son DOS esquemas distintos

Es el punto donde es más fácil equivocarse, porque los dos productos firman cosas
diferentes. **No reutilizar el verificador de uno para el otro.**

**Etapas 1 y 2 — `micuentaweb` REST V4.0 (formulario incrustado):**

- El frontend envía a nuestro backend `kr-answer` (la respuesta cruda del pago) y
  `kr-hash` (su firma).
- El backend **recalcula el hash de `kr-answer` con la clave secreta** y lo compara
  con `kr-hash`. Si coincide, la respuesta es íntegra; si no, se descarta y no se
  muestra ningún resultado al paciente.
- Comparación en **tiempo constante** (`crypto.timingSafeEqual`).
- **El algoritmo exacto y qué clave se usa hay que confirmarlos** en
  [Analizar el resultado del pago](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/kb/payment_done.html)
  (ver 2.6): aquí no se dan por supuestos.

**Etapa 3 — `web-core`:**

- La respuesta y el IPN traen el payload original en `payloadHttp` y su firma en
  `signature`.
- La verificación es `HMAC-SHA256(clave = claveHash, mensaje = payloadHttp)`
  **codificado en base64**, comparado con `signature`.
- **No hay que re-serializar el cuerpo**: se firma sobre `payloadHttp` tal cual.
- Solo se valida cuando `code` **no** es `021` ni `COMMUNICATION_ERROR`.
- El ejemplo de la documentación compara con `===`; aquí se hará en tiempo constante.

**En ambos casos la firma autentica, pero no basta.** Una firma válida prueba que
el mensaje lo emitió Izipay; **no** prueba que corresponda al cobro que esperamos.
Falta conciliar contra nuestro registro:

1. El identificador de pedido debe existir y estar **pendiente** en nuestro sistema
   (por eso lo generamos nosotros).
2. El **importe y la moneda** deben coincidir con lo esperado. Sin esto, un pago de
   S/ 1 confirmaría una suscripción de S/ 249.
3. Registrar siempre el evento en `WebhookEvent` con un `eventId` derivado del
   identificador de la transacción, y responder `2xx` **solo** tras procesarlo, para
   que el gateway no reintente en bucle por un error nuestro.
4. **El IPN manda.** Si el retorno del navegador dice «pagado» y el IPN no llega o
   dice lo contrario, prevalece el IPN.

### 2.8 Riesgos conocidos del código actual que se retiran con Izipay

- **`metadata.referencia` no va firmado en el verificador de MercadoPago.**
  MP firma un manifiesto construido con `id`, `request-id` y `ts`; el campo
  `metadata.referencia`, que decide **a qué cobro** se atribuye el pago, queda
  fuera de la firma. Con una firma válida de un pago propio se podría alterar esa
  referencia y extender la suscripción de **otra clínica**.
  **Mientras MP no se active, no es explotable.** Si alguna vez se habilita antes
  de Izipay, hay que corregirlo primero: resolver el cobro por
  `CobroSuscripcion.referenciaExterna` (que es única) usando el id **firmado**,
  en lugar de confiar en el cuerpo.
- **El proveedor `hmac` genérico** firma una canonicalización del JSON
  (`canonico()`), no el cuerpo crudo. Sirve para pruebas y para un gateway que se
  conecte con ese contrato, pero **no** es el esquema de Izipay.

### 2.9 Checklist por etapa

**Etapa 1 (pagos únicos, formulario incrustado)**
- [ ] Confirmar en la documentación (en el navegador: son SPA) el endpoint, la autenticación y el cuerpo de `CreatePayment`, y el algoritmo de `kr-hash`.
- [ ] Credenciales por entorno: `IZIPAY_USERNAME`, `IZIPAY_PASSWORD`, `IZIPAY_PUBLIC_KEY`, `IZIPAY_HMAC_SHA256_KEY`, `IZIPAY_ENV` — nunca en el repositorio.
- [ ] Cliente de Izipay encapsulado (`services/izipay/…`), sin llamadas sueltas repartidas por el código.
- [ ] `POST /api/payments/form-token`: convierte el importe a **unidades mínimas** (`amount * 100`), arma `customer.billingDetails` y llama a `Charge/CreatePayment` con `Authorization: Basic`; devuelve **solo** `formToken` + `publicKey`.
- [ ] Tabla de **intentos/órdenes** (`orders`): un formToken abandonado o rechazado **no** debe crear un `Pago` ni ensuciar el arqueo de caja.
- [ ] `POST /api/payments/validate`: valida `kr-hash` sobre `kr-answer` en tiempo constante, analiza el estado y compara con la orden (importe, moneda, `orderId`); responde al frontend **sin** cambiar el estado por sí solo.
- [ ] `POST /api/payments/ipn`: **fuera** de la autenticación normal; valida firma → identifica la orden → valida importe, moneda y estado → registra el evento → actualiza la orden.
- [ ] Idempotencia del IPN con la clave `provider + external_transaction_id + event_type`, reutilizando la recuperación ante `P2002` que ya existe.
- [ ] Añadir **`signature_valid`** a `WebhookEvent` (hueco de auditoría: hoy no se persiste si la firma era válida).
- [ ] Frontend: `@lyracom/embedded-form-glue` (`loadLibrary` → `setFormConfig` → `attachForm`/`showForm`) sobre `<div id="micuentawebstd_rest_wrapper"><div class="kr-embedded"></div></div>`, más los CSS/JS de Krypton.
- [ ] **`orderId` propio por tenant** con `SecuenciasService`, enviado al crear el formToken.
- [ ] Rate limiting en los tres endpoints: hoy el limitador solo cubre el login.
- [ ] Nunca registrar PAN/CVV ni devolver credenciales; logs con `traceId`, `orderId`, `providerStatus`, `internalStatus`, importe y moneda.
- [ ] Pruebas con [tarjetas de prueba](https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/api/kb/test_cards.html): aprobado, rechazado, abandono, `formToken` inválido, firma inválida, IPN repetida, **IPN tardía**, orden inexistente, importe incorrecto, moneda incorrecta.

**Etapa 2 (suscripciones)**
- [ ] Confirmar con Izipay que la recurrencia está habilitada (ver 2.6) **antes** de empezar.
- [ ] Tabla **`payment_methods`**: `provider_token`, `brand`, `last4`, `expiry_*`; **nunca** PAN ni CVV.
- [ ] Token cifrado en reposo (mismo patrón que `GoogleAccount.refreshToken`, AES-256-GCM).
- [ ] Ampliar `Subscription` con `providerSubscriptionId`, `paymentMethodId`, `effectDate`, `rrule`, `nextPaymentAt`.
- [ ] `POST /api/subscriptions`: el precio sale del **plan almacenado**; `RRULE` construida desde `interval`/`intervalCount`; `effectDate` con zona horaria correcta y sin duplicar el primer cobro.
- [ ] `POST /api/subscriptions/:id/cancel`: localiza `providerSubscriptionId` y verifica **propiedad** antes de llamar a `Subscription/Cancel`.
- [ ] IPN de suscripción: distinguir creación, renovación exitosa, renovación rechazada, reintento y cancelación.
- [ ] Job periódico con lock (no existe todavía ningún proceso en segundo plano) y política de reintentos antes de degradar a `PAST_DUE`/`SUSPENDED`.
- [ ] Separar `providerStatus` de `internalStatus` en los cobros.
- [ ] Pruebas: token creado/inválido/expirado, suscripción creada/rechazada, primera renovación, renovación exitosa y rechazada, reintento, cancelación, IPN duplicada y **fuera de orden**.

**Etapa 3 (web-core embebido)**
- [ ] Adaptar `POST /formtoken` para que devuelva lo que el SDK nuevo necesita (`authorization` = token de sesión, `keyRSA`): el patrón «el backend genera el token, el frontend lo incrusta» se mantiene.
- [ ] Cambiar el esquema de firma a `payloadHttp` + `signature` (base64) — **no reutilizar** el verificador de `kr-answer`/`kr-hash`.
- [ ] `container` en el DOM y coherencia entre el `mode` del script y el `typeForm`.
- [ ] Retirar el cliente de `micuentaweb` una vez verificado el nuevo, no antes.

---

## 3. Otras deudas registradas (no integraciones)

| # | Deuda | Motivo por el que se aplaza | Disparador |
|---|---|---|---|
| 1 | **Auditoría de rechazos de guard.** Los guards de Nest corren **antes** que los interceptores, así que un 401 de `JwtAuthGuard` o un 403 de `TenantGuard`/`PermissionsGuard` no se registran en `Auditoria`. El login fallido (401 del servicio) **sí** se registra | Exigiría registrar desde cada guard; el valor de negocio es bajo frente a la superficie que abre | Primer incidente de seguridad que requiera el rastro, o auditoría formal |
| 2 | **RLS en PostgreSQL** (ADR-006) | El aislamiento ya está probado a nivel de aplicación (33 tests). RLS con `service_role` es una segunda capa que exige rol dedicado y pruebas propias | Etapa 2 de crecimiento, cuando haya varias instancias |
| 3 | **Redis y colas** | Hoy no hace falta: hay un solo VPS y no existe ningún proceso en segundo plano | Etapa 2: se necesita para el cobro recurrente y para marcar cuotas vencidas |
| 4 | **`EstadoCuota.vencida` nunca se asigna** | Requiere el job del punto 3 | Junto con Redis y colas |
| 5 | **Secuencias: reciclado del código más alto.** La numeración usa el máximo numérico del periodo; borrar el código **más alto** reutiliza ese número | Exige una tabla de contadores con migración; el caso solo se da al borrar el último recibo | Volumen alto de comprobantes, o exigencia de correlatividad estricta |
| 6 | **`descarga` de documentos carga el archivo en memoria** | Es necesario para validar la firma antes de entregar el primer byte; el tope declarado es 20 MB | Documentos grandes (vídeos, series de RX completas) |
| 7 | **La subida exige `multipart` con todo el archivo en memoria** (`memoryStorage`) y no admite subidas reanudables | El tope es 20 MB y el archivo se valida por firma antes de escribir: trocearlo complicaría esa validación | Archivos muy grandes, o subida desde redes inestables |
| 8 | **Auditoría: la imagen previa no cubre todo.** `datosAnteriores` se captura leyendo la fila por el `:id` de la ruta, así que quedan sin imagen las mutaciones cuyo parámetro se llama distinto (`PATCH /api/subscriptions/:tenantId`) y los modelos sin `tenantId` (`User`, `WebhookEvent`) | Cubrirlos exige un mapeo por ruta y parámetro, y un criterio de pertenencia para modelos que no tienen `tenantId` | Necesidad de reconstruir el estado anterior de una suscripción o de un usuario |
| 9 | **La comprobación de secretos en la auditoría mira NOMBRES de clave, no valores.** `redactar` conserva la clave con `[REDACTADO]`, así que una aserción que busque el nombre de una columna sensible (p. ej. `datosSnapshot`) da falso positivo | Es una imprecisión de la prueba existente, no un fallo de redacción; cambiarla obliga a decidir si se prefiere omitir la clave o enmascararla | Cuando se auditen modelos clínicos con columnas sensibles (consentimientos) |
| 10 | **`TenantConfig.ciudad` tiene `@default("Huancayo")` en el esquema.** El alta ya acepta `ciudad`, pero si el panel no la envía, la clínica nace en Huancayo —la ciudad de la primera clínica, incrustada en el esquema— y esa ciudad sale impresa en los documentos | Quitar el valor por defecto exige una migración y decidir si la columna pasa a ser obligatoria; hoy el `select` del alta lo mitiga | Al dar de alta la primera clínica de otra ciudad, o al imprimir documentos de una clínica sin ciudad |
| 11 | **El rollback de la transacción de alta no está cubierto por una prueba.** `POST /platform/tenants` es un único `$transaction`, así que Prisma garantiza la atomicidad, pero nada lo comprueba: forzar un fallo a mitad exigiría un doble de Prisma o una carrera determinista | No es comprobable con e2e sin mocks, y la garantía la da el propio `$transaction` | Si el alta crece con más pasos (p. ej. logo, plantillas) y alguien introduce una escritura FUERA de la transacción |

---

## 4. Deuda por diseño (no es deuda)

Para que no se confunda con lo anterior:

- **La API es stateless y el rate limiting vive en memoria.** Con varias réplicas
  el límite efectivo se multiplica por el número de instancias. Está documentado en
  `src/core/auth/rate-limit.ts` y es correcto para la etapa 1.
- **La extensión Prisma no filtra `findUnique`/`update`/`delete` por id.** Es una
  consecuencia asumida de ADR-002; por eso cada servicio verifica la pertenencia y
  devuelve 404. Hay 33 pruebas de aislamiento que lo vigilan.
- **El pooler de Supabase y las migraciones** dependen de la configuración del
  hosting, no del código.
