import { Injectable, Logger } from '@nestjs/common';

// Resend usa fetch nativo — no necesita SDK para lo básico
// Si prefieres instalar el SDK: npm install resend
// En ese caso reemplaza el fetch por: const resend = new Resend(process.env.RESEND_API_KEY);

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);

    // ── ENVIAR COMPROBANTE POR EMAIL ──────────────────────────────────────────
    async sendInvoiceEmail(
        toEmail: string,
        customerName: string,
        serieNumber: string,
        pdfBase64: string
    ): Promise<void> {
        const apiKey = process.env.RESEND_API_KEY;

        if (!apiKey) {
            this.logger.warn('RESEND_API_KEY no configurado — email no enviado.');
            return;
        }

        const fromName    = process.env.EMAIL_FROM_NAME || 'SaaS POS';
        const fromAddress = process.env.EMAIL_FROM      || 'noreply@resend.dev';
        // Nota: con el plan gratuito de Resend solo puedes enviar desde
        // noreply@resend.dev o desde un dominio verificado propio.
        // Para verificar tu dominio: resend.com → Domains → Add Domain

        const htmlBody = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Comprobante ${serieNumber}</title>
            </head>
            <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">

                    <!-- Header -->
                    <div style="background:#1e40af;padding:32px;text-align:center;">
                        <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:800;letter-spacing:-0.5px;">
                            ${fromName}
                        </h1>
                        <p style="color:#93c5fd;margin:6px 0 0;font-size:13px;">
                            Comprobante electrónico
                        </p>
                    </div>

                    <!-- Body -->
                    <div style="padding:32px;">
                        <p style="color:#1e293b;font-size:15px;margin:0 0 8px;">
                            Estimado/a <strong>${customerName}</strong>,
                        </p>
                        <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
                            Le adjuntamos su comprobante electrónico <strong>${serieNumber}</strong>
                            en formato PDF. Puede descargarlo y guardarlo para sus registros.
                        </p>

                        <!-- Badge comprobante -->
                        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;text-align:center;margin-bottom:24px;">
                            <p style="margin:0;font-size:13px;color:#6b7280;">Número de comprobante</p>
                            <p style="margin:6px 0 0;font-size:20px;font-weight:900;color:#1d4ed8;font-family:monospace;">
                                ${serieNumber}
                            </p>
                        </div>

                        <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0;">
                            Este correo fue enviado automáticamente. Si tiene alguna consulta,
                            comuníquese directamente con el establecimiento.
                        </p>
                    </div>

                    <!-- Footer -->
                    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center;">
                        <p style="margin:0;font-size:11px;color:#94a3b8;">
                            Facturación electrónica — ${fromName}
                        </p>
                    </div>
                </div>
            </body>
            </html>
        `;

        try {
            const payload: any = {
                from:    `${fromName} <${fromAddress}>`,
                to:      [toEmail],
                subject: `Tu comprobante ${serieNumber} — ${fromName}`,
                html:    htmlBody,
            };

            // Adjuntar PDF si viene en base64
            if (pdfBase64) {
                payload.attachments = [{
                    filename: `${serieNumber}.pdf`,
                    content:  pdfBase64,   // Resend acepta base64 directamente
                }];
            }

            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type':  'application/json',
                },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) {
                this.logger.error(`Resend error: ${JSON.stringify(data)}`);
                return;
            }

            this.logger.log(`✅ Email enviado a ${toEmail} — ID: ${data.id}`);

        } catch (error: any) {
            // No bloquear la venta si falla el email
            this.logger.error(`Error enviando email: ${error.message}`);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ══ RECUPERACIÓN DE CONTRASEÑA ═════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════

    // ── ENVIAR EMAIL DE RECUPERACIÓN DE CONTRASEÑA ────────────────────────────
    async sendPasswordResetEmail(
        toEmail: string,
        userName: string,
        resetToken: string
    ): Promise<boolean> {
        this.logger.log(`Enviando email de recuperación a: ${toEmail}`);

        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
            this.logger.warn('RESEND_API_KEY no configurado — email no enviado.');
            return false;
        }

        const fromName    = process.env.EMAIL_FROM_NAME || 'SaaS POS';
        const fromAddress = process.env.EMAIL_FROM      || 'noreply@resend.dev';
        const frontendUrl = process.env.FRONTEND_URL    || 'http://localhost:3000';
        const resetLink   = `${frontendUrl}/reset-password?token=${resetToken}`;

        const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    
    <!-- Header con gradiente -->
    <div style="background:linear-gradient(135deg, #1e40af 0%, #4f46e5 100%);padding:40px 40px 32px;">
      <div style="width:56px;height:56px;background:rgba(255,255,255,0.15);border-radius:14px;display:flex;align-items:center;justify-content:center;margin-bottom:20px;">
        <span style="font-size:28px;">🔐</span>
      </div>
      <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">
        Recupera tu contraseña
      </h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:15px;">
        ${fromName}
      </p>
    </div>

    <!-- Body -->
    <div style="padding:40px;">
      <p style="color:#374151;font-size:16px;margin:0 0 20px;line-height:1.6;">
        Hola <strong>${userName}</strong>,
      </p>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 28px;">
        Recibimos una solicitud para restablecer la contraseña de tu cuenta. 
        Si no realizaste esta solicitud, puedes ignorar este correo.
      </p>

      <!-- CTA Button -->
      <div style="text-align:center;margin:32px 0;">
        <a href="${resetLink}" 
           style="display:inline-block;background:linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:16px 40px;border-radius:12px;box-shadow:0 4px 14px rgba(37,99,235,0.4);">
          Restablecer contraseña
        </a>
      </div>

      <!-- Security info -->
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:16px 20px;margin:28px 0;">
        <p style="margin:0;color:#92400e;font-size:14px;line-height:1.6;">
          <strong>⏰ Este enlace expira en 1 hora</strong><br/>
          Por seguridad, solo puedes usar este enlace una vez.
        </p>
      </div>

      <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:24px 0 0;">
        Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
        <a href="${resetLink}" style="color:#2563eb;word-break:break-all;">${resetLink}</a>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:24px 40px;">
      <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
        Si no solicitaste este cambio, ignora este correo. Tu contraseña seguirá siendo la misma.<br/><br/>
        <strong style="color:#6b7280;">${fromName}</strong> · Sistema de Facturación Electrónica
      </p>
    </div>

  </div>
</body>
</html>`;

        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type':  'application/json',
                },
                body: JSON.stringify({
                    from:    `${fromName} <${fromAddress}>`,
                    to:      [toEmail],
                    subject: 'Recupera tu contraseña - SaaS POS',
                    html:    htmlBody,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                this.logger.error(`Resend error (password reset): ${JSON.stringify(data)}`);
                return false;
            }

            this.logger.log(`✅ Email de recuperación enviado a ${toEmail} — ID: ${data.id}`);
            return true;

        } catch (error: any) {
            this.logger.error(`Error enviando email de recuperación: ${error.message}`);
            return false;
        }
    }

    // ── ENVIAR CONFIRMACIÓN DE CAMBIO DE CONTRASEÑA ───────────────────────────
    async sendPasswordChangedEmail(
        toEmail: string,
        userName: string
    ): Promise<boolean> {
        this.logger.log(`Enviando confirmación de cambio de contraseña a: ${toEmail}`);

        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
            this.logger.warn('RESEND_API_KEY no configurado — email no enviado.');
            return false;
        }

        const fromName    = process.env.EMAIL_FROM_NAME || 'SaaS POS';
        const fromAddress = process.env.EMAIL_FROM      || 'noreply@resend.dev';

        const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    
    <!-- Header con gradiente verde -->
    <div style="background:linear-gradient(135deg, #059669 0%, #10b981 100%);padding:40px 40px 32px;">
      <div style="width:56px;height:56px;background:rgba(255,255,255,0.15);border-radius:14px;display:flex;align-items:center;justify-content:center;margin-bottom:20px;">
        <span style="font-size:28px;">✅</span>
      </div>
      <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">
        Contraseña actualizada
      </h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:15px;">
        ${fromName}
      </p>
    </div>

    <!-- Body -->
    <div style="padding:40px;">
      <p style="color:#374151;font-size:16px;margin:0 0 20px;line-height:1.6;">
        Hola <strong>${userName}</strong>,
      </p>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 28px;">
        Te confirmamos que tu contraseña ha sido actualizada exitosamente. 
        Ya puedes iniciar sesión con tu nueva contraseña.
      </p>

      <!-- Success badge -->
      <div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:10px;padding:16px 20px;margin:24px 0;">
        <p style="margin:0;color:#065f46;font-size:14px;line-height:1.6;">
          <strong>🔒 Tu cuenta está segura</strong><br/>
          Si no realizaste este cambio, contacta a soporte inmediatamente.
        </p>
      </div>

      <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:24px 0 0;">
        Si tienes alguna pregunta, no dudes en contactarnos respondiendo a este correo.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:24px 40px;">
      <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
        <strong style="color:#6b7280;">${fromName}</strong> · Sistema de Facturación Electrónica
      </p>
    </div>

  </div>
