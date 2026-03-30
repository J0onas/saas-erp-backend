import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ForgotPasswordDto {
    @IsEmail({}, { message: 'Ingresa un correo electrónico válido' })
    @IsNotEmpty({ message: 'El correo electrónico es requerido' })
    email: string;
}

export class ResetPasswordDto {
    @IsString({ message: 'El token es requerido' })
    @IsNotEmpty({ message: 'El token es requerido' })
    token: string;

    @IsString({ message: 'La contraseña es requerida' })
    @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
    password: string;
}

export class VerifyTokenDto {
    @IsString({ message: 'El token es requerido' })
    @IsNotEmpty({ message: 'El token es requerido' })
    token: string;
}
