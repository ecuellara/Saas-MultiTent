# Integración técnica de Izipay --- Pagos únicos y suscripciones

> **Documento técnico**
>
> Este documento resume una arquitectura recomendada para integrar
> Izipay/Micuentaweb mediante REST V4, utilizando SmartForm/Embedded
> Payment Form y separando claramente el flujo de **pago único** del
> flujo de **suscripción/recurrencia**.
>
> **Fuentes principales** - Documentación Izipay REST V4 --- SmartForm /
> Quick Start:
> https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/javascript/redirection/quick_start_smartform.html -
> Referencia API REST V4:
> https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/api/reference.html -
> Ejemplo oficial Izipay Embedded Payment Form React:
> https://github.com/izipay-pe/Embedded-PaymentForm-React - Ejemplo
> oficial Izipay Server Payment Form NodeJS:
> https://github.com/izipay-pe/Server-PaymentForm-NodeJS - Documentación
> técnica de tokenización/recurrencia de Lyra Collect:
> https://docs.lyra.com/content/lyradoc/en/collect/form-payment/subscription-token/tla1430209986491.pdf

------------------------------------------------------------------------

## 1. Objetivo

La integración debe permitir:

1.  Procesar pagos únicos con tarjeta mediante Izipay.
2.  Mostrar el formulario de pago de forma embebida en una aplicación
    web.
3.  Mantener las credenciales privadas exclusivamente en Backend.
4.  Validar la respuesta del pago antes de cambiar el estado de una
    orden.
5.  Recibir y procesar notificaciones IPN de servidor a servidor.
6.  Registrar un medio de pago mediante token cuando el negocio utilice
    suscripciones.
7.  Crear una suscripción utilizando un token previamente generado.
8.  Registrar cada renovación como una transacción independiente.
9.  Cancelar suscripciones desde Backend.
10. Mantener trazabilidad entre cliente, plan, suscripción, orden y
    transacciones.

------------------------------------------------------------------------

# 2. Arquitectura recomendada

La arquitectura recomendada es:

``` text
                  ┌─────────────────────────┐
                  │       FRONTEND          │
                  │ React / Vue / Next.js   │
                  └────────────┬────────────┘
                               │
                               │ HTTPS
                               ▼
                  ┌─────────────────────────┐
                  │        BACKEND          │
                  │ API / REST              │
                  │                         │
                  │ - Crear FormToken        │
                  │ - Validar respuesta      │
                  │ - Crear token            │
                  │ - Crear suscripción      │
                  │ - Cancelar suscripción   │
                  │ - Procesar IPN            │
                  └────────────┬────────────┘
                               │
                     HTTPS REST│
                               ▼
                  ┌─────────────────────────┐
                  │         IZIPAY          │
                  │ api.micuentaweb.pe      │
                  │                         │
                  │ Payment / Token /       │
                  │ Subscription / IPN      │
                  └─────────────────────────┘
```

El Frontend **no debe conocer**:

-   Usuario REST de Izipay.
-   Password REST.
-   HMAC/SHA-256 key.
-   Secretos de producción.
-   Credenciales utilizadas para consumir la API REST.

El Frontend únicamente recibe información necesaria para mostrar el
checkout, principalmente:

``` json
{
  "formToken": "...",
  "publicKey": "..."
}
```

El ejemplo oficial de Izipay para React sigue precisamente este patrón:
React solicita al Backend la creación del `formToken`, y el Backend se
comunica con Izipay. citeturn0view1

------------------------------------------------------------------------

# 3. Credenciales

Las credenciales se obtienen desde el Back Office del comercio.

Como mínimo, el Backend debe manejar de forma segura:

``` env
IZIPAY_USERNAME=...
IZIPAY_PASSWORD=...
IZIPAY_PUBLIC_KEY=...
IZIPAY_HMAC_SHA256_KEY=...
IZIPAY_ENV=TEST
```

Ejemplo:

``` text
IZIPAY_USERNAME=xxxxxxxx
IZIPAY_PASSWORD=xxxxxxxx
IZIPAY_PUBLIC_KEY=xxxxxxxx
IZIPAY_HMAC_SHA256_KEY=xxxxxxxx
IZIPAY_ENV=TEST
```

Nunca:

``` javascript
// NO HACER
const password = "mi-password-izipay";
```

ni:

``` javascript
// NO HACER
const hmacKey = "mi-clave-hmac";
```

en código que se entregue al navegador.

El repositorio oficial de Izipay indica expresamente que las claves del
Back Office deben configurarse exclusivamente en el servidor.
citeturn0view1

------------------------------------------------------------------------

# 4. Endpoints principales

Para REST V4, el endpoint utilizado por los ejemplos oficiales de Izipay
para crear el contexto de pago es:

