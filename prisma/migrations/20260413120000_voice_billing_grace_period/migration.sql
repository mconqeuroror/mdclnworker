-- Add grace period tracking to ModelVoice so the billing service can enter
-- a 3-day grace period before deleting a voice when auto-charge fails.
ALTER TABLE "ModelVoice" ADD COLUMN "voiceBillingGraceEndsAt" TIMESTAMP(3);
