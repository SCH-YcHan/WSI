import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const ROOT = process.env.WSI_ROOT || process.cwd();
const STATUS_DIR = path.join(ROOT, "predictions", "status");

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const statusFile = path.join(STATUS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(statusFile)) {
    return new Response(
      JSON.stringify({ state: "idle", updated_at: Date.now() / 1000 }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const payload = fs.readFileSync(statusFile, "utf-8");
  return new Response(payload, {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
