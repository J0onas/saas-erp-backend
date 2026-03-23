import {
    Controller, Get, Post, Patch,
    Body, Param, Query,
    UseGuards, Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProductService } from './product.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PlanGuard, UsePlanLimit } from '../plans/plan.guard';

@Controller('products')
export class ProductController {
    constructor(private readonly productService: ProductService) {}

    @UseGuards(AuthGuard('jwt'))
    @Get()
    async getAllProducts(@Req() req: any, @Query('categoryId') categoryId?: string) {
        return await this.productService.findAll(req.user.tenantId, categoryId);
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('search/:term')
    async searchProduct(@Param('term') term: string, @Req() req: any) {
        return await this.productService.searchProducts(term, req.user.tenantId);
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('barcode/:code')
    async findByBarcode(@Param('code') code: string, @Req() req: any) {
        return await this.productService.findByBarcode(code, req.user.tenantId);
    }

    // ← PlanGuard verifica límite de productos antes de crear
    @UseGuards(AuthGuard('jwt'), RolesGuard, PlanGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    @UsePlanLimit('products')
    @Post()
    async createProduct(
        @Body() body: {
            name: string; unit_price: number; stock: number;
            barcode?: string; sku?: string; category_id?: string;
        },
        @Req() req: any
    ) {
        return await this.productService.createProduct(body, req.user.tenantId);
    }

    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    @Patch(':id')
    async updateProduct(
        @Param('id') id: string,
        @Body() body: {
            name?: string; unit_price?: number; barcode?: string;
            sku?: string; category_id?: string; min_stock?: number;
        },
        @Req() req: any
    ) {
        return await this.productService.updateProduct(id, req.user.tenantId, body);
    }
}
