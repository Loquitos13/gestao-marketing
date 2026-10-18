-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('GOOGLE', 'META', 'SEMRUSH', 'DEMO');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('GOOGLE_ADS', 'META_ADS', 'SEARCH_CONSOLE', 'GA4', 'META_ORGANIC', 'SEMRUSH');

-- CreateEnum
CREATE TYPE "DataOrigin" AS ENUM ('REAL', 'SIMULATED');

-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncKind" AS ENUM ('INCREMENTAL', 'HISTORICAL', 'ENTITIES');

-- CreateEnum
CREATE TYPE "MetricLevel" AS ENUM ('ACCOUNT', 'CAMPAIGN', 'AD_GROUP', 'AD');

-- CreateEnum
CREATE TYPE "GoalMetric" AS ENUM ('LEADS', 'CONVERSIONS', 'REVENUE', 'CPA_MAX', 'CPL_MAX', 'ROAS_MIN', 'CTR_MIN', 'SESSIONS', 'ORGANIC_CLICKS', 'AVG_POSITION_MAX');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'GENERATED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('NEW', 'IN_REVIEW', 'APPROVED', 'DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RecommendationSource" AS ENUM ('RULE', 'STATISTICAL', 'AI');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'pt-PT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "brandColor" TEXT NOT NULL DEFAULT '#4f46e5',
    "logoUrl" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "defaultTimezone" TEXT NOT NULL DEFAULT 'Europe/Lisbon',
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 1095,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientMember" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "objectives" TEXT,
    "monthlyBudget" DECIMAL(18,2),
    "grossMargin" DECIMAL(5,4),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Lisbon',
    "locale" TEXT NOT NULL DEFAULT 'pt-PT',
    "internalNotes" TEXT,
    "contractStatus" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "externalUserId" TEXT,
    "externalUserName" TEXT,
    "scopes" TEXT[],
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastRefreshedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT,
    "timezone" TEXT,
    "managerId" TEXT,
    "metadata" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "connectedAccountId" TEXT,
    "platform" "Platform" NOT NULL,
    "origin" "DataOrigin" NOT NULL DEFAULT 'REAL',
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "dataAvailableUntil" DATE,
    "historyStartDate" DATE,
    "lastError" TEXT,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "kind" "SyncKind" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "rangeStart" DATE,
    "rangeEnd" DATE,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "rowsUpserted" INTEGER NOT NULL DEFAULT 0,
    "requestedBy" TEXT,
    "error" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "objective" TEXT,
    "campaignType" TEXT,
    "biddingStrategy" TEXT,
    "dailyBudget" DECIMAL(18,4),
    "startDate" DATE,
    "endDate" DATE,
    "raw" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdGroup" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "targeting" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "adType" TEXT,
    "finalUrl" TEXT,
    "headlines" TEXT[],
    "descriptions" TEXT[],
    "creativeId" TEXT,
    "createdTime" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creative" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "format" TEXT,
    "primaryText" TEXT,
    "title" TEXT,
    "description" TEXT,
    "callToAction" TEXT,
    "imageUrl" TEXT,
    "videoId" TEXT,
    "thumbnailUrl" TEXT,
    "postId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdMetricDaily" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "level" "MetricLevel" NOT NULL,
    "campaignExternalId" TEXT NOT NULL,
    "adGroupExternalId" TEXT NOT NULL DEFAULT '',
    "adExternalId" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "interactions" BIGINT,
    "reach" BIGINT,
    "linkClicks" BIGINT,
    "outboundClicks" BIGINT,
    "landingPageViews" BIGINT,
    "conversions" DECIMAL(18,4),
    "allConversions" DECIMAL(18,4),
    "conversionValue" DECIMAL(18,4),
    "allConversionValue" DECIMAL(18,4),
    "leads" DECIMAL(18,4),
    "purchases" DECIMAL(18,4),
    "purchaseValue" DECIMAL(18,4),
    "videoViews" BIGINT,
    "thruplays" BIGINT,
    "videoP25" BIGINT,
    "videoP50" BIGINT,
    "videoP75" BIGINT,
    "videoP100" BIGINT,
    "engagements" BIGINT,
    "reactions" BIGINT,
    "comments" BIGINT,
    "shares" BIGINT,
    "messages" BIGINT,
    "calls" BIGINT,
    "searchImpressionShare" DECIMAL(7,6),
    "searchLostIsBudget" DECIMAL(7,6),
    "searchLostIsRank" DECIMAL(7,6),
    "eligibleImpressionsApprox" BIGINT,
    "extra" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdMetricDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignBreakdownDaily" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "campaignExternalId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dimension" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "conversions" DECIMAL(18,4),
    "conversionValue" DECIMAL(18,4),
    "leads" DECIMAL(18,4),

    CONSTRAINT "CampaignBreakdownDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsTermDaily" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "campaignExternalId" TEXT NOT NULL,
    "adGroupExternalId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "conversions" DECIMAL(18,4),
    "conversionValue" DECIMAL(18,4),

    CONSTRAINT "AdsTermDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchMetricDaily" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "positionSum" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "SearchMetricDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAnalyticsDaily" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "users" INTEGER,
    "newUsers" INTEGER,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "engagedSessions" INTEGER,
    "views" INTEGER,
    "events" INTEGER,
    "keyEvents" DOUBLE PRECISION,
    "purchases" DOUBLE PRECISION,
    "revenue" DECIMAL(18,4),
    "bounceRate" DOUBLE PRECISION,

    CONSTRAINT "WebAnalyticsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoKeywordSnapshot" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "keyword" TEXT,
    "position" DOUBLE PRECISION,
    "searchVolume" INTEGER,
    "url" TEXT,
    "estTraffic" DOUBLE PRECISION,
    "metricKey" TEXT,
    "metricValue" DOUBLE PRECISION,
    "isEstimate" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SeoKeywordSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "level" "MetricLevel" NOT NULL,
    "entityExternalId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "metrics" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganicContent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "contentType" TEXT,
    "title" TEXT,
    "text" TEXT,
    "mediaUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "impressions" INTEGER,
    "reach" INTEGER,
    "clicks" INTEGER,
    "reactions" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "videoViews" INTEGER,
    "watchTimeSec" INTEGER,
    "linkClicks" INTEGER,
    "conversions" DOUBLE PRECISION,
    "revenue" DECIMAL(18,4),
    "metricsAsOf" TIMESTAMP(3),
    "unavailable" TEXT[],

    CONSTRAINT "OrganicContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "platform" "Platform",
    "campaignId" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "metric" "GoalMetric" NOT NULL,
    "platform" "Platform",
    "target" DECIMAL(18,4) NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sections" TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "templateId" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "compareStart" DATE,
    "compareEnd" DATE,
    "sections" TEXT[],
    "comments" JSONB,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "data" JSONB,
    "containsSimulated" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "shareTokenHash" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "scheduleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "hour" INTEGER NOT NULL DEFAULT 8,
    "recipients" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDelivery" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" "RecommendationSource" NOT NULL DEFAULT 'RULE',
    "platform" "Platform",
    "entityLevel" TEXT,
    "entityId" TEXT,
    "entityName" TEXT,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "suggestedAction" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL,
    "impactEstimate" TEXT,
    "evidence" JSONB NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'NEW',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "executedExternally" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "Platform",
    "threshold" DOUBLE PRECISION NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 7,
    "recipients" TEXT[],
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ruleId" TEXT,
    "type" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastNotifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "clientId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "ClientMember_userId_idx" ON "ClientMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientMember_clientId_userId_key" ON "ClientMember"("clientId", "userId");

