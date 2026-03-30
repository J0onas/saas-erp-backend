import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
    @IsString()
    @IsNotEmpty({ message: 'El token es requerido' })
    token: string;
}

export class ResendVerificationDto {
    @IsEmail({}, { message: 'Ingresa un correo válido' })
    @IsNotEmpty({ message: 'El correo es requerido' })
    email: string;
}
