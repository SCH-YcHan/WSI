import AnalysisDetailClient from "./AnalysisDetailClient";

export default async function AnalysisDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const raw = decodeURIComponent(slug).toLowerCase();
  const normalized = raw.replace(/^analysis-samples\//, "").replace(/\.jpg$/i, "");

  return <AnalysisDetailClient slug={normalized} />;
}