</body>
</html>`;

        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type':  'application/json',
                },
                body: JSON.stringify({
                    from:    `${fromName} <${fromAddress}>`,
                    to:      [toEmail],
                    subject: 'Tu contraseña ha sido actualizada - SaaS POS',
                    html:    htmlBody,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                this.logger.error(`Resend error (password changed): ${JSON.stringify(data)}`);
                return false;
            }

            this.logger.log(`✅ Confirmación de cambio enviada a ${toEmail} — ID: ${data.id}`);
            return true;

        } catch (error: any) {
            this.logger.error(`Error enviando confirmación: ${error.message}`);
            return false;
        }
    }

    // ── ENVIAR EMAIL GENÉRICO (para futuras notificaciones) ───────────────────
    async sendEmail(data: {
        to: string;
        subject: string;
        html: string;
    }): Promise<boolean> {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) return false;

        const fromName    = process.env.EMAIL_FROM_NAME || 'SaaS POS';
        const fromAddress = process.env.EMAIL_FROM      || 'noreply@resend.dev';

        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type':  'application/json',
                },
                body: JSON.stringify({
                    from:    `${fromName} <${fromAddress}>`,
                    to:      [data.to],
                    subject: data.subject,
                    html:    data.html,
                }),
            });
            return res.ok;
        } catch {
            return false;
        }
    }
}
