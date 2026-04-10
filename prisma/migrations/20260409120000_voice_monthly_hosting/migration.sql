-- Custom ElevenLabs voice — monthly hosting fee tracking (per ModelVoice row)
ALTER TABLE "ModelVoice" ADD COLUMN "voiceMonthlyLastBilledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ModelVoice" ADD COLUMN "voiceBillingStatus" TEXT NOT NULL DEFAULT 'active';

-- First renewal anchor: 30 days after voice creation (existing voices past 30d bill on next billing run)
UPDATE "ModelVoice" SET "voiceMonthlyLastBilledAt" = "createdAt";

-- Legacy single-voice-on-SavedModel (no ModelVoice rows) — same idea
ALTER TABLE "SavedModel" ADD COLUMN "legacyVoiceMonthlyLastBilledAt" TIMESTAMP(3);
ALTER TABLE "SavedModel" ADD COLUMN "legacyVoiceBillingSuspended" BOOLEAN NOT NULL DEFAULT false;

UPDATE "SavedModel" AS m
SET "legacyVoiceMonthlyLastBilledAt" = m."createdAt"
WHERE m."elevenLabsVoiceId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ModelVoice" mv WHERE mv."modelId" = m."id");
