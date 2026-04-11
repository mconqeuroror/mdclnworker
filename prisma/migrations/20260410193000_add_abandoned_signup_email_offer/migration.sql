CREATE TABLE "AbandonedSignupEmailOffer" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "discountCodeId" TEXT,
  "discountCode" TEXT NOT NULL,
  "discountPercent" INTEGER NOT NULL DEFAULT 15,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "convertedAt" TIMESTAMP(3),
  "membershipTxId" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AbandonedSignupEmailOffer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AbandonedSignupEmailOffer_userId_key" ON "AbandonedSignupEmailOffer"("userId");
CREATE INDEX "AbandonedSignupEmailOffer_status_scheduledFor_idx" ON "AbandonedSignupEmailOffer"("status", "scheduledFor");
CREATE INDEX "AbandonedSignupEmailOffer_sentAt_idx" ON "AbandonedSignupEmailOffer"("sentAt");
CREATE INDEX "AbandonedSignupEmailOffer_convertedAt_idx" ON "AbandonedSignupEmailOffer"("convertedAt");
CREATE INDEX "AbandonedSignupEmailOffer_email_idx" ON "AbandonedSignupEmailOffer"("email");

ALTER TABLE "AbandonedSignupEmailOffer"
  ADD CONSTRAINT "AbandonedSignupEmailOffer_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