``` text
POST https://api.micuentaweb.pe/api-payment/V4/Charge/CreatePayment
```

Este endpoint genera el `formToken` necesario para desplegar el
formulario de pago. citeturn10search0turn10search1

Para una arquitectura de suscripciones también se consideran operaciones
de tokenización y recurrencia:

``` text
POST /api-payment/V4/Charge/CreateToken
POST /api-payment/V4/Charge/CreateSubscription
POST /api-payment/V4/Subscription/Cancel
```

> **Importante:** la disponibilidad exacta de operaciones de
> tokenización/recurrencia, sus parámetros, límites y habilitación
> comercial deben verificarse en la configuración REST V4 del comercio y
> con Izipay antes de pasar a producción.

La documentación técnica de Lyra identifica específicamente
`Charge/CreateSubscription` para crear recurrencias utilizando un token
válido y `Subscription/Cancel` para cancelar una recurrencia.
citeturn8view0

------------------------------------------------------------------------

# 5. Flujo A --- Pago único

## 5.1. Flujo general

``` text
Cliente
   │
   │ 1. Selecciona productos
   ▼
Frontend
   │
   │ 2. POST /payments/form-token
   ▼
Backend
   │
   │ 3. POST Izipay /Charge/CreatePayment
   ▼
Izipay
   │
   │ 4. formToken
   ▼
Backend
   │
   │ 5. formToken + publicKey
   ▼
Frontend
   │
   │ 6. Renderiza SmartForm
   ▼
Izipay
   │
   │ 7. Cliente paga
   ▼
Frontend
   │
   │ 8. Resultado firmado
   ▼
Backend
   │
   │ 9. Validación
   ▼
Backend
   │
   │ 10. Actualiza orden
   ▼
Base de datos
```

Además, Izipay puede enviar una **IPN** directamente al Backend.

Por ello, el Frontend no debe considerarse la fuente definitiva del
estado de pago.

------------------------------------------------------------------------

# 6. Backend --- Crear FormToken

El Frontend puede llamar a un endpoint propio:

``` http
POST /api/payments/form-token
Content-Type: application/json
```

Ejemplo:

``` json
{
  "orderId": "ORD-20261005-00001",
  "amount": 59.90,
  "currency": "PEN",
  "customer": {
    "email": "cliente@example.com",
    "firstName": "Juan",
    "lastName": "Perez",
    "phoneNumber": "999999999",
    "identityType": "DNI",
    "identityCode": "12345678",
    "address": "Av. Ejemplo 123",
    "country": "PE",
    "city": "Lima",
    "state": "Lima",
    "zipCode": "15001"
  }
}
```

El Backend convierte el monto a la unidad mínima esperada por la API.

Ejemplo:

``` text
S/ 59.90
     ↓
5990
```

La integración oficial de Izipay para NodeJS utiliza `amount * 100` en
su ejemplo para generar el FormToken. citeturn10search1

------------------------------------------------------------------------

# 7. Request a Izipay

``` http
POST https://api.micuentaweb.pe/api-payment/V4/Charge/CreatePayment
Authorization: Basic BASE64(USERNAME:PASSWORD)
Content-Type: application/json
```

Ejemplo:

``` json
{
  "amount": 5990,
  "currency": "PEN",
  "orderId": "ORD-20261005-00001",
  "customer": {
    "email": "cliente@example.com",
    "billingDetails": {
      "firstName": "Juan",
      "lastName": "Perez",
      "phoneNumber": "999999999",
      "identityType": "DNI",
      "identityCode": "12345678",
      "address": "Av. Ejemplo 123",
      "country": "PE",
      "city": "Lima",
      "state": "Lima",
      "zipCode": "15001"
    }
  }
}
```

Respuesta conceptual:

``` json
{
  "status": "SUCCESS",
  "answer": {
    "formToken": "..."
  }
}
```

El Backend devuelve al Frontend únicamente:

``` json
{
  "formToken": "...",
  "publicKey": "..."
}
```

------------------------------------------------------------------------

# 8. React --- Integración del Embedded Payment Form

El ejemplo oficial utiliza:

``` bash
git clone https://github.com/izipay-pe/Embedded-PaymentForm-React.git
```

e instala las dependencias:

``` bash
npm install
```

Para ejecutar:

``` bash
npm run dev
```

El repositorio oficial utiliza:

``` javascript
import KRGlue from '@lyracom/embedded-form-glue';
```

y carga la librería mediante:

``` javascript
KRGlue.loadLibrary(endpoint, publicKey)
```

Posteriormente configura el formulario con:

``` javascript
KR.setFormConfig({
  formToken,
  'kr-language': 'es-ES'
});
```

