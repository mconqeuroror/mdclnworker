-- CreateTable (IF NOT EXISTS: safe if app bootstrapped the table or SQL was run manually)
CREATE TABLE IF NOT EXISTS "TutorialSlotVideo" (
    "slotKey" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TutorialSlotVideo_pkey" PRIMARY KEY ("slotKey")
);
