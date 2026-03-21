import {
    Controller, Get, Post, Patch,
    Body, Param, Query,
    UseGuards, Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProductService } from './product.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('products')
export class ProductController {
    constructor(private readonly productService: ProductService) {}

    // GET /api/v1/products — listar inventario (con filtro por categoría opcional)
    @UseGuards(AuthGuard('jwt'))
    @Get()
    async getAllProducts(
        @Req() req: any,
        @Query('categoryId') categoryId?: string
    ) {
        return await this.productService.findAll(req.user.tenantId, categoryId);
    }

    // GET /api/v1/products/search/:term — buscador POS (nombre, código, barcode)
    @UseGuards(AuthGuard('jwt'))
    @Get('search/:term')
    async searchProduct(@Param('term') term: string, @Req() req: any) {
        return await this.productService.searchProducts(term, req.user.tenantId);
    }

    // GET /api/v1/products/barcode/:code — búsqueda exacta por código de barras
    @UseGuards(AuthGuard('jwt'))
    @Get('barcode/:code')
    async findByBarcode(@Param('code') code: string, @Req() req: any) {
        return await this.productService.findByBarcode(code, req.user.tenantId);
    }

    // POST /api/v1/products — crear producto
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    @Post()
    async createProduct(
        @Body() body: {
            name: string;
            unit_price: number;
            stock: number;
            barcode?: string;
            sku?: string;
            category_id?: string;
        },
        @Req() req: any
    ) {
        return await this.productService.createProduct(body, req.user.tenantId);
    }

    // PATCH /api/v1/products/:id — editar producto
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    @Patch(':id')
    async updateProduct(
        @Param('id') id: string,
        @Body() body: {
            name?: string;
            unit_price?: number;
            barcode?: string;
            sku?: string;
            category_id?: string;
            min_stock?: number;
        },
        @Req() req: any
    ) {
        return await this.productService.updateProduct(id, req.user.tenantId, body);
    }
}
