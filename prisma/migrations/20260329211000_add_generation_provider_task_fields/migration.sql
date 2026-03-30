-- Generation provider/task metadata for Creator Studio video rollout
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

UPDATE "Generation"
SET "provider" = 'kie'
WHERE "provider" IS NULL;

ALTER TABLE "Generation"
  ALTER COLUMN "provider" SET DEFAULT 'kie';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Generation_originalGenerationId_fkey'
  ) THEN
    ALTER TABLE "Generation"
      ADD CONSTRAINT "Generation_originalGenerationId_fkey"
      FOREIGN KEY ("originalGenerationId") REFERENCES "Generation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Generation_providerTaskId_idx" ON "Generation"("providerTaskId");
CREATE INDEX IF NOT EXISTS "Generation_provider_providerModel_idx" ON "Generation"("provider", "providerModel");
CREATE INDEX IF NOT EXISTS "Generation_providerFamily_providerType_idx" ON "Generation"("providerFamily", "providerType");
CREATE INDEX IF NOT EXISTS "Generation_extendEligible_createdAt_idx" ON "Generation"("extendEligible", "createdAt");
CREATE INDEX IF NOT EXISTS "Generation_originalGenerationId_idx" ON "Generation"("originalGenerationId");