y lo monta mediante:

``` javascript
KR.attachForm('#micuentawebstd_rest_wrapper')
```

El ejemplo oficial de Izipay documenta exactamente este flujo.
citeturn0view1

------------------------------------------------------------------------

# 9. Estructura React recomendada

``` text
src/
├── components/
│   ├── PaymentForm.jsx
│   ├── Checkout.jsx
│   └── PaymentResult.jsx
│
├── services/
│   └── paymentService.js
│
└── App.jsx
```

## paymentService.js

``` javascript
import axios from "axios";

export async function createFormToken(data) {
  const response = await axios.post(
    "/api/payments/form-token",
    data
  );

  return response.data;
}
```

## PaymentForm.jsx

``` javascript
const handleSubmit = async (event) => {
  event.preventDefault();

  const response = await createFormToken({
    orderId,
    amount,
    currency: "PEN",
    customer
  });

  navigate("/checkout", {
    state: response
  });
};
```

------------------------------------------------------------------------

# 10. Checkout.jsx

Conceptualmente:

``` javascript
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import KRGlue from "@lyracom/embedded-form-glue";

export default function Checkout() {
  const { state } = useLocation();

  const { formToken, publicKey } = state;

  useEffect(() => {
    const endpoint = "https://static.micuentaweb.pe";

    KRGlue.loadLibrary(endpoint, publicKey)
      .then(({ KR }) => {

        KR.setFormConfig({
          formToken,
          "kr-language": "es-ES"
        });

        return KR.attachForm(
          "#micuentawebstd_rest_wrapper"
        );
      })
      .then(({ KR, result }) => {
        KR.showForm(result.formId);
      });

  }, [formToken, publicKey]);

  return (
    <div id="micuentawebstd_rest_wrapper">
      <div className="kr-embedded"></div>
    </div>
  );
}
```

El HTML debe contener:

``` html
<div id="micuentawebstd_rest_wrapper">
    <div class="kr-embedded"></div>
</div>
```

El ejemplo oficial también incluye los recursos CSS/JS de Krypton para
el formulario embebido. citeturn0view1

------------------------------------------------------------------------

# 11. Validación del resultado

El resultado recibido por JavaScript no debe considerarse
automáticamente como pago confirmado.

El ejemplo oficial utiliza:

``` javascript
KR.onSubmit(paymentData => {

  axios.post("/api/payments/validate", {
    "kr-answer": paymentData.rawClientAnswer,
    "kr-hash": paymentData.hash
  });

  return false;
});
```

El Backend debe:

1.  Recibir `kr-answer`.
2.  Recibir `kr-hash`.
3.  Validar la firma.
4.  Analizar el estado de la transacción.
5.  Comparar la operación contra la orden interna.
6.  Actualizar la orden.
7.  Responder al Frontend.

Izipay utiliza la validación de firma para garantizar la integridad de
los datos. citeturn1view0

------------------------------------------------------------------------

# 12. IPN --- Instant Payment Notification

La IPN es una comunicación:

``` text
Izipay
   │
   │ HTTP POST
   ▼
Backend del comercio
```

No depende de que el usuario permanezca en la página.

Debe existir un endpoint como:

``` http
POST /api/payments/ipn
```

Ejemplo:

``` text
https://api.midominio.com/api/payments/ipn
```

El Backend debe:

``` text
IPN
 │
 ├── Validar firma
 │
 ├── Identificar orden/transacción
 │
 ├── Validar importe
 │
 ├── Validar moneda
 │
 ├── Validar estado
 │
 ├── Registrar evento
 │
 └── Actualizar estado de la orden
```

El ejemplo oficial de Izipay identifica la IPN como una comunicación
servidor a servidor y recomienda configurarla en Backend.
citeturn1view0

------------------------------------------------------------------------

# 13. Regla crítica para el estado del pago

No hacer:

``` javascript
// INCORRECTO
if (frontendPaymentSuccess) {
    order.status = "PAID";
}
```

Preferir:

``` text
Frontend
   │
   ├── resultado visual
   │
   ▼
Backend
   │
   ├── validación de firma
   ├── validación de importe
   ├── validación de orden
   └── confirmación/IPN
          │
          ▼
       PAID
```

La IPN debe tratarse como parte esencial de la conciliación.

------------------------------------------------------------------------

# 14. Flujo B --- Suscripciones

Una suscripción tiene una arquitectura diferente.

No se recomienda almacenar:

``` text
Número de tarjeta
CVV
Fecha completa de tarjeta
```

El modelo recomendado es:

``` text
Cliente
   │
   │ paga / registra tarjeta
   ▼
Izipay
   │
   │ token
   ▼
Backend
   │
   ├── paymentMethodToken
   │
   └── subscriptionId
```

