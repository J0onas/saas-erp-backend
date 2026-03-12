import { IsString, IsNumber, IsBoolean, IsOptional, ValidateNested, IsArray, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

class CompanyInfoDto {
    @IsString() ruc: string;
    @IsString() businessName: string;
    @IsString() addressCode: string;
}

class CustomerInfoDto {
    @IsString() documentType: string;
    @IsString() documentNumber: string;
    @IsString() fullName: string;
}

class InvoiceItemDto {
    @IsNumber() id: number;

    // --- NUEVO PASE VIP PARA EL KARDEX ---
    @IsOptional()
    @IsString()
    productId?: string;
    // -------------------------------------

    @IsString() description: string;
    @IsNumber() quantity: number;
    @IsNumber() unitValue: number;
    @IsNumber() unitPrice: number;
    @IsNumber() totalTaxes: number;
}

export class CreateInvoiceDto {
    // --- NUEVO PASE VIP PARA DETRACCIONES ---
    @IsOptional()
    @IsBoolean()
    hasDetraction?: boolean;

    @IsOptional()
    @IsNumber()
    detractionPercent?: number;

    @IsOptional()
    @IsNumber()
    detractionAmount?: number;
    // ----------------------------------------

    @IsOptional()
    @IsString()
    paymentMethod?: string;

    @IsOptional()
    @IsString()
    customerEmail?: string;

    @IsString() serieNumber: string;
    @IsDateString() issueDate: string;
    @IsString() issueTime: string;
    @IsString() currency: string;
    
    @ValidateNested()
    @Type(() => CompanyInfoDto)
    supplier: CompanyInfoDto;

    @ValidateNested()
    @Type(() => CustomerInfoDto)
    customer: CustomerInfoDto;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => InvoiceItemDto)
    items: InvoiceItemDto[];

    @IsNumber() totalTaxBase: number;
    @IsNumber() totalIgv: number;
    @IsNumber() totalAmount: number;
}