-- CreateIndex
CREATE INDEX "Client_organizationId_idx" ON "Client"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_organizationId_slug_key" ON "Client"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "OAuthCredential_organizationId_provider_idx" ON "OAuthCredential"("organizationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_credentialId_platform_externalId_key" ON "ConnectedAccount"("credentialId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "DataSource_clientId_platform_idx" ON "DataSource"("clientId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_clientId_platform_externalId_key" ON "DataSource"("clientId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "SyncJob_dataSourceId_queuedAt_idx" ON "SyncJob"("dataSourceId", "queuedAt");

-- CreateIndex
CREATE INDEX "SyncJob_status_idx" ON "SyncJob"("status");

-- CreateIndex
CREATE INDEX "SyncLog_syncJobId_idx" ON "SyncLog"("syncJobId");

-- CreateIndex
CREATE INDEX "Campaign_clientId_platform_idx" ON "Campaign"("clientId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_dataSourceId_externalId_key" ON "Campaign"("dataSourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AdGroup_campaignId_externalId_key" ON "AdGroup"("campaignId", "externalId");

-- CreateIndex
CREATE INDEX "Ad_creativeId_idx" ON "Ad"("creativeId");

-- CreateIndex
CREATE UNIQUE INDEX "Ad_adGroupId_externalId_key" ON "Ad"("adGroupId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Creative_dataSourceId_externalId_key" ON "Creative"("dataSourceId", "externalId");

-- CreateIndex
CREATE INDEX "AdMetricDaily_clientId_platform_level_date_idx" ON "AdMetricDaily"("clientId", "platform", "level", "date");

-- CreateIndex
CREATE INDEX "AdMetricDaily_dataSourceId_date_idx" ON "AdMetricDaily"("dataSourceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdMetricDaily_dataSourceId_level_campaignExternalId_adGroup_key" ON "AdMetricDaily"("dataSourceId", "level", "campaignExternalId", "adGroupExternalId", "adExternalId", "date");

-- CreateIndex
CREATE INDEX "CampaignBreakdownDaily_clientId_dimension_date_idx" ON "CampaignBreakdownDaily"("clientId", "dimension", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignBreakdownDaily_dataSourceId_campaignExternalId_date_key" ON "CampaignBreakdownDaily"("dataSourceId", "campaignExternalId", "date", "dimension", "value");

-- CreateIndex
CREATE INDEX "AdsTermDaily_clientId_kind_date_idx" ON "AdsTermDaily"("clientId", "kind", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdsTermDaily_dataSourceId_kind_adGroupExternalId_text_match_key" ON "AdsTermDaily"("dataSourceId", "kind", "adGroupExternalId", "text", "matchType", "date");

-- CreateIndex
CREATE INDEX "SearchMetricDaily_clientId_dimension_date_idx" ON "SearchMetricDaily"("clientId", "dimension", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SearchMetricDaily_dataSourceId_dimension_key_date_key" ON "SearchMetricDaily"("dataSourceId", "dimension", "key", "date");

-- CreateIndex
CREATE INDEX "WebAnalyticsDaily_clientId_dimension_date_idx" ON "WebAnalyticsDaily"("clientId", "dimension", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WebAnalyticsDaily_dataSourceId_dimension_key_date_key" ON "WebAnalyticsDaily"("dataSourceId", "dimension", "key", "date");

-- CreateIndex
CREATE INDEX "SeoKeywordSnapshot_clientId_snapshotDate_idx" ON "SeoKeywordSnapshot"("clientId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceSnapshot_dataSourceId_level_entityExternalId_per_key" ON "PerformanceSnapshot"("dataSourceId", "level", "entityExternalId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "OrganicContent_clientId_publishedAt_idx" ON "OrganicContent"("clientId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrganicContent_dataSourceId_externalId_key" ON "OrganicContent"("dataSourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_date_base_quote_key" ON "ExchangeRate"("date", "base", "quote");

-- CreateIndex
CREATE INDEX "Budget_clientId_periodStart_idx" ON "Budget"("clientId", "periodStart");

-- CreateIndex
CREATE INDEX "Goal_clientId_idx" ON "Goal"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_shareTokenHash_key" ON "Report"("shareTokenHash");

-- CreateIndex
CREATE INDEX "Report_clientId_createdAt_idx" ON "Report"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportSchedule_enabled_nextRunAt_idx" ON "ReportSchedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "ReportDelivery_reportId_idx" ON "ReportDelivery"("reportId");

-- CreateIndex
CREATE INDEX "Recommendation_clientId_status_idx" ON "Recommendation"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_clientId_fingerprint_key" ON "Recommendation"("clientId", "fingerprint");

-- CreateIndex
CREATE INDEX "AlertRule_clientId_idx" ON "AlertRule"("clientId");

-- CreateIndex
CREATE INDEX "Alert_clientId_status_idx" ON "Alert"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_clientId_fingerprint_key" ON "Alert"("clientId", "fingerprint");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_clientId_createdAt_idx" ON "AuditLog"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthCredential" ADD CONSTRAINT "OAuthCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "OAuthCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdGroup" ADD CONSTRAINT "AdGroup_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_adGroupId_fkey" FOREIGN KEY ("adGroupId") REFERENCES "AdGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdMetricDaily" ADD CONSTRAINT "AdMetricDaily_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignBreakdownDaily" ADD CONSTRAINT "CampaignBreakdownDaily_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdsTermDaily" ADD CONSTRAINT "AdsTermDaily_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchMetricDaily" ADD CONSTRAINT "SearchMetricDaily_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAnalyticsDaily" ADD CONSTRAINT "WebAnalyticsDaily_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoKeywordSnapshot" ADD CONSTRAINT "SeoKeywordSnapshot_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceSnapshot" ADD CONSTRAINT "PerformanceSnapshot_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganicContent" ADD CONSTRAINT "OrganicContent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganicContent" ADD CONSTRAINT "OrganicContent_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ReportTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ReportSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ReportTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDelivery" ADD CONSTRAINT "ReportDelivery_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