La documentación de tokenización de Lyra indica que el gateway almacena
los datos sensibles del medio de pago y que el comercio trabaja con un
token. citeturn5view0

------------------------------------------------------------------------

# 15. Modelo conceptual de una suscripción

``` text
CUSTOMER
   │
   └── PAYMENT_METHOD_TOKEN
              │
              ▼
        SUBSCRIPTION
              │
              ├── Plan
              ├── Amount
              ├── Currency
              ├── Frequency
              ├── Effect date
              ├── Status
              └── Subscription ID
                       │
                       ▼
                 TRANSACTIONS
                 ├── #1
                 ├── #2
                 ├── #3
                 └── ...
```

Una suscripción no debería confundirse con una sola transacción.

Debe existir una relación:

``` text
1 Customer
   │
   └── N Subscriptions
             │
             └── N Transactions
```

------------------------------------------------------------------------

# 16. Dos estrategias para suscripciones

## Estrategia 1 --- Registrar tarjeta y crear suscripción

``` text
Cliente
   │
   │ registra tarjeta
   ▼
Izipay
   │
   │ crea token
   ▼
Backend
   │
   │ guarda token
   ▼
Backend
   │
   │ CreateSubscription
   ▼
Izipay
   │
   │ subscriptionId
   ▼
Backend
```

## Estrategia 2 --- Crear suscripción utilizando token existente

Si el cliente ya tiene un token válido:

``` text
Frontend
   │
   │ selecciona plan
   ▼
Backend
   │
   │ paymentMethodToken
   │ amount
   │ currency
   │ effectDate
   │ rrule
   ▼
Izipay
   │
   │ subscriptionId
   ▼
Backend
```

La documentación de Lyra identifica el caso de crear una recurrencia
usando un token existente mediante `Charge/CreateSubscription`.
citeturn8view0

------------------------------------------------------------------------

# 17. Tokenización

La tokenización debe ser gestionada por Izipay.

Conceptualmente:

``` http
POST /api-payment/V4/Charge/CreateToken
```

El resultado esperado debe contener un identificador de medio de
pago/token.

Ese token se almacena en la base de datos como referencia técnica.

Ejemplo conceptual:

``` json
{
  "customerId": "CUS-10001",
  "paymentMethodToken": "xxxxxxxxxxxxxxxx"
}
```

Nunca guardar:

``` json
{
  "cardNumber": "4111111111111111",
  "cvv": "123"
}
```

------------------------------------------------------------------------

# 18. Crear una suscripción

El flujo conceptual es:

``` http
POST /api-payment/V4/Charge/CreateSubscription
```

Ejemplo conceptual:

``` json
{
  "amount": "4990",
  "currency": "PEN",
  "effectDate": "2026-11-01T00:00:00-05:00",
  "paymentMethodToken": "TOKEN_IZIPAY",
  "rrule": "RRULE:FREQ=MONTHLY;INTERVAL=1",
  "orderId": "SUB-10001"
}
```

La documentación de Lyra define:

-   `amount`: importe de la recurrencia.
-   `currency`: moneda.
-   `effectDate`: fecha de inicio.
-   `paymentMethodToken`: token que será debitado.
-   `rrule`: regla de recurrencia.
-   `orderId`: referencia de la operación.

El ejemplo oficial de Web Services utiliza precisamente estos conceptos
y devuelve un `subscriptionId` cuando la creación es exitosa.
citeturn9search36turn9search37

> **Nota para Izipay Perú:** confirmar en el contrato/Back Office que la
> funcionalidad de pagos recurrentes y las operaciones REST
> correspondientes están habilitadas para el comercio.

------------------------------------------------------------------------

# 19. Reglas RRULE

La recurrencia se define utilizando una regla basada en
iCalendar/RFC5545.

Ejemplo mensual:

``` text
RRULE:FREQ=MONTHLY;INTERVAL=1
```

Cada semana:

``` text
RRULE:FREQ=WEEKLY;INTERVAL=1
```

Cada 2 semanas:

``` text
RRULE:FREQ=WEEKLY;INTERVAL=2
```

Cada 3 meses:

``` text
RRULE:FREQ=MONTHLY;INTERVAL=3
```

12 meses:

``` text
RRULE:FREQ=MONTHLY;COUNT=12
```

El gateway permite reglas diarias, semanales y mensuales, así como
definir días concretos del mes. citeturn7view0

------------------------------------------------------------------------

# 20. Fecha de inicio

El campo conceptual:

``` text
effectDate
```

determina cuándo empieza la recurrencia.

Debe manejarse con especial cuidado para evitar:

-   doble cobro.
-   primera cuota inesperada.
-   fecha en pasado.
-   diferencias de zona horaria.

