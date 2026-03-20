import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';

// ── RESPUESTA DE NUBEFACT ────────────────────────────────────────────────────
export interface NubefactResponse {
    accepted: boolean;
    sunatStatus: string;       // 'ACEPTADO' | 'RECHAZADO' | 'EN_PROCESO'
    sunatCode: string;         // '0' = éxito
    sunatDescription: string;  // Descripción legible
    cdrContent?: string;       // CDR en base64 (constancia de recepción)
    sunatHash?: string;        // Hash del XML firmado
}

@Injectable()
export class NubefactService {
    private readonly logger = new Logger(NubefactService.name);

    // ── URLs de Nubefact ─────────────────────────────────────────────────────
    // Demo:       https://demo-ose.nubefact.com/ol-ti-itcpe/resources/invoiceSender
    // Producción: https://ose.nubefact.com/ol-ti-itcpe/resources/invoiceSender
    //
    // Variable de entorno NUBEFACT_MODE: 'demo' | 'produccion'
    // Variable de entorno NUBEFACT_TOKEN: tu token de API de Nubefact
    // Variable de entorno NUBEFACT_RUC: RUC registrado en Nubefact

    private get baseUrl(): string {
        const mode = process.env.NUBEFACT_MODE || 'demo';
        return mode === 'produccion'
            ? 'https://ose.nubefact.com/ol-ti-itcpe/resources/invoiceSender'
            : 'https://demo-ose.nubefact.com/ol-ti-itcpe/resources/invoiceSender';
    }

    constructor(private readonly httpService: HttpService) {}

    // ── ENVIAR COMPROBANTE A SUNAT VIA NUBEFACT ──────────────────────────────
    // Nubefact recibe el XML en base64, lo firma con su certificado bajo tu RUC
    // y lo envía a SUNAT. Retorna el CDR (Constancia de Recepción).
    async enviarComprobante(
        xmlContent: string,         // XML UBL 2.1 sin firmar
        tipoComprobante: '01' | '03', // 01=Factura, 03=Boleta
        serie: string,               // F001 o B001
        correlativo: number,
        rucEmisor: string
    ): Promise<NubefactResponse> {

        if (!process.env.NUBEFACT_TOKEN) {
            this.logger.warn('NUBEFACT_TOKEN no configurado — simulando SUNAT aceptado.');
            return {
                accepted: true,
                sunatStatus: 'ACEPTADO',
                sunatCode: '0',
                sunatDescription: 'Simulación (NUBEFACT_TOKEN no configurado)',
            };
        }

        const correlativoStr = correlativo.toString().padStart(8, '0');
        // Nombre del archivo según convención SUNAT: RUC-TipoDoc-Serie-Correlativo
        const nombreArchivo = `${rucEmisor}-${tipoComprobante}-${serie}-${correlativoStr}`;

        // Nubefact espera el XML en base64
        const xmlBase64 = Buffer.from(xmlContent, 'utf-8').toString('base64');

        const payload = {
            operacion: 'generar_comprobante',
            tipo_de_comprobante: parseInt(tipoComprobante),
            serie: serie,
            numero: correlativo,
            ruc: rucEmisor,
            archivo_xml: xmlBase64,
        };

        try {
            this.logger.log(`Enviando ${nombreArchivo} a Nubefact (${process.env.NUBEFACT_MODE || 'demo'})...`);

            const response = await lastValueFrom(
                this.httpService.post(this.baseUrl, payload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${process.env.NUBEFACT_TOKEN}`,
                    },
                    timeout: 30000,
                })
            );

            const data = response.data;
            this.logger.log(`Respuesta Nubefact: ${JSON.stringify(data)}`);

            // Nubefact retorna: aceptado_por_sunat, codigo_sunat, descripcion_sunat, cdr_b64
            const accepted = data.aceptado_por_sunat === true;

            return {
                accepted,
                sunatStatus: accepted ? 'ACEPTADO' : 'RECHAZADO',
                sunatCode: String(data.codigo_sunat || ''),
                sunatDescription: data.descripcion_sunat || '',
                cdrContent: data.cdr_b64 || null,
                sunatHash: data.hash_cpe || null,
            };

        } catch (error: any) {
            const errData = error?.response?.data;

            // Si Nubefact rechaza por error de negocio (ej. RUC inválido),
            // retornamos el error sin lanzar excepción para no bloquear la venta
            if (errData) {
                this.logger.warn(`Nubefact rechazó el comprobante: ${JSON.stringify(errData)}`);
                return {
                    accepted: false,
                    sunatStatus: 'RECHAZADO',
                    sunatCode: String(errData.codigo_sunat || 'ERR'),
                    sunatDescription: this.traducirError(
                        errData.codigo_sunat,
                        errData.descripcion_sunat || error.message
                    ),
                };
            }

            // Error de red — no queremos bloquear la venta por esto
            this.logger.error(`Error de red con Nubefact: ${error.message}`);
            return {
                accepted: false,
                sunatStatus: 'ERROR_RED',
                sunatCode: 'NET',
                sunatDescription: 'Error de conexión con SUNAT. El comprobante fue guardado localmente.',
            };
        }
    }

    // ── TRADUCIR CÓDIGOS DE ERROR SUNAT ─────────────────────────────────────
    private traducirError(codigo: string | number, descripcionOriginal: string): string {
        const errores: Record<string, string> = {
            '0100': 'La serie ya fue usada anteriormente.',
            '0101': 'El RUC del emisor no coincide con el certificado.',
            '0109': 'El comprobante ya fue enviado a SUNAT.',
            '2017': 'El tipo de documento del receptor es inválido.',
            '2075': 'El número de RUC del receptor no existe en SUNAT.',
            '2800': 'El RUC del emisor no está autorizado para emitir electrónicamente.',
            '3040': 'El monto del IGV no coincide con la base imponible.',
            '3041': 'El total del comprobante no cuadra con los ítems.',
        };
        const key = String(codigo);
        return errores[key] ? `(${key}) ${errores[key]}` : descripcionOriginal;
    }
}
