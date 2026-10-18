-- CreateEnum
CREATE TYPE "AdChangeStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'APPLYING', 'APPLIED', 'FAILED', 'REVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdChangeOperation" AS ENUM ('SET_STATUS', 'SET_DAILY_BUDGET', 'CREATE_AD', 'UPDATE_AD', 'ADD_KEYWORDS');

-- AlterTable
ALTER TABLE "AdGroup" ADD COLUMN     "dailyBudget" DECIMAL(18,4),
ADD COLUMN     "raw" JSONB;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "adsManagementEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxBudgetStepPct" DECIMAL(4,3) NOT NULL DEFAULT 0.2;

-- CreateTable
CREATE TABLE "AdChange" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "operation" "AdChangeOperation" NOT NULL,
    "entityLevel" TEXT NOT NULL,
    "entityId" TEXT,
    "externalId" TEXT,
    "entityName" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "recommendationId" TEXT,
    "planId" TEXT,
    "revertOfId" TEXT,
    "status" "AdChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "validation" JSONB,
    "error" TEXT,
    "createdById" TEXT,
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "AdChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdChange_clientId_status_idx" ON "AdChange"("clientId", "status");

-- CreateIndex
CREATE INDEX "AdChange_planId_idx" ON "AdChange"("planId");

-- AddForeignKey
ALTER TABLE "AdChange" ADD CONSTRAINT "AdChange_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdChange" ADD CONSTRAINT "AdChange_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
