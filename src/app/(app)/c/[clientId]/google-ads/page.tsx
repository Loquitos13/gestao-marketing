import { pageContext } from "../page-context";
import { PlatformView } from "../platform-view";

export const metadata = { title: "Google Ads" };

export default async function GoogleAdsPage(props: { params: Promise<{ clientId: string }>; searchParams: Promise<Record<string, string>> }) {
  const page = await pageContext(props.params, props.searchParams);
  return <PlatformView page={page} platform="GOOGLE_ADS" />;
}
