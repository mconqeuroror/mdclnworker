-- CreateTable
CREATE TABLE "TutorialSlotVideo" (
    "slotKey" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TutorialSlotVideo_pkey" PRIMARY KEY ("slotKey")
);
