import { IsString, IsNumber, ValidateNested, IsArray, IsDateString } from 'class-validator';
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
    @IsString() description: string;
    @IsNumber() quantity: number;
    @IsNumber() unitValue: number;
    @IsNumber() unitPrice: number;
    @IsNumber() totalTaxes: number;
}

export class CreateInvoiceDto {
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