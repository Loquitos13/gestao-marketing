import { notFound } from "next/navigation";
import { findSharedReport } from "@/server/reports/service";
import type { ReportData } from "@/server/reports/build";
import { ReportView } from "@/components/report-view";
import { buttonClass } from "@/components/ui";

export const metadata = { title: "Relatório partilhado", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await findSharedReport(token);
  if (!report?.data) notFound();
  return (
    <main className="min-h-screen bg-hover px-4 py-8">
      <div className="no-print mx-auto mb-4 flex max-w-5xl justify-end">
        <a href={`/api/share/${token}/pdf`} className={buttonClass("secondary", "sm")}>
          Descarregar PDF
        </a>
      </div>
      <ReportView d={report.data as unknown as ReportData} title={report.title} />
    </main>
  );
}