La documentación indica que la fecha de efecto debe ser válida y que en
determinados flujos se recomienda iniciar la recurrencia después de la
creación para evitar duplicidad de pagos. citeturn7view0turn8view1

------------------------------------------------------------------------

# 21. Crear suscripción desde un plan SaaS

Para un SaaS, es recomendable que Izipay no sea quien determine el plan
comercial.

La aplicación debe tener:

``` text
PLAN
├── id
├── name
├── price
├── currency
├── interval
├── interval_count
└── active
```

Ejemplo:

``` json
{
  "id": "PRO",
  "name": "Plan Pro",
  "price": 49.90,
  "currency": "PEN",
  "interval": "MONTH",
  "intervalCount": 1
}
```

El Backend traduce:

``` text
Plan Pro
   │
   ├── price = 49.90
   ├── currency = PEN
   ├── interval = MONTH
   └── intervalCount = 1
              │
              ▼
          RRULE
              │
              ▼
RRULE:FREQ=MONTHLY;INTERVAL=1
```

El cliente nunca debería enviar libremente:

``` json
{
  "amount": 0.01
}
```

para modificar el precio.

El Backend debe obtener el precio desde el plan almacenado.

------------------------------------------------------------------------

# 22. Modelo de datos recomendado

## customers

``` text
id
email
first_name
last_name
status
created_at
updated_at
```

## payment_methods

``` text
id
customer_id
provider
provider_token
brand
last4
expiry_month
expiry_year
status
created_at
updated_at
```

## plans

``` text
id
code
name
description
amount
currency
interval
interval_count
active
created_at
updated_at
```

## subscriptions

``` text
id
customer_id
plan_id
provider
provider_subscription_id
payment_method_id
status
amount
currency
effect_date
rrule
started_at
next_payment_at
ended_at
cancelled_at
created_at
updated_at
```

## payments

``` text
id
customer_id
subscription_id
order_id
provider
provider_transaction_id
amount
currency
status
payment_type
paid_at
failure_code
failure_message
created_at
updated_at
```

## payment_events

``` text
id
provider
event_type
external_id
payload
signature_valid
processed
processed_at
created_at
```

------------------------------------------------------------------------

# 23. Estados recomendados

## Payment

``` text
PENDING
AUTHORIZED
CAPTURED
PAID
REFUSED
CANCELLED
REFUNDED
ERROR
```

## Subscription

``` text
PENDING
ACTIVE
PAST_DUE
CANCELLED
EXPIRED
FAILED
```

No depender exclusivamente de los nombres de estado de la pasarela.

Se recomienda tener:

``` text
provider_status
```

y un:

``` text
internal_status
```

Ejemplo:

``` text
Izipay:
CAPTURED

Sistema:
PAID
```

------------------------------------------------------------------------

# 24. Cancelación de suscripción

El Backend debe exponer algo como:

``` http
POST /api/subscriptions/{id}/cancel
```

El Backend localiza:

``` text
subscription.provider_subscription_id
```

y solicita a Izipay:

``` text
Subscription/Cancel
```

La documentación de Lyra identifica esta operación específicamente para
cancelar una recurrencia. citeturn8view0

No permitir que el Frontend envíe directamente el:

``` text
provider_subscription_id
```

sin validar que pertenezca al usuario autenticado.

------------------------------------------------------------------------

# 25. IPN para suscripciones

Las suscripciones necesitan un tratamiento adicional.

Debe distinguirse:

``` text
IPN
│
├── Creación de suscripción
│
├── Renovación exitosa
│
├── Renovación rechazada
│
├── Nuevo intento
│
├── Cancelación
│
└── Otros eventos
```

La documentación de Lyra indica que las notificaciones IPN pueden
configurarse para la creación de una recurrencia y para nuevas
cuotas/intentos de pago de una recurrencia. citeturn4search3

------------------------------------------------------------------------

# 26. Procesamiento idempotente de IPN

Este punto es obligatorio para una implementación robusta.

Supongamos:

``` text
Izipay → IPN
```

y el mismo evento llega dos veces.

El Backend no debe generar dos pagos.

Usar una clave idempotente:

``` text
provider + external_transaction_id + event_type
```

Ejemplo:

``` text
izipay:TX123456:PAYMENT_ACCEPTED
```

Antes de procesar:

``` sql
SELECT id
FROM payment_events
WHERE provider = 'izipay'
  AND external_id = 'TX123456'
  AND event_type = 'PAYMENT_ACCEPTED';
```

Si existe:

``` text
NO volver a procesar.
```

------------------------------------------------------------------------

# 27. Seguridad

## Obligatorio

