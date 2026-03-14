import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProductService } from './product.service';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  // --- NUEVO ENDPOINT: CREAR UN PRODUCTO ---
  @UseGuards(AuthGuard('jwt'))
  @Post()
  async createProduct(@Body() body: { name: string; unit_price: number; stock: number }, @Req() req: any) {
    return await this.productService.createProduct(body, req.user.tenantId);
  }

  // --- LISTAR TODO EL ALMACÉN ---
  @UseGuards(AuthGuard('jwt'))
  @Get()
  async getAllProducts(@Req() req: any) {
    return await this.productService.findAll(req.user.tenantId);
  }

  // --- EL BUSCADOR ---
  @UseGuards(AuthGuard('jwt'))
  @Get('search/:term')
  async searchProduct(@Param('term') term: string, @Req() req: any) {
    return await this.productService.searchProducts(term, req.user.tenantId);
  }
}