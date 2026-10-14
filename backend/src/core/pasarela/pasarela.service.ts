import { BadGatewayException, GatewayTimeoutException, Injectable, Logger } from '@nestjs/common';
import { configuracion } from './pasarela.js';

export interface CompradorIzipay {
  email?: string;
  nombre?: string;
  telefono?: string;
  tipoDoc?: string;
  numDoc?: string;
  direccion?: string;
}

export interface CrearFormToken {
  importeCentimos: number;
  moneda: string;
  orderId: string;
  metadata: Record<string, unknown>;
  descripcion?: string;
  comprador?: CompradorIzipay;
}

/**
 * Transporte REST V4: crea el `formToken` en Izipay. No persiste nada ni sabe
 * qué se está cobrando; el llamador guarda su propio intento para conciliar.
 */
@Injectable()
export class PasarelaService {
  private readonly logger = new Logger(PasarelaService.name);

  async crearFormToken(args: CrearFormToken): Promise<{ formToken: string; publicKey: string }> {
    const config = configuracion();
    const { importeCentimos: amount, moneda: currency, orderId, metadata, descripcion, comprador } = args;
    const metaEnvio = { ...metadata, ...(descripcion ? { descripcion } : {}) };
    try {
      const respuesta = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api-payment/V4/Charge/CreatePayment`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${config.shopId}:${config.clave}`).toString('base64')}` },
        body: JSON.stringify({ amount, currency, orderId, metadata: metaEnvio,
          ...(comprador ? { customer: {
            ...(comprador.email ? { email: comprador.email } : {}),
            billingDetails: {
              ...(comprador.nombre ? { firstName: comprador.nombre } : {}),
              ...(comprador.telefono ? { phoneNumber: comprador.telefono } : {}),
              ...(comprador.tipoDoc ? { identityType: comprador.tipoDoc } : {}),
              ...(comprador.numDoc ? { identityCode: comprador.numDoc } : {}),
              ...(comprador.direccion ? { address: comprador.direccion } : {}),
              country: 'PE',
            },
          } } : {}),
        }),
      });
      if (respuesta.status === 401 || respuesta.status === 403) {
        this.logger.warn({ operacion: 'CreatePayment', httpStatus: respuesta.status, motivo: 'autenticacion_rest' });
        throw new BadGatewayException('Izipay rechazó la autenticación REST. Revise IZIPAY_SHOP_ID e IZIPAY_CLAVE');
      }
      const data = await respuesta.json() as { status?: string; answer?: { formToken?: string; errorCode?: unknown } } | null;
      if (!respuesta.ok || data?.status !== 'SUCCESS' || typeof data.answer?.formToken !== 'string' || !data.answer.formToken) {
        // No volcar la respuesta ni mensajes arbitrarios del proveedor: pueden
        // contener datos personales, tokens o la entrada rechazada.
        const codigo = typeof data?.answer?.errorCode === 'string' && /^[A-Z0-9_]{1,40}$/.test(data.answer.errorCode)
          ? data.answer.errorCode : undefined;
        this.logger.warn({ operacion: 'CreatePayment', httpStatus: respuesta.status, codigo: codigo ?? 'RESPUESTA_INVALIDA' });
        throw new BadGatewayException(`Izipay no pudo crear el formulario${codigo ? ` (código ${codigo})` : ''}. Revise la configuración del comercio`);
      }
      return { formToken: data.answer.formToken, publicKey: config.publicKey };
    } catch (e) {
      if (e instanceof BadGatewayException) throw e;
      if (e instanceof Error && e.name === 'TimeoutError') {
        this.logger.warn({ operacion: 'CreatePayment', motivo: 'timeout' });
        throw new GatewayTimeoutException('Izipay demoró demasiado en responder. Vuelva a intentar preparar el formulario');
      }
      this.logger.warn({ operacion: 'CreatePayment', motivo: e instanceof SyntaxError ? 'respuesta_no_json' : 'conexion' });
      throw new BadGatewayException('No se pudo comunicar con Izipay o su respuesta no fue válida; vuelva a intentar');
    }
  }
}