-   HTTPS.
-   Secrets únicamente en Backend.
-   Validación de firma.
-   Validación de importe.
-   Validación de moneda.
-   Validación de `orderId`.
-   Validación de usuario/cliente.
-   Idempotencia.
-   Logs técnicos.
-   No registrar PAN/CVV.
-   No devolver credenciales al Frontend.
-   Rate limiting en endpoints sensibles.
-   Protección contra replay cuando corresponda.
-   Validación estricta de IPN.

------------------------------------------------------------------------

# 28. Firma / HMAC

En las integraciones REST/SmartForm existen mecanismos de firma para
garantizar la integridad de la información.

Para el protocolo clásico basado en campos `vads_`, la documentación
indica:

1.  Tomar los campos `vads_`.
2.  Ordenarlos alfabéticamente.
3.  Codificar en UTF-8.
4.  Concatenarlos con `+`.
5.  Añadir la clave.
6.  Calcular la firma.
7.  Utilizar HMAC-SHA-256 cuando esté configurado.

La documentación recomienda HMAC-SHA-256 para nuevas configuraciones y
considera SHA-1 como tecnología heredada. citeturn7view1

En REST V4 moderno, seguir siempre el mecanismo de validación indicado
específicamente por la documentación de Izipay para la respuesta
`kr-answer`/`kr-hash` y para la IPN.

------------------------------------------------------------------------

# 29. Diferencia entre SmartForm, Embedded y Redirect

## Embedded

El checkout se muestra dentro de la aplicación:

``` text
Tu Web
┌───────────────────────────────┐
│ Producto                      │
│                               │
│ ┌───────────────────────────┐ │
│ │ Izipay Payment Form       │ │
│ │                           │ │
│ │ Card                      │ │
│ │ Expiration                │ │
│ │ CVV                       │ │
│ │                           │ │
│ └───────────────────────────┘ │
└───────────────────────────────┘
```

Es el enfoque utilizado por:

``` text
Embedded-PaymentForm-React
```

## Redirect

El usuario es enviado a la página de pago y luego retorna al comercio.

Conceptualmente:

``` text
Tienda
  │
  ▼
Izipay
  │
  ▼
Pago
  │
  ▼
Tienda
```

La URL proporcionada en la documentación del usuario corresponde al
flujo SmartForm/Redirection.

## Recomendación

Para:

``` text
React / Vue / SPA
```

usar Embedded cuando el objetivo sea una experiencia integrada.

Para:

``` text
checkout simple
integración tradicional
```

Redirect puede ser suficiente.

La confirmación definitiva del pago debe mantenerse en Backend en ambos
casos.

------------------------------------------------------------------------

# 30. Ejemplo oficial React

Repositorio:

``` text
https://github.com/izipay-pe/Embedded-PaymentForm-React
```

Flujo del ejemplo:

``` text
Formulario React
      │
      │ POST /formtoken
      ▼
Backend
      │
      │ CreatePayment
      ▼
Izipay
      │
      │ formToken
      ▼
Backend
      │
      │ formToken + publicKey
      ▼
React Checkout
      │
      │ KRGlue
      ▼
Embedded Form
      │
      │ pago
      ▼
KR.onSubmit
      │
      │ /validate
      ▼
Backend
```

El repositorio oficial también documenta el uso de:

``` javascript
KR.onSubmit(...)
```

para enviar `kr-answer` y `kr-hash` al servidor y validar la respuesta.
citeturn0view1

------------------------------------------------------------------------

# 31. API propia recomendada

Para un proyecto real:

``` text
POST   /api/payments/form-token
POST   /api/payments/validate
POST   /api/payments/ipn

POST   /api/payment-methods/tokenize

POST   /api/subscriptions
GET    /api/subscriptions/:id
POST   /api/subscriptions/:id/cancel

GET    /api/payments/:id
GET    /api/orders/:id
```

------------------------------------------------------------------------

# 32. Crear suscripción --- API propia

Request:

``` http
POST /api/subscriptions
Authorization: Bearer <user-token>
Content-Type: application/json
```

``` json
{
  "planId": "PRO",
  "paymentMethodId": "PM_10001"
}
```

El Backend:

``` text
1. Autentica usuario
2. Busca plan
3. Verifica precio
4. Busca paymentMethod
5. Verifica propietario
6. Obtiene provider_token
7. Construye RRULE
8. Define effectDate
9. Consume Izipay
10. Guarda subscriptionId
11. Responde
```

Respuesta:

``` json
{
  "id": "SUB_10001",
  "status": "ACTIVE",
  "plan": "PRO",
  "amount": 49.90,
  "currency": "PEN"
}
```

------------------------------------------------------------------------

# 33. Pseudocódigo Backend

