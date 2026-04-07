-- Create immutable table for blocked child-sexual generation attempts.
CREATE TABLE IF NOT EXISTS "ChildSafetyIncident" (
    "id" TEXT NOT NULL,
    "userIdSnapshot" TEXT,
    "usernameSnapshot" TEXT,
    "emailSnapshot" TEXT,
    "ipAddress" TEXT,
    "region" TEXT,
    "routePath" TEXT,
    "generationMode" TEXT,
    "classifierCode" TEXT,
    "promptPreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChildSafetyIncident_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChildSafetyIncident_createdAt_idx" ON "ChildSafetyIncident"("createdAt");
CREATE INDEX IF NOT EXISTS "ChildSafetyIncident_generationMode_createdAt_idx" ON "ChildSafetyIncident"("generationMode", "createdAt");
CREATE INDEX IF NOT EXISTS "ChildSafetyIncident_classifierCode_createdAt_idx" ON "ChildSafetyIncident"("classifierCode", "createdAt");
CREATE INDEX IF NOT EXISTS "ChildSafetyIncident_emailSnapshot_createdAt_idx" ON "ChildSafetyIncident"("emailSnapshot", "createdAt");
