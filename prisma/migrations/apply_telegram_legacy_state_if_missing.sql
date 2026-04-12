-- Idempotent migration: creates TelegramLegacyState only if it doesn't exist.
-- Run this on the production database if you see "relation does not exist" errors
-- or a login loop in the Telegram bot.
--
-- Apply via your DB client, or via:
--   psql $DATABASE_URL -f apply_telegram_legacy_state_if_missing.sql

CREATE TABLE IF NOT EXISTS "TelegramLegacyState" (
    "id"               TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "chatId"           TEXT         NOT NULL,
    "mode"             TEXT         NOT NULL DEFAULT 'mini',
    "sessionUserId"    TEXT,
    "sessionEmail"     TEXT,
    "flow"             JSONB,
    "flowUpdatedAt"    TIMESTAMP(3),
    "lastBotMessageIds" JSONB,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"        TIMESTAMP(3),

    CONSTRAINT "TelegramLegacyState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TelegramLegacyState_chatId_key"
    ON "TelegramLegacyState"("chatId");

CREATE INDEX IF NOT EXISTS "TelegramLegacyState_sessionUserId_idx"
    ON "TelegramLegacyState"("sessionUserId");

CREATE INDEX IF NOT EXISTS "TelegramLegacyState_updatedAt_idx"
    ON "TelegramLegacyState"("updatedAt");

-- Only add the foreign key if the User table exists and the constraint does not.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'TelegramLegacyState_sessionUserId_fkey'
    ) THEN
        ALTER TABLE "TelegramLegacyState"
        ADD CONSTRAINT "TelegramLegacyState_sessionUserId_fkey"
        FOREIGN KEY ("sessionUserId") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;