``` javascript
async function createSubscription(userId, planId, paymentMethodId) {

  const plan = await plans.findById(planId);

  if (!plan || !plan.active) {
    throw new Error("PLAN_NOT_AVAILABLE");
  }

  const paymentMethod =
    await paymentMethods.findById(paymentMethodId);

  if (!paymentMethod) {
    throw new Error("PAYMENT_METHOD_NOT_FOUND");
  }

  if (paymentMethod.customerId !== userId) {
    throw new Error("FORBIDDEN");
  }

  const rrule = buildRRule(
    plan.interval,
    plan.intervalCount
  );

  const effectDate = calculateEffectDate();

  const response = await izipay.createSubscription({
    amount: toMinorUnits(plan.amount),
    currency: plan.currency,
    effectDate,
    paymentMethodToken:
      paymentMethod.providerToken,
    rrule,
    orderId: generateOrderId()
  });

  if (!response.subscriptionId) {
    throw new Error("SUBSCRIPTION_CREATION_FAILED");
  }

  return saveSubscription({
    userId,
    planId,
    paymentMethodId,
    providerSubscriptionId:
      response.subscriptionId,
    status: "ACTIVE"
  });
}
```

------------------------------------------------------------------------

# 34. Servicio Izipay

Se recomienda encapsular Izipay:

``` text
services/
└── izipay/
    ├── izipay.client.js
    ├── izipay.payment.js
    ├── izipay.token.js
    ├── izipay.subscription.js
    └── izipay.webhook.js
```

Ejemplo:

``` javascript
class IzipayClient {

  async createPayment(data) {}

  async createToken(data) {}

  async createSubscription(data) {}

  async cancelSubscription(data) {}

  async validatePayment(data) {}

  async processIPN(data) {}
}
```

Esto evita distribuir llamadas a Izipay por todo el sistema.

------------------------------------------------------------------------

# 35. Manejo de errores

Se recomienda separar:

``` text
ERROR DEL NEGOCIO
ERROR DE IZIPAY
ERROR DE RED
ERROR DE VALIDACIÓN
ERROR DE CONFIGURACIÓN
```

Ejemplo:

``` json
{
  "code": "PAYMENT_PROVIDER_ERROR",
  "message": "No fue posible procesar el pago",
  "traceId": "REQ-123456"
}
```

No devolver:

``` json
{
  "password": "...",
  "hmac": "...",
  "rawProviderCredentials": "..."
}
```

------------------------------------------------------------------------

# 36. Logging

Registrar:

``` text
traceId
orderId
customerId
subscriptionId
providerTransactionId
providerStatus
internalStatus
amount
currency
createdAt
```

No registrar:

``` text
PAN
CVV
API password
HMAC secret
```

El payload completo de IPN debe tratarse con cuidado y, si se almacena,
debe aplicarse política de retención y protección de información.

------------------------------------------------------------------------

# 37. Pruebas

## Pago único

Probar:

``` text
✓ Pago aprobado
✓ Pago rechazado
✓ Usuario abandona
✓ Timeout
✓ FormToken inválido
✓ Firma inválida
✓ IPN repetida
✓ IPN tardía
✓ Orden inexistente
✓ Monto incorrecto
✓ Moneda incorrecta
```

## Suscripción

Probar:

``` text
✓ Token creado
✓ Token inválido
✓ Suscripción creada
✓ Suscripción rechazada
✓ Primera renovación
✓ Renovación exitosa
✓ Renovación rechazada
✓ Reintento
✓ Cancelación
✓ IPN duplicada
✓ IPN fuera de orden
✓ Token expirado
```

El repositorio oficial de Izipay recomienda realizar pruebas antes de
producción y proporciona mecanismos/tarjetas de prueba para el entorno
TEST. citeturn1view0

------------------------------------------------------------------------

# 38. Checklist de producción

## Izipay

``` text
[ ] Credenciales TEST configuradas
[ ] Credenciales PRODUCCIÓN configuradas
[ ] Public Key correcta
[ ] HMAC configurado
[ ] Funcionalidad de recurrencia habilitada
[ ] IPN configurada
[ ] URL HTTPS
[ ] Dominio autorizado/configurado si corresponde
```

## Backend

``` text
[ ] Secrets fuera del repositorio
[ ] Variables de entorno
[ ] Validación de firma
[ ] Idempotencia
[ ] Logs
[ ] Manejo de errores
[ ] Timeouts
[ ] Retry controlado
[ ] Rate limiting
```

## Base de datos

``` text
[ ] orders
[ ] payments
[ ] payment_methods
[ ] subscriptions
[ ] payment_events
[ ] índices
[ ] claves únicas
```

## Frontend

