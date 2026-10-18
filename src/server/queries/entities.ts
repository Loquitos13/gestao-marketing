import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface CampaignInfo {
  id: string;
  externalId: string;
  name: string;
  platform: Platform;
  status: string;
  objective: string | null;
  campaignType: string | null;
  biddingStrategy: string | null;
  dailyBudget: number | null;
}

export interface AdInfo {
  externalId: string;
  name: string;
  status: string;
  adType: string | null;
  finalUrl: string | null;
  headlines: string[];
  descriptions: string[];
  adGroupExternalId: string;
  adGroupName: string;
  campaignExternalId: string;
  campaignName: string;
  platform: Platform;
  createdTime: Date | null;
  creative: {
    format: string | null;
    primaryText: string | null;
    title: string | null;
    description: string | null;
    callToAction: string | null;
    imageUrl: string | null;
    thumbnailUrl: string | null;
  } | null;
}

export async function loadEntities(clientId: string) {
  const campaigns = await prisma.campaign.findMany({
    where: { clientId },
    include: { adGroups: { include: { ads: { include: { creative: true } } } } },
    orderBy: { name: "asc" },
  });
  const campaignMap = new Map<string, CampaignInfo>();
  const adGroupMap = new Map<string, { name: string; campaignExternalId: string }>();
  const adMap = new Map<string, AdInfo>();
  for (const c of campaigns) {
    campaignMap.set(c.externalId, {
      id: c.id,
      externalId: c.externalId,
      name: c.name,
      platform: c.platform,
      status: c.status,
      objective: c.objective,
      campaignType: c.campaignType,
      biddingStrategy: c.biddingStrategy,
      dailyBudget: c.dailyBudget === null ? null : Number(c.dailyBudget),
    });
    for (const g of c.adGroups) {
      adGroupMap.set(g.externalId, { name: g.name, campaignExternalId: c.externalId });
      for (const a of g.ads) {
        adMap.set(a.externalId, {
          externalId: a.externalId,
          name: a.name,
          status: a.status,
          adType: a.adType,
          finalUrl: a.finalUrl,
          headlines: a.headlines,
          descriptions: a.descriptions,
          adGroupExternalId: g.externalId,
          adGroupName: g.name,
          campaignExternalId: c.externalId,
          campaignName: c.name,
          platform: c.platform,
          createdTime: a.createdTime,
          creative: a.creative
            ? {
                format: a.creative.format,
                primaryText: a.creative.primaryText,
                title: a.creative.title,
                description: a.creative.description,
                callToAction: a.creative.callToAction,
                imageUrl: a.creative.imageUrl,
                thumbnailUrl: a.creative.thumbnailUrl,
              }
            : null,
        });
      }
    }
  }
  return { campaigns: campaignMap, adGroups: adGroupMap, ads: adMap };
}

export type Entities = Awaited<ReturnType<typeof loadEntities>>;
