import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';

export interface Notification {
    id: string;
    type: 'LOW_STOCK' | 'NEW_INVOICE' | 'SUBSCRIPTION_EXPIRING' | 'SYSTEM' | 'CASH_CLOSED';
    title: string;
    message: string;
    data?: Record<string, any>;
    timestamp: string;
}

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    // Map de conexiones SSE activas: tenantId → lista de Response
    private clients = new Map<string, Response[]>();

    // ── REGISTRAR CLIENTE SSE ─────────────────────────────────────────────────
    addClient(tenantId: string, res: Response) {
        const existing = this.clients.get(tenantId) || [];
        existing.push(res);
        this.clients.set(tenantId, existing);

        this.logger.log(`Cliente SSE conectado: tenant ${tenantId} (${existing.length} total)`);

        // Enviar notificación de bienvenida
        this.sendToClient(res, {
            id: Date.now().toString(),
            type: 'SYSTEM',
            title: 'Conectado',
            message: 'Notificaciones en tiempo real activadas.',
            timestamp: new Date().toISOString(),
        });
    }

    // ── ELIMINAR CLIENTE DESCONECTADO ─────────────────────────────────────────
    removeClient(tenantId: string, res: Response) {
        const existing = this.clients.get(tenantId) || [];
        const updated  = existing.filter(client => client !== res);
        if (updated.length === 0) {
            this.clients.delete(tenantId);
        } else {
            this.clients.set(tenantId, updated);
        }
        this.logger.log(`Cliente SSE desconectado: tenant ${tenantId}`);
    }

    // ── ENVIAR NOTIFICACIÓN A UN TENANT ───────────────────────────────────────
    notifyTenant(tenantId: string, notification: Omit<Notification, 'id' | 'timestamp'>) {
        const clients = this.clients.get(tenantId);
        if (!clients || clients.length === 0) return;

        const fullNotification: Notification = {
            ...notification,
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
        };

        const deadClients: Response[] = [];

        for (const client of clients) {
            try {
                this.sendToClient(client, fullNotification);
            } catch {
                deadClients.push(client);
            }
        }

        // Limpiar clientes desconectados
        if (deadClients.length > 0) {
            const alive = clients.filter(c => !deadClients.includes(c));
            this.clients.set(tenantId, alive);
        }
    }

    // ── ENVIAR A UN CLIENTE ESPECÍFICO ────────────────────────────────────────
    private sendToClient(res: Response, notification: Notification) {
        const data = JSON.stringify(notification);
        res.write(`id: ${notification.id}\n`);
        res.write(`event: notification\n`);
        res.write(`data: ${data}\n\n`);
    }

    // ── HELPERS PARA NOTIFICACIONES COMUNES ───────────────────────────────────

    notifyLowStock(tenantId: string, productName: string, stock: number) {
        this.notifyTenant(tenantId, {
            type: 'LOW_STOCK',
            title: '⚠️ Stock bajo',
            message: `"${productName}" tiene solo ${stock} unidades disponibles.`,
            data: { productName, stock },
        });
    }

    notifyNewInvoice(tenantId: string, serie: string, total: number, branchName?: string) {
        this.notifyTenant(tenantId, {
            type: 'NEW_INVOICE',
            title: '✅ Venta registrada',
            message: `${serie} — S/ ${total.toFixed(2)}${branchName ? ` · ${branchName}` : ''}`,
            data: { serie, total, branchName },
        });
    }

    notifySubscriptionExpiring(tenantId: string, daysLeft: number) {
        this.notifyTenant(tenantId, {
            type: 'SUBSCRIPTION_EXPIRING',
            title: '🔔 Suscripción próxima a vencer',
            message: `Tu suscripción vence en ${daysLeft} días. Renueva para no perder el acceso.`,
            data: { daysLeft },
        });
    }

    notifyCashClosed(tenantId: string, total: number, branchName?: string) {
        this.notifyTenant(tenantId, {
            type: 'CASH_CLOSED',
            title: '🔒 Turno cerrado',
            message: `Caja cerrada${branchName ? ` en ${branchName}` : ''}. Total: S/ ${total.toFixed(2)}`,
            data: { total, branchName },
        });
    }
}
