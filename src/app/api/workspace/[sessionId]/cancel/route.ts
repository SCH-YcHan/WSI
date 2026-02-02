import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const ROOT = process.env.WSI_ROOT || process.cwd();
const STATUS_DIR = path.join(ROOT, "predictions", "status");
const PID_DIR = path.join(ROOT, "predictions", "pids");

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  let payload: { fileName?: string } = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const pidPath = path.join(PID_DIR, `${sessionId}.pid`);
  const statusPath = path.join(STATUS_DIR, `${sessionId}.json`);

  if (!fs.existsSync(pidPath)) {
    return new Response("No running prediction", { status: 404 });
  }

  const pid = Number(fs.readFileSync(pidPath, "utf-8"));
  if (!Number.isFinite(pid)) {
    return new Response("Invalid pid", { status: 500 });
  }

  try {
    // Kill the entire process group started by detached spawn.
    process.kill(-pid, "SIGTERM");
  } catch (err: any) {
    if (err?.code !== "ESRCH") {
      return new Response(err?.message ?? "Failed to cancel", { status: 500 });
    }
  }

  // Give it a moment, then hard kill if still alive.
  try {
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (fs.existsSync(`/proc/${pid}`)) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (err: any) {
        if (err?.code !== "ESRCH") {
          throw err;
        }
      }
    }
  } catch {
    // ignore hard-kill failures
  } finally {
    try {
      fs.unlinkSync(pidPath);
    } catch {
      // ignore
    }
  }

  fs.writeFileSync(
    statusPath,
    JSON.stringify({ state: "cancelled", updated_at: Date.now() / 1000 }),
    "utf-8"
  );

  return new Response(JSON.stringify({ message: "cancelled" }), {
    headers: { "Content-Type": "application/json" },
  });
}
