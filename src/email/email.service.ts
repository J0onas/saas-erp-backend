import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);
    private transporter: nodemailer.Transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS 
            },
            family: 4,
            connectionTimeout: 10000, 
        } as any); // <-- ¡Aquí está la magia (as any)!
    }

    async sendInvoiceEmail(toEmail: string, clientName: string, invoiceNumber: string, pdfBase64: string) {
        this.logger.log(`Enviando factura ${invoiceNumber} al correo: ${toEmail}`);
        
        try {
            const pdfBuffer = Buffer.from(pdfBase64, 'base64');

            await this.transporter.sendMail({
                // También usamos la variable aquí para no dejar rastros
                from: `"TECH SOLUTIONS SAC" <${process.env.EMAIL_USER}>`, 
                to: toEmail,
                subject: `Tu Factura Electrónica ${invoiceNumber} ha sido emitida`,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; max-width: 600px;">
                        <h2 style="color: #2563eb; margin-bottom: 20px;">¡Hola, ${clientName}!</h2>
                        <p style="color: #374151; font-size: 16px;">Gracias por tu preferencia. Adjuntamos tu comprobante electrónico de pago <strong>${invoiceNumber}</strong> en formato PDF.</p>
                        <p style="color: #374151; font-size: 16px;">Si tienes alguna duda con este documento, no dudes en responder a este correo.</p>
                        <br/>
                        <hr style="border: 0; border-top: 1px solid #e5e7eb;" />
                        <br/>
                        <p style="color: #6b7280; font-size: 14px;">Atentamente,</p>
                        <p style="color: #1f2937; font-size: 16px; font-weight: bold;">El equipo de TECH SOLUTIONS SAC</p>
                    </div>
                `,
                attachments: [
                    {
                        filename: `Factura_${invoiceNumber}.pdf`,
                        content: pdfBuffer,
                        contentType: 'application/pdf'
                    }
                ]
            });
            
            this.logger.log(`¡Correo enviado con éxito a ${toEmail}!`);
            return true;
        } catch (error) {
            this.logger.error(`Error enviando correo a ${toEmail}:`, error);
            return false;
        }
    }
}