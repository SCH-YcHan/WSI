import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

export const runtime = "nodejs";

const ROOT = process.env.WSI_ROOT || process.cwd();
const OVERVIEW_DIR = path.join(ROOT, "overviews");
const IMAGE_DIR = path.join(ROOT, "images");
const SCRIPT_PATH = path.join(ROOT, "code", "06_generate_overview.py");

function slugFromFile(fileName: string) {
  return fileName.replace(/\.(tif|tiff)$/i, "");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  if (mode === "exists") {
    const imgPath = path.join(OVERVIEW_DIR, `${sessionId}.png`);
    return new Response(JSON.stringify({ exists: fs.existsSync(imgPath) }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const imgPath = path.join(OVERVIEW_DIR, `${sessionId}.png`);
  if (!fs.existsSync(imgPath)) {
    return new Response("Not found", { status: 404 });
  }

  const stat = fs.statSync(imgPath);
  const stream = fs.createReadStream(imgPath);
  const body = Readable.toWeb(stream) as ReadableStream;

  return new Response(body, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": stat.size.toString(),
      "Cache-Control": "no-store",
    },
  });
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
  const outPath = path.join(OVERVIEW_DIR, `${sessionId}.png`);
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

  await fs.promises.mkdir(OVERVIEW_DIR, { recursive: true });
  const defaultPython = path.join(ROOT, "scripts", "run-wsi-python");
  const pythonBin = process.env.WSI_PYTHON_BIN || defaultPython;
  if (!fs.existsSync(SCRIPT_PATH)) {
    return new Response("Overview script not found", { status: 500 });
  }

  const args = [
    SCRIPT_PATH,
    "--wsi_path",
    wsiPath,
    "--out_png",
    outPath,
    "--overview_max_side",
    process.env.WSI_OVERVIEW_MAX_SIDE || "2400",
    "--overview_max_width",
    process.env.WSI_OVERVIEW_MAX_WIDTH || "600",
    "--overview_max_height",
    process.env.WSI_OVERVIEW_MAX_HEIGHT || "700",
  ];

  const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const proc = spawn(pythonBin, args, { cwd: ROOT });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ code, stderr }));
  });

  if (result.code !== 0) {
    return new Response(result.stderr || "Failed to generate overview", { status: 500 });
  }

  return new Response(JSON.stringify({ message: "ok", overview: outPath }), {
    headers: { "Content-Type": "application/json" },
  });
}
