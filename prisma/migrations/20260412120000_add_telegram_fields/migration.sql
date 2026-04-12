-- Telegram Mini App identity fields for auth linking and bot-origin users.
ALTER TABLE "User"
ADD COLUMN "telegram_id" TEXT,
ADD COLUMN "telegram_username" TEXT,
ADD COLUMN "is_telegram" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "User_telegram_id_key" ON "User"("telegram_id");
