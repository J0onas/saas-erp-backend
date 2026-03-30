-- ══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Sistema de verificación de email
-- Fecha: 2026-03-30
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════════

-- 1. Agregar columna de verificación a la tabla users
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE;

-- 2. Crear tabla de tokens de verificación de email
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,  -- SHA-256 hash del token
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT false,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_email_verification_token UNIQUE (token_hash)
);

-- 3. Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_email_verification_user_id 
    ON email_verification_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_email_verification_token_hash 
    ON email_verification_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_email_verification_expires 
    ON email_verification_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_users_email_verified 
    ON users(email_verified);

-- 4. Comentarios descriptivos
COMMENT ON COLUMN users.email_verified IS 'Indica si el usuario ha verificado su correo electrónico';
COMMENT ON COLUMN users.email_verified_at IS 'Fecha/hora en que se verificó el correo';
COMMENT ON TABLE email_verification_tokens IS 'Tokens de verificación de email con expiración de 24 horas';

-- ══════════════════════════════════════════════════════════════════════════
-- NOTA: Los usuarios existentes quedarán con email_verified = false
-- Puedes marcarlos como verificados manualmente si lo deseas:
-- UPDATE users SET email_verified = true, email_verified_at = NOW();
-- ══════════════════════════════════════════════════════════════════════════
