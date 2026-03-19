-- AlterTable
ALTER TABLE "SavedModel" ADD COLUMN "elevenLabsVoiceId" TEXT;
ALTER TABLE "SavedModel" ADD COLUMN "elevenLabsVoiceType" TEXT;
ALTER TABLE "SavedModel" ADD COLUMN "elevenLabsVoiceName" TEXT;
ALTER TABLE "SavedModel" ADD COLUMN "modelVoicePreviewUrl" TEXT;

-- CreateTable
CREATE TABLE "VoicePlatformConfig" (
    "id" TEXT NOT NULL,
    "maxCustomElevenLabsVoices" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoicePlatformConfig_pkey" PRIMARY KEY ("id")
);

INSERT INTO "VoicePlatformConfig" ("id", "maxCustomElevenLabsVoices", "createdAt", "updatedAt")
VALUES ('global', 200, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
