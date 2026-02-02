import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

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

  const filePath = path.join(ROOT, "images", sample.tif);
  if (!fs.existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const stream = fs.createReadStream(filePath);
  const body = Readable.toWeb(stream) as ReadableStream;

  return new Response(body, {
    headers: {
      "Content-Type": "image/tiff",
      "Content-Length": stat.size.toString(),
      "Content-Disposition": `attachment; filename=\"${sample.tif}\"`,
    },
  });
}
