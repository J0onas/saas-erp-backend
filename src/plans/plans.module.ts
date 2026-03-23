import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlanGuard } from './plan.guard';

@Module({
    controllers: [PlansController],
    providers: [PlansService, PlanGuard],
    exports: [PlansService, PlanGuard],
})
export class PlansModule {}
