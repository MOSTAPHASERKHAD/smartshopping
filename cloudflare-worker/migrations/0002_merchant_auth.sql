-- ============================================================
-- Smart Shopping - Cloudflare D1 Migration 0002
-- Phase 29: Production-Grade Merchant Authentication
-- ============================================================

-- 1. إضافة أعمدة إضافية لجدول المستخدمين (users) لدعم التحقق وتغيير كلمات المرور
ALTER TABLE users ADD COLUMN email_verified_at TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN password_changed_at TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN last_login_at TEXT DEFAULT NULL;

-- 2. إضافة عمود سبب الإلغاء لجدول الجلسات (sessions)
ALTER TABLE sessions ADD COLUMN revoke_reason TEXT DEFAULT NULL;

-- 3. جدول رموز استعادة كلمة المرور (password_reset_tokens)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  used_at     TEXT DEFAULT NULL,
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id);

-- 4. جدول رموز تأكيد البريد الإلكتروني (email_verification_tokens)
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  used_at     TEXT DEFAULT NULL,
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_verify_tokens_hash ON email_verification_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_verify_tokens_user ON email_verification_tokens(user_id);
