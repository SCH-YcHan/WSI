import AnalysisDetailClient from "./AnalysisDetailClient";

const samples = [
  "wt1-adenine-x20",
  "wt2-adenine-x20",
  "wt3-adenine-x20",
  "wt4-normal-x20",
  "wt5-normal-x20",
  "wt6-normal-x20",
] as const;

export function generateStaticParams() {
  return samples.map((slug) => ({ slug }));
}

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
