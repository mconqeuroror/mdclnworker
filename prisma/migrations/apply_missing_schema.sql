-- Run this on your production DB if migrations were not applied (e.g. 500 on prompt-image / pipeline).
-- Safe to run multiple times (idempotent).
--
-- Log-based fixes (2026-03-15):
-- - Create-from-photos: server was using callback and never got outputUrl → use forcePolling (code fix).
-- - LoraTrainingImage.create "Argument model is missing" → pass modelId in register-training-images (code fix).
-- - SavedModel.create "photo1Url is missing" → was undefined due to callback flow; forcePolling fixes it.

-- 0. User.proAccess (Pro Studio invite-only access)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "proAccess" BOOLEAN NOT NULL DEFAULT false;

-- 1. Generation.pipelinePayload (required for image->video pipeline callbacks)
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "pipelinePayload" JSONB;

-- 2. RepurposeJob columns (if you use video repurpose)
ALTER TABLE "RepurposeJob" ADD COLUMN IF NOT EXISTS "progress" INTEGER;
ALTER TABLE "RepurposeJob" ADD COLUMN IF NOT EXISTS "message" TEXT;
ALTER TABLE "RepurposeJob" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;

-- 3. AppBranding — legal Markdown + lander demo (fixes P2022 / GET /api/brand prisma errors)
ALTER TABLE "AppBranding" ADD COLUMN IF NOT EXISTS "landerDemoVideoUrl" TEXT;
ALTER TABLE "AppBranding" ADD COLUMN IF NOT EXISTS "termsMarkdown" TEXT;
ALTER TABLE "AppBranding" ADD COLUMN IF NOT EXISTS "privacyMarkdown" TEXT;
ALTER TABLE "AppBranding" ADD COLUMN IF NOT EXISTS "cookiesMarkdown" TEXT;

-- 4. SavedModel — voice + looks flags (common drift if migrations skipped)
ALTER TABLE "SavedModel" ADD COLUMN IF NOT EXISTS "elevenLabsVoiceId" TEXT;
ALTER TABLE "SavedModel" ADD COLUMN IF NOT EXISTS "elevenLabsVoiceType" TEXT;
ALTER TABLE "SavedModel" ADD COLUMN IF NOT EXISTS "elevenLabsVoiceName" TEXT;
ALTER TABLE "SavedModel" ADD COLUMN IF NOT EXISTS "modelVoicePreviewUrl" TEXT;
ALTER TABLE "SavedModel" ADD COLUMN IF NOT EXISTS "looksUnlockedByAdmin" BOOLEAN NOT NULL DEFAULT false;

-- 5. ModelVoice.gender
ALTER TABLE "ModelVoice" ADD COLUMN IF NOT EXISTS "gender" TEXT;

-- 6. User region / marketing (optional)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "marketingLanguage" TEXT;

-- 7. Generation provider task metadata (Creator Studio video rollout)
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "providerTaskId" TEXT;
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "providerModel" TEXT;
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "providerFamily" TEXT;
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "providerMode" TEXT;
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "providerType" TEXT;
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "parentTaskId" TEXT;
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "extendEligible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "originalGenerationId" TEXT;
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "providerRequest" JSONB;
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "providerResponse" JSONB;

UPDATE "Generation" SET "provider" = 'kie' WHERE "provider" IS NULL;
ALTER TABLE "Generation" ALTER COLUMN "provider" SET DEFAULT 'kie';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Generation_originalGenerationId_fkey'
  ) THEN
    ALTER TABLE "Generation"
      ADD CONSTRAINT "Generation_originalGenerationId_fkey"
      FOREIGN KEY ("originalGenerationId") REFERENCES "Generation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 9. ApiKey.encryptedKey (allows showing full key in user settings "Copy API key")
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "encryptedKey" TEXT;

CREATE INDEX IF NOT EXISTS "Generation_providerTaskId_idx" ON "Generation"("providerTaskId");
CREATE INDEX IF NOT EXISTS "Generation_provider_providerModel_idx" ON "Generation"("provider", "providerModel");
CREATE INDEX IF NOT EXISTS "Generation_providerFamily_providerType_idx" ON "Generation"("providerFamily", "providerType");
CREATE INDEX IF NOT EXISTS "Generation_extendEligible_createdAt_idx" ON "Generation"("extendEligible", "createdAt");
CREATE INDEX IF NOT EXISTS "Generation_originalGenerationId_idx" ON "Generation"("originalGenerationId");

-- After running: `npx prisma migrate deploy` is preferred so _prisma_migrations stays in sync.

-- 8. ApiKey (admin-issued HTTP API keys `mcl_…`)
CREATE TABLE IF NOT EXISTS "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "corsOrigins" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ApiKey_userId_idx" ON "ApiKey"("userId");
CREATE INDEX IF NOT EXISTS "ApiKey_keyPrefix_idx" ON "ApiKey"("keyPrefix");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ApiKey_userId_fkey'
  ) THEN
    ALTER TABLE "ApiKey"
      ADD CONSTRAINT "ApiKey_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
