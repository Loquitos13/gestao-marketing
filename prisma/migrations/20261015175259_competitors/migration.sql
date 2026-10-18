-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "competitorStatus" JSONB;

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "metaPageIds" TEXT[],
    "notes" TEXT,
    "suggested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorPage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "competitorId" TEXT,
    "url" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "title" TEXT,
    "metaDescription" TEXT,
    "h1" TEXT[],
    "h2" TEXT[],
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "canonical" TEXT,
    "lang" TEXT,
    "structuredData" TEXT[],
    "lastModified" TIMESTAMP(3),
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorAd" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "competitorId" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "pageName" TEXT NOT NULL,
    "bodies" TEXT[],
    "titles" TEXT[],
    "descriptions" TEXT[],
    "captions" TEXT[],
    "platforms" TEXT[],
    "startDate" TIMESTAMP(3),
    "stopDate" TIMESTAMP(3),
    "snapshotUrl" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorAd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordIdea" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "competitorId" TEXT,
    "source" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "avgMonthlySearches" INTEGER,
    "competition" TEXT,
    "competitionIndex" INTEGER,
    "lowCpc" DECIMAL(18,2),
    "highCpc" DECIMAL(18,2),
    "currency" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordIdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageSpeedResult" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "competitorId" TEXT,
    "url" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'mobile',
    "score" DOUBLE PRECISION,
    "lcpMs" DOUBLE PRECISION,
    "inpMs" DOUBLE PRECISION,
    "cls" DOUBLE PRECISION,
    "fieldData" BOOLEAN NOT NULL DEFAULT false,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageSpeedResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Competitor_clientId_idx" ON "Competitor"("clientId");

-- CreateIndex
CREATE INDEX "CompetitorPage_clientId_competitorId_idx" ON "CompetitorPage"("clientId", "competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorPage_clientId_url_key" ON "CompetitorPage"("clientId", "url");

-- CreateIndex
CREATE INDEX "CompetitorAd_clientId_competitorId_idx" ON "CompetitorAd"("clientId", "competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorAd_clientId_source_externalId_key" ON "CompetitorAd"("clientId", "source", "externalId");

-- CreateIndex
CREATE INDEX "KeywordIdea_clientId_fetchedAt_idx" ON "KeywordIdea"("clientId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordIdea_clientId_seed_keyword_key" ON "KeywordIdea"("clientId", "seed", "keyword");

-- CreateIndex
CREATE INDEX "PageSpeedResult_clientId_url_fetchedAt_idx" ON "PageSpeedResult"("clientId", "url", "fetchedAt");

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorPage" ADD CONSTRAINT "CompetitorPage_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorAd" ADD CONSTRAINT "CompetitorAd_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordIdea" ADD CONSTRAINT "KeywordIdea_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageSpeedResult" ADD CONSTRAINT "PageSpeedResult_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
