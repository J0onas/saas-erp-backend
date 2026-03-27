import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
    controllers: [NotificationsController],
    providers: [NotificationsService],
    exports: [NotificationsService],   // ← exportado para inyectarlo en otros servicios
})
export class NotificationsModule {}
