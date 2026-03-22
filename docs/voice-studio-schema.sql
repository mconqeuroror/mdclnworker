CREATE TABLE IF NOT EXISTS "VoicePlatformConfig" (
  "id" TEXT NOT NULL,
  "maxCustomElevenLabsVoices" INTEGER NOT NULL DEFAULT 200,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoicePlatformConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ModelVoice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'elevenlabs',
  "elevenLabsVoiceId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "language" TEXT,
  "previewUrl" TEXT,
  "sampleAudioUrl" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelVoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModelVoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ModelVoice_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "SavedModel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ModelVoice_elevenLabsVoiceId_key" ON "ModelVoice"("elevenLabsVoiceId");
CREATE INDEX IF NOT EXISTS "ModelVoice_userId_createdAt_idx" ON "ModelVoice"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ModelVoice_modelId_createdAt_idx" ON "ModelVoice"("modelId", "createdAt");
CREATE INDEX IF NOT EXISTS "ModelVoice_modelId_isDefault_idx" ON "ModelVoice"("modelId", "isDefault");

CREATE TABLE IF NOT EXISTS "GeneratedVoiceAudio" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "voiceId" TEXT,
  "script" TEXT NOT NULL,
  "characterCount" INTEGER NOT NULL,
  "estimatedDurationSec" INTEGER,
  "actualDurationSec" DOUBLE PRECISION,
  "creditsCost" INTEGER NOT NULL,
  "isRegeneration" BOOLEAN NOT NULL DEFAULT FALSE,
  "sourceAudioId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "audioUrl" TEXT,
  "errorMessage" TEXT,
  "voiceNameSnapshot" TEXT,
  "voiceTypeSnapshot" TEXT,
  "elevenLabsVoiceIdSnapshot" TEXT,
  "previewUrlSnapshot" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeneratedVoiceAudio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GeneratedVoiceAudio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GeneratedVoiceAudio_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "SavedModel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GeneratedVoiceAudio_voiceId_fkey" FOREIGN KEY ("voiceId") REFERENCES "ModelVoice"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GeneratedVoiceAudio_sourceAudioId_fkey" FOREIGN KEY ("sourceAudioId") REFERENCES "GeneratedVoiceAudio"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "GeneratedVoiceAudio_userId_createdAt_idx" ON "GeneratedVoiceAudio"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "GeneratedVoiceAudio_modelId_createdAt_idx" ON "GeneratedVoiceAudio"("modelId", "createdAt");
CREATE INDEX IF NOT EXISTS "GeneratedVoiceAudio_voiceId_createdAt_idx" ON "GeneratedVoiceAudio"("voiceId", "createdAt");
CREATE INDEX IF NOT EXISTS "GeneratedVoiceAudio_sourceAudioId_idx" ON "GeneratedVoiceAudio"("sourceAudioId");
CREATE INDEX IF NOT EXISTS "GeneratedVoiceAudio_status_createdAt_idx" ON "GeneratedVoiceAudio"("status", "createdAt");
