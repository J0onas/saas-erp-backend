import {
    Controller, Get, Post, Patch, Body,
    Param, UseGuards, Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PlanGuard, UsePlanLimit } from '../plans/plan.guard';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Get()
    @Roles('GERENTE', 'SUPERADMIN')
    async getAll(@Req() req: any) {
        return await this.usersService.findAll(req.user.tenantId);
    }

    // ← PlanGuard verifica límite de usuarios antes de invitar
    @Post('invite')
    @Roles('GERENTE', 'SUPERADMIN')
    @UseGuards(PlanGuard)
    @UsePlanLimit('users')
    async invite(
        @Body() body: { email: string; fullName: string; role: string; password: string },
        @Req() req: any
    ) {
        return await this.usersService.inviteUser(req.user.tenantId, body);
    }

    @Patch(':id/role')
    @Roles('GERENTE', 'SUPERADMIN')
    async updateRole(
        @Param('id') userId: string,
        @Body() body: { role: string },
        @Req() req: any
    ) {
        return await this.usersService.updateRole(req.user.tenantId, userId, body.role);
    }

    @Patch(':id/toggle')
    @Roles('GERENTE', 'SUPERADMIN')
    async toggle(
        @Param('id') userId: string,
        @Body() body: { active: boolean },
        @Req() req: any
    ) {
        return await this.usersService.toggleActive(req.user.tenantId, userId, body.active);
    }

    @Get('me')
    async getMe(@Req() req: any) {
        return {
            success: true,
            data: {
                userId: req.user.userId,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role,
                tenantId: req.user.tenantId,
            },
        };
    }
}
