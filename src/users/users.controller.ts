import {
    Controller, Get, Post, Patch, Body,
    Param, UseGuards, Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    // GET /api/v1/users — solo GERENTE
    @Get()
    @Roles('GERENTE', 'SUPERADMIN')
    async getAll(@Req() req: any) {
        return await this.usersService.findAll(req.user.tenantId);
    }

    // POST /api/v1/users/invite — crear nuevo usuario
    @Post('invite')
    @Roles('GERENTE', 'SUPERADMIN')
    async invite(
        @Body() body: { email: string; fullName: string; role: string; password: string },
        @Req() req: any
    ) {
        return await this.usersService.inviteUser(req.user.tenantId, body);
    }

    // PATCH /api/v1/users/:id/role — cambiar rol
    @Patch(':id/role')
    @Roles('GERENTE', 'SUPERADMIN')
    async updateRole(
        @Param('id') userId: string,
        @Body() body: { role: string },
        @Req() req: any
    ) {
        return await this.usersService.updateRole(req.user.tenantId, userId, body.role);
    }

    // PATCH /api/v1/users/:id/toggle — activar/desactivar
    @Patch(':id/toggle')
    @Roles('GERENTE', 'SUPERADMIN')
    async toggle(
        @Param('id') userId: string,
        @Body() body: { active: boolean },
        @Req() req: any
    ) {
        return await this.usersService.toggleActive(req.user.tenantId, userId, body.active);
    }

    // GET /api/v1/users/me — cualquier usuario puede ver su propio perfil
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
