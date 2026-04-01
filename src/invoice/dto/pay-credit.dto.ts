import { IsUUID, IsNumber, IsPositive } from 'class-validator';

export class PayCreditDto {
    @IsUUID()
    invoice_id: string;

    @IsNumber()
    @IsPositive({ message: 'El monto debe ser mayor a 0' })
    amount: number;
}
