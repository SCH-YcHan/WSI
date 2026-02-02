import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const runtime = "nodejs";

const ROOT = process.env.WSI_ROOT || process.cwd();
const IMAGE_DIR = path.join(ROOT, "images");
const GEOJSON_DIR = path.join(ROOT, "predictions", "geojson");
const OVERVIEW_DIR = path.join(ROOT, "overviews");
const STATUS_DIR = path.join(ROOT, "predictions", "status");
const PID_DIR = path.join(ROOT, "predictions", "pids");
const LOG_DIR = path.join(ROOT, "predictions", "logs");
const SCRIPT_PATH = path.join(ROOT, "code", "04_predict_wsi_glomeruli.py");

function slugFromFile(fileName: string) {
  return fileName.replace(/\.(tif|tiff)$/i, "");
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  let payload: { fileName?: string; downloadUrl?: string } = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const rawName = payload.fileName;
  if (!rawName) {
    return new Response("fileName is required", { status: 400 });
  }
  const fileName = path.basename(rawName);
  if (!fileName) {
    return new Response("fileName is required", { status: 400 });
  }

  const wsiPath = path.join(IMAGE_DIR, fileName);
  if (!fs.existsSync(wsiPath)) {
    const url = payload.downloadUrl;
    if (!url) {
      return new Response("WSI file not found", { status: 404 });
    }
    await fs.promises.mkdir(IMAGE_DIR, { recursive: true });
    const resp = await fetch(url);
    if (!resp.ok || !resp.body) {
      return new Response("Failed to download WSI file", { status: 500 });
    }
    const fileStream = fs.createWriteStream(wsiPath);
    const body = Readable.fromWeb(resp.body as ReadableStream);
    await pipeline(body, fileStream);
  }

  const defaultWeights = path.join(ROOT, "weights", "best.pt");
  const weights = process.env.WSI_GLOMERULUS_WEIGHTS || defaultWeights;
  if (!fs.existsSync(weights)) {
    return new Response("WSI_GLOMERULUS_WEIGHTS is not set or missing", { status: 500 });
  }

  const defaultPython = path.join(ROOT, "scripts", "run-wsi-python");
  const pythonBin = process.env.WSI_PYTHON_BIN || (fs.existsSync(defaultPython) ? defaultPython : "python3");
  if (!fs.existsSync(SCRIPT_PATH)) {
    return new Response("Prediction script not found", { status: 500 });
  }

  const slug = slugFromFile(fileName);
  const outGeo = path.join(GEOJSON_DIR, `${sessionId}.geojson`);
  const outOverview = path.join(OVERVIEW_DIR, `${sessionId}.png`);
  const statusFile = path.join(STATUS_DIR, `${sessionId}.json`);

  await fs.promises.mkdir(GEOJSON_DIR, { recursive: true });
  await fs.promises.mkdir(OVERVIEW_DIR, { recursive: true });
  await fs.promises.mkdir(STATUS_DIR, { recursive: true });
  await fs.promises.mkdir(PID_DIR, { recursive: true });
  await fs.promises.mkdir(LOG_DIR, { recursive: true });

  if (fs.existsSync(statusFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
      if (prev?.state && prev.state !== "done" && prev.state !== "failed" && prev.state !== "cancelled") {
        return new Response("Prediction already running", { status: 409 });
      }
    } catch {
      // ignore malformed status
    }
  }

  fs.writeFileSync(
    statusFile,
    JSON.stringify({ state: "queued", updated_at: Date.now() / 1000 }),
    "utf-8"
  );

  const args = [
    SCRIPT_PATH,
    "--wsi_path",
    wsiPath,
    "--weights",
    weights,
    "--out_geojson",
    outGeo,
    "--out_overview",
    outOverview,
    "--device",
    "cpu",
    "--batch_size",
    process.env.WSI_BATCH_SIZE || "16",
    "--progress_file",
    statusFile,
    "--overview_max_width",
    process.env.WSI_OVERVIEW_MAX_WIDTH || "600",
    "--overview_max_height",
    process.env.WSI_OVERVIEW_MAX_HEIGHT || "700",
  ];

  const logPath = path.join(LOG_DIR, `${sessionId}.log`);
  const out = fs.openSync(logPath, "a");
  const proc = spawn(pythonBin, args, {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
  });
  proc.unref();
  fs.writeFileSync(path.join(PID_DIR, `${sessionId}.pid`), String(proc.pid), "utf-8");

  proc.on("close", (code) => {
    if (code === 0) return;
    try {
      fs.writeFileSync(
        statusFile,
        JSON.stringify({ state: "failed", updated_at: Date.now() / 1000, code }),
        "utf-8"
      );
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(path.join(PID_DIR, `${sessionId}.pid`));
    } catch {
      // ignore
    }
  });

  return new Response(
    JSON.stringify({
      message: "started",
      sessionId,
      geojson: outGeo,
      overview: outOverview,
      status: statusFile,
      slug,
      log: logPath,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
