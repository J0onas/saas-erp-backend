import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PlansModule } from '../plans/plans.module';

@Module({
    controllers: [UsersController],
    providers: [UsersService],
    imports: [PlansModule],
    exports: [UsersService],
})
export class UsersModule {}
