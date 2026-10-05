-- Refresh con rotación + invalidación por cambio de clave + Argon2id
ALTER TABLE "User" ADD COLUMN "passwordAlgo" TEXT NOT NULL DEFAULT 'bcrypt';
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "PlatformUser" ADD COLUMN "passwordAlgo" TEXT NOT NULL DEFAULT 'bcrypt';
ALTER TABLE "PlatformUser" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_kind_idx" ON "RefreshToken"("userId", "kind");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");
