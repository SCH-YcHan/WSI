import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

export const runtime = "nodejs";
const ROOT = process.env.WSI_ROOT || process.cwd();

const samples: Record<string, { tif: string }> = {
  "wt1-adenine-x20": { tif: "WT1-Adenine_x20.tif" },
  "wt2-adenine-x20": { tif: "WT2-Adenine_x20.tif" },
  "wt3-adenine-x20": { tif: "WT3-Adenine_x20.tif" },
  "wt4-normal-x20": { tif: "WT4-Normal_x20.tif" },
  "wt5-normal-x20": { tif: "WT5-Normal_x20.tif" },
  "wt6-normal-x20": { tif: "WT6-Normal_x20.tif" },
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const normalized = decodeURIComponent(slug).toLowerCase();
  const sample = samples[normalized];

  if (!sample) {
    return new Response("Not found", { status: 404 });
  }

  const tifPath = path.join(ROOT, "images", sample.tif);
  const geoPath = path.join(
    path.join(ROOT, "geojson"),
    sample.tif.replace(/\.tif$/i, ".geojson")
  );

  if (!fs.existsSync(geoPath) || !fs.existsSync(tifPath)) {
    return new Response("Not found", { status: 404 });
  }

  const raw = fs.readFileSync(geoPath, "utf-8");
  const data = JSON.parse(raw);

  const meta = await sharp(tifPath, { limitInputPixels: false }).metadata();

  return new Response(
    JSON.stringify({
      width: meta.width ?? null,
      height: meta.height ?? null,
      data,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}
