import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { PlansModule } from '../plans/plans.module';

@Module({
  controllers: [ProductController],
  providers: [ProductService],
  imports: [PlansModule],
  exports: [ProductService],
})
export class ProductModule {}
