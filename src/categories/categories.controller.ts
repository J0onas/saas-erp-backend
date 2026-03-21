import {
    Controller, Get, Post, Patch, Delete,
    Body, Param, UseGuards, Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CategoriesService } from './categories.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('categories')
@UseGuards(AuthGuard('jwt'))
export class CategoriesController {
    constructor(private readonly categoriesService: CategoriesService) {}

    // GET /api/v1/categories
    @Get()
    async getAll(@Req() req: any) {
        return await this.categoriesService.findAll(req.user.tenantId);
    }

    // POST /api/v1/categories
    @Post()
    @UseGuards(RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    async create(
        @Body() body: { name: string; color?: string },
        @Req() req: any
    ) {
        return await this.categoriesService.create(req.user.tenantId, body);
    }

    // PATCH /api/v1/categories/:id
    @Patch(':id')
    @UseGuards(RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    async update(
        @Param('id') id: string,
        @Body() body: { name?: string; color?: string },
        @Req() req: any
    ) {
        return await this.categoriesService.update(req.user.tenantId, id, body);
    }

    // DELETE /api/v1/categories/:id
    @Delete(':id')
    @UseGuards(RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    async remove(@Param('id') id: string, @Req() req: any) {
        return await this.categoriesService.remove(req.user.tenantId, id);
    }
}
