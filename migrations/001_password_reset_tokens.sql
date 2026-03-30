-- ══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Tabla de tokens de recuperación de contraseña
-- Fecha: 2026-03-30
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════════

-- Crear tabla de tokens de recuperación de contraseña
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,  -- SHA-256 hash del token (no guardamos el token plano)
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT false,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Índice para búsqueda rápida por token
    CONSTRAINT unique_token_hash UNIQUE (token_hash)
);

-- Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id 
    ON password_reset_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash 
    ON password_reset_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at 
    ON password_reset_tokens(expires_at);

-- Comentarios descriptivos
COMMENT ON TABLE password_reset_tokens IS 'Tokens de recuperación de contraseña con expiración de 1 hora';
COMMENT ON COLUMN password_reset_tokens.token_hash IS 'Hash SHA-256 del token enviado por email (nunca guardamos el token en texto plano)';
COMMENT ON COLUMN password_reset_tokens.used IS 'Indica si el token ya fue utilizado para cambiar la contraseña';
COMMENT ON COLUMN password_reset_tokens.used_at IS 'Fecha/hora en que se usó el token';

-- ══════════════════════════════════════════════════════════════════════════
-- LIMPIEZA AUTOMÁTICA (opcional): Eliminar tokens expirados después de 7 días
-- ══════════════════════════════════════════════════════════════════════════

-- Puedes ejecutar esto manualmente o programar un cron job:
-- DELETE FROM password_reset_tokens WHERE expires_at < NOW() - INTERVAL '7 days';
