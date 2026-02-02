import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

export const runtime = "nodejs";

const ROOT = process.env.WSI_ROOT || process.cwd();
const IMAGE_DIR = path.join(ROOT, "images");
const GEOJSON_DIR = path.join(ROOT, "predictions", "geojson");
const OVERVIEW_DIR = path.join(ROOT, "overviews");

function slugFromFile(fileName: string) {
  return fileName.replace(/\.(tif|tiff)$/i, "");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const url = new URL(req.url);
  const fileName = url.searchParams.get("fileName");
  if (!fileName) {
    return new Response("fileName is required", { status: 400 });
  }

  const geoPath = path.join(GEOJSON_DIR, `${sessionId}.geojson`);
  const wsiPath = path.join(IMAGE_DIR, path.basename(fileName));

  if (!fs.existsSync(geoPath) || !fs.existsSync(wsiPath)) {
    return new Response("Not found", { status: 404 });
  }

  const raw = fs.readFileSync(geoPath, "utf-8");
  const data = JSON.parse(raw);
  const meta = await sharp(wsiPath, { limitInputPixels: false }).metadata();
  let targetWidth = meta.width ?? null;
  let targetHeight = meta.height ?? null;
  const overviewPath = path.join(OVERVIEW_DIR, `${sessionId}.png`);
  if (fs.existsSync(overviewPath)) {
    const overviewMeta = await sharp(overviewPath).metadata();
    if (overviewMeta.width && overviewMeta.height) {
      targetWidth = overviewMeta.width;
      targetHeight = overviewMeta.height;
    }
  }

  const scaleX =
    targetWidth && meta.width ? Number(targetWidth) / Number(meta.width) : 1;
  const scaleY =
    targetHeight && meta.height ? Number(targetHeight) / Number(meta.height) : 1;
  const shouldScale = scaleX !== 1 || scaleY !== 1;

  const scaledData = shouldScale
    ? {
        ...data,
        features: (data.features || []).map((feature: any) => {
          const geometry = feature?.geometry;
          if (!geometry || !geometry.type || !geometry.coordinates) {
            return feature;
          }
          if (geometry.type === "Polygon") {
            const coords = (geometry.coordinates || []).map((ring: any[]) =>
              ring.map(([x, y]: [number, number]) => [x * scaleX, y * scaleY])
            );
            return {
              ...feature,
              geometry: { ...geometry, coordinates: coords },
            };
          }
          if (geometry.type === "MultiPolygon") {
            const coords = (geometry.coordinates || []).map((poly: any[]) =>
              poly.map((ring: any[]) =>
                ring.map(([x, y]: [number, number]) => [x * scaleX, y * scaleY])
              )
            );
            return {
              ...feature,
              geometry: { ...geometry, coordinates: coords },
            };
          }
          return feature;
        }),
      }
    : data;

  return new Response(
    JSON.stringify({
      width: targetWidth,
      height: targetHeight,
      data: scaledData,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}
