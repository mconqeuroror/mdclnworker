-- CreateTable
CREATE TABLE "NsfwPlanGenerationJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "userRequest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "selections" JSONB,
    "prompt" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "NsfwPlanGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NsfwPlanGenerationJob_userId_createdAt_idx" ON "NsfwPlanGenerationJob"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "NsfwPlanGenerationJob" ADD CONSTRAINT "NsfwPlanGenerationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
