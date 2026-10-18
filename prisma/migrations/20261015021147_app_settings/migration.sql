-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
