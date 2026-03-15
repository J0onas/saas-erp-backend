import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);
    private transporter: nodemailer.Transporter;

    constructor() {
        // ── CONFIGURACIÓN NODEMAILER / GMAIL ──────────────────────────────────
        // Variables requeridas en .env:
        //   EMAIL_USER  →  tu cuenta Gmail (ej: minegocio@gmail.com)
        //   EMAIL_PASS  →  App Password de Google (NO la contraseña normal)
        //   EMAIL_FROM_NAME → nombre que verá el cliente (ej: "Dev Zolutions SAC")
        //
        // Para generar App Password:
        //   1. Activa Verificación en 2 pasos en tu cuenta Google
        //   2. Ve a myaccount.google.com → Seguridad → Contraseñas de aplicación
        //   3. Genera una para "Correo / Otro dispositivo"
        //   4. Copia las 16 letras como EMAIL_PASS (sin espacios)
        // ─────────────────────────────────────────────────────────────────────
        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });
    }

    // ── ENVIAR FACTURA POR CORREO ─────────────────────────────────────────────
    async sendInvoiceEmail(
        toEmail: string,
        clientName: string,
        invoiceNumber: string,
        pdfBase64: string
    ): Promise<boolean> {
        this.logger.log(`Enviando factura ${invoiceNumber} a: ${toEmail}`);

        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            this.logger.warn('EMAIL_USER o EMAIL_PASS no configurados. Correo omitido.');
            return false;
        }

        const fromName = process.env.EMAIL_FROM_NAME || 'Sistema de Facturación';

        try {
            const pdfBuffer = Buffer.from(pdfBase64, 'base64');

            await this.transporter.sendMail({
                from: `"${fromName}" <${process.env.EMAIL_USER}>`,
                to: toEmail,
                subject: `Comprobante Electrónico ${invoiceNumber}`,
                html: this.buildEmailHtml(clientName, invoiceNumber, fromName),
                attachments: [
                    {
                        filename: `${invoiceNumber}.pdf`,
                        content: pdfBuffer,
                        contentType: 'application/pdf',
                    },
                ],
            });

            this.logger.log(`✅ Correo enviado a ${toEmail}`);
            return true;

        } catch (error: any) {
            this.logger.error(`❌ Error enviando correo a ${toEmail}: ${error.message}`);
            // No lanzamos excepción para que la factura se genere aunque falle el correo
            return false;
        }
    }

    // ── TEMPLATE HTML DEL CORREO ──────────────────────────────────────────────
    private buildEmailHtml(
        clientName: string,
        invoiceNumber: string,
        fromName: string
    ): string {
        return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.07);">
    
    <!-- Header -->
    <div style="background:#1e3a5f;padding:32px 40px;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">
        ${fromName}
      </h1>
      <p style="margin:6px 0 0;color:#93c5fd;font-size:13px;">Comprobante Electrónico</p>
    </div>

    <!-- Body -->
    <div style="padding:32px 40px;">
      <p style="color:#374151;font-size:16px;margin:0 0 16px;">
        Estimado/a <strong>${clientName}</strong>,
      </p>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Adjuntamos su comprobante de pago <strong style="color:#1e3a5f;">${invoiceNumber}</strong> 
        en formato PDF. Por favor consérvelo como respaldo de su transacción.
      </p>

      <!-- Invoice badge -->
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 20px;margin:0 0 24px;">
        <p style="margin:0;color:#1e40af;font-size:14px;font-weight:700;">
          📄 Comprobante: ${invoiceNumber}
        </p>
        <p style="margin:4px 0 0;color:#3b82f6;font-size:12px;">
          Archivo adjunto en formato PDF
        </p>
      </div>

      <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 8px;">
        Si tiene alguna consulta sobre este documento, responda a este correo
        y con gusto le atenderemos.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:20px 40px;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">
        Atentamente, <strong style="color:#374151;">${fromName}</strong><br/>
        Este es un correo automático · Por favor no responda si el asunto ya fue resuelto.
      </p>
    </div>

  </div>
</body>
</html>`;
    }
}
