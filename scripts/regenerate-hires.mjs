import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = "/home/user/wsi";
const INPUT_DIR = path.join(ROOT, "images");
const OUTPUT_DIR = path.join(ROOT, "public", "analysis-samples", "hires");

const toSlug = (name) =>
  name
    .replace(/\.(tif|tiff)$/i, "")
    .replace(/_/g, "-")
    .toLowerCase();

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const run = async () => {
  ensureDir(OUTPUT_DIR);
  const files = fs
    .readdirSync(INPUT_DIR)
    .filter((file) => /\.(tif|tiff)$/i.test(file))
    .sort();

  if (files.length === 0) {
    console.log("No TIFF files found in", INPUT_DIR);
    return;
  }

  for (const file of files) {
    const inputPath = path.join(INPUT_DIR, file);
    const slug = toSlug(file);
    const outputPath = path.join(OUTPUT_DIR, `${slug}.png`);
    console.log("Generating", outputPath);

    const image = sharp(inputPath, { limitInputPixels: false });
    const meta = await image.metadata();
    const targetWidth = meta.width ? Math.round(meta.width / 4) : undefined;
    const targetHeight = meta.height ? Math.round(meta.height / 4) : undefined;

    await image
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toFile(outputPath);
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
