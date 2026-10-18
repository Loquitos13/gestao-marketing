-- AlterTable
ALTER TABLE "AgentConversation" ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summaryCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AgentMessage" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "evalTokens" INTEGER,
ADD COLUMN     "promptTokens" INTEGER;

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "evalTokens" INTEGER,
ADD COLUMN     "promptTokens" INTEGER;
