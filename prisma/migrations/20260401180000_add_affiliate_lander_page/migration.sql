-- CreateTable
CREATE TABLE "AffiliateLanderPage" (
    "id" TEXT NOT NULL,
    "suffix" TEXT NOT NULL,
    "published" JSONB NOT NULL,
    "draft" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateLanderPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateLanderPage_suffix_key" ON "AffiliateLanderPage"("suffix");

-- CreateIndex
CREATE INDEX "AffiliateLanderPage_suffix_idx" ON "AffiliateLanderPage"("suffix");