``` text
[ ] No contiene secrets
[ ] Solo recibe formToken/publicKey
[ ] Maneja cancelación
[ ] Maneja rechazo
[ ] Maneja timeout
[ ] No confirma pago únicamente por UI
```

------------------------------------------------------------------------

# 39. Recomendación específica para un SaaS

Si esta integración se utilizará dentro de un SaaS, recomiendo separar
tres conceptos:

``` text
             ┌─────────────┐
             │    PLAN     │
             └──────┬──────┘
                    │
                    ▼
             ┌─────────────┐
             │SUBSCRIPTION │
             └──────┬──────┘
                    │
                    ▼
             ┌─────────────┐
             │  PAYMENTS   │
             └─────────────┘
```

Por ejemplo:

``` text
PLAN
PRO
S/49.90 mensual

SUBSCRIPTION
SUB-10001
Cliente: CUS-10001
Plan: PRO
Izipay: SUB12345

PAYMENT
PAY-10001
S/49.90
2026-11-01
PAID
```

En cada renovación:

``` text
SUB-10001
    │
    ├── PAY-10001
    ├── PAY-10002
    ├── PAY-10003
    └── PAY-10004
```

Esto permite cambiar planes, cancelar, reintentar pagos y generar
reportes sin mezclar la suscripción con una única transacción.

------------------------------------------------------------------------

# 40. Arquitectura final recomendada

``` text
                    ┌──────────────────┐
                    │     FRONTEND     │
                    │ React / Vue      │
                    └────────┬─────────┘
                             │
                             │ HTTPS
                             ▼
              ┌─────────────────────────────┐
              │           API                │
              │                              │
              │ /payments/form-token         │
              │ /payments/validate           │
              │ /payments/ipn                │
              │ /payment-methods/tokenize    │
              │ /subscriptions               │
              │ /subscriptions/:id/cancel   │
              └──────────────┬──────────────┘
                             │
             ┌───────────────┼────────────────┐
             │               │                │
             ▼               ▼                ▼
       ┌──────────┐    ┌───────────┐   ┌─────────────┐
       │ Database │    │ Izipay    │   │ Queue/Jobs  │
       │          │    │ REST V4   │   │             │
       └──────────┘    └───────────┘   └─────────────┘
                             │
                             │ IPN
                             ▼
                    ┌─────────────────┐
                    │ Payment Events  │
                    └─────────────────┘
```

------------------------------------------------------------------------

# 41. Resumen de responsabilidades

  Componente   Responsabilidad
  ------------ -----------------------------------------
  Frontend     Mostrar checkout y UX
  Backend      Integrar Izipay
  Backend      Crear FormToken
  Backend      Validar respuestas
  Backend      Procesar IPN
  Backend      Tokenización
  Backend      Crear/cancelar suscripciones
  DB           Ordenes y transacciones
  DB           Tokens/referencias
  DB           Suscripciones
  Izipay       Procesamiento del pago
  Izipay       Almacenamiento seguro del medio de pago
  Izipay       Ejecución de recurrencias
  IPN          Sincronización de estados

------------------------------------------------------------------------

# 42. Fuentes y referencias

### Documentación Izipay

SmartForm / Quick Start:

https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/javascript/redirection/quick_start_smartform.html

Referencia API REST V4:

https://secure.micuentaweb.pe/doc/es-PE/rest/V4.0/api/reference.html

### Ejemplo React oficial

https://github.com/izipay-pe/Embedded-PaymentForm-React

### Backend NodeJS oficial

https://github.com/izipay-pe/Server-PaymentForm-NodeJS

### Documentación tokenización y recurrencia

https://docs.lyra.com/content/lyradoc/en/collect/form-payment/subscription-token/tla1430209986491.pdf

------------------------------------------------------------------------

# 43. Nota de implementación

Este documento está pensado como **base técnica de arquitectura**, no
como sustituto de la especificación contractual del comercio.

En particular, antes de implementar suscripciones en producción se debe
confirmar con Izipay:

1.  Que la funcionalidad de recurrencia está habilitada para el
    comercio.
2.  Qué métodos de pago pueden utilizarse para recurrencia en el MID
    correspondiente.
3.  Qué endpoints REST V4 están habilitados.
4.  Qué parámetros exactos requiere la versión actual de la API.
5.  Qué reglas aplican para `effectDate`.
6.  Qué eventos IPN están habilitados.
7.  Qué mecanismo de autenticación y firma debe utilizarse para cada
    operación.
8.  Qué condiciones comerciales/regulatorias aplican al cobro
    recurrente.

El ejemplo React oficial es especialmente útil como referencia para el
**Embedded Payment Form**, mientras que la parte de suscripciones debe
diseñarse alrededor del concepto de **token + subscription +
transaction + IPN**, no como una simple modificación del pago único.
