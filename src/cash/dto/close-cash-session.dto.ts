import { IsUUID, IsNumber, IsPositive, IsOptional, IsString } from 'class-validator';

export class CloseCashSessionDto {
    @IsUUID()
    cash_session_id: string;

    @IsNumber({ maxDecimalPlaces: 2 })
    @IsPositive()
    reported_amount_cash: number;

    @IsOptional()
    @IsString()
    notes?: string;
}
