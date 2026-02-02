import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const ROOT = process.env.WSI_ROOT || process.cwd();
const GEOJSON_DIR = path.join(ROOT, "predictions", "geojson");
const STATUS_DIR = path.join(ROOT, "predictions", "status");
const PID_DIR = path.join(ROOT, "predictions", "pids");
const LOG_DIR = path.join(ROOT, "predictions", "logs");
const OVERVIEW_DIR = path.join(ROOT, "overviews");

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const paths = [
    path.join(GEOJSON_DIR, `${sessionId}.geojson`),
    path.join(STATUS_DIR, `${sessionId}.json`),
    path.join(PID_DIR, `${sessionId}.pid`),
    path.join(LOG_DIR, `${sessionId}.log`),
    path.join(OVERVIEW_DIR, `${sessionId}.png`),
  ];

  for (const p of paths) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // ignore
    }
  }

  return new Response(JSON.stringify({ message: "ok" }), {
    headers: { "Content-Type": "application/json" },
  });
}
