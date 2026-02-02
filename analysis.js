const samples = {
  "wt1-adenine-x20": {
    title: "WT1 Adenine x20",
    image: "public/analysis-samples/hires/wt1-adenine-x20.png",
    geojson: "public/geojson/wt1-adenine-x20.geojson",
  },
  "wt2-adenine-x20": {
    title: "WT2 Adenine x20",
    image: "public/analysis-samples/hires/wt2-adenine-x20.png",
    geojson: "public/geojson/wt2-adenine-x20.geojson",
  },
  "wt3-adenine-x20": {
    title: "WT3 Adenine x20",
    image: "public/analysis-samples/hires/wt3-adenine-x20.png",
    geojson: "public/geojson/wt3-adenine-x20.geojson",
  },
  "wt4-normal-x20": {
    title: "WT4 Normal x20",
    image: "public/analysis-samples/hires/wt4-normal-x20.png",
    geojson: "public/geojson/wt4-normal-x20.geojson",
  },
  "wt5-normal-x20": {
    title: "WT5 Normal x20",
    image: "public/analysis-samples/hires/wt5-normal-x20.png",
    geojson: "public/geojson/wt5-normal-x20.geojson",
  },
  "wt6-normal-x20": {
    title: "WT6 Normal x20",
    image: "public/analysis-samples/hires/wt6-normal-x20.png",
    geojson: "public/geojson/wt6-normal-x20.geojson",
  },
};

const params = new URLSearchParams(window.location.search);
const slug = (params.get("slug") || "").toLowerCase();
const sample = samples[slug];

const titleEl = document.getElementById("sample-title");
const imageEl = document.getElementById("sample-image");
const overlayEl = document.getElementById("overlay");
const toggleEl = document.getElementById("toggle-overlay");
const statusEl = document.getElementById("status-text");

let overlayLoaded = false;
let overlayVisible = false;

function setError(text) {
  titleEl.textContent = "이미지를 찾을 수 없습니다.";
  statusEl.textContent = text;
  toggleEl.disabled = true;
}

function buildPath(rings) {
  return rings
    .map(
      (ring) =>
        ring
          .map((point, index) => `${index === 0 ? "M" : "L"}${point[0]} ${point[1]}`)
          .join(" ") + " Z"
    )
    .join(" ");
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function collectGeometry(featureCollection) {
  const paths = [];
  const points = [];
  featureCollection.features.forEach((feature) => {
    const geometry = feature.geometry;
    if (!geometry) return;

    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach((polygon) => {
      paths.push(buildPath(polygon));
      polygon.forEach((ring) => {
        ring.forEach(([x, y]) => {
          points.push([x, y]);
        });
      });
    });
  });
  return { paths, points };
}

function collectRobustBounds(points) {
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  }

  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = quantile(xs, 0.01);
  const minY = quantile(ys, 0.01);
  const maxX = quantile(xs, 0.99);
  const maxY = quantile(ys, 0.99);
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function scanTissue(imageData, width, height, step = 2) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  function isTissueAt(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const index = (y * width + x) * 4;
    const r = imageData[index];
    const g = imageData[index + 1];
    const b = imageData[index + 2];
    const a = imageData[index + 3];
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    return a > 0 && (r < 245 || g < 245 || b < 245 || spread > 8);
  }

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (!isTissueAt(x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: width,
      maxY: height,
      width: Math.max(1, width),
      height: Math.max(1, height),
      isTissueAt,
    };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    isTissueAt,
  };
}

function detectTissueBoundsFromImage() {
  const canvas = document.createElement("canvas");
  canvas.width = imageEl.naturalWidth;
  canvas.height = imageEl.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(imageEl, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return scanTissue(imageData.data, canvas.width, canvas.height);
}

function makeTransform(geoBounds, tissueBounds, flipX = false, flipY = false) {
  const scaleX = tissueBounds.width / geoBounds.width;
  const scaleY = tissueBounds.height / geoBounds.height;
  const matrixA = flipX ? -scaleX : scaleX;
  const matrixD = flipY ? -scaleY : scaleY;
  const matrixE = flipX
    ? tissueBounds.maxX + geoBounds.minX * scaleX
    : tissueBounds.minX - geoBounds.minX * scaleX;
  const matrixF = flipY
    ? tissueBounds.maxY + geoBounds.minY * scaleY
    : tissueBounds.minY - geoBounds.minY * scaleY;
  return { matrixA, matrixD, matrixE, matrixF };
}

function scoreTransform(points, tissueBounds, transform) {
  if (!points.length) return 0;
  const sampleStep = Math.max(1, Math.floor(points.length / 1500));
  let tissueHits = 0;
  let total = 0;

  for (let i = 0; i < points.length; i += sampleStep) {
    const [x, y] = points[i];
    const mappedX = Math.round(transform.matrixA * x + transform.matrixE);
    const mappedY = Math.round(transform.matrixD * y + transform.matrixF);
    const hit =
      tissueBounds.isTissueAt(mappedX, mappedY) ||
      tissueBounds.isTissueAt(mappedX - 1, mappedY) ||
      tissueBounds.isTissueAt(mappedX + 1, mappedY) ||
      tissueBounds.isTissueAt(mappedX, mappedY - 1) ||
      tissueBounds.isTissueAt(mappedX, mappedY + 1);

    if (hit) tissueHits += 1;
    total += 1;
  }

  return tissueHits / Math.max(1, total);
}

function waitForImageReady() {
  if (imageEl.complete && imageEl.naturalWidth > 0 && imageEl.naturalHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("image load failed"));
    };
    const cleanup = () => {
      imageEl.removeEventListener("load", onLoad);
      imageEl.removeEventListener("error", onError);
    };

    imageEl.addEventListener("load", onLoad);
    imageEl.addEventListener("error", onError);
  });
}

async function loadOverlay() {
  if (!sample || overlayLoaded) return;

  statusEl.textContent = "객체를 불러오는 중...";
  try {
    await waitForImageReady();
    const res = await fetch(sample.geojson);
    if (!res.ok) throw new Error("geojson load failed");
    const data = await res.json();
    const { paths, points } = collectGeometry(data);
    const geoBounds = collectRobustBounds(points);
    const tissueBounds = detectTissueBoundsFromImage();
    overlayEl.setAttribute("viewBox", `0 0 ${imageEl.naturalWidth} ${imageEl.naturalHeight}`);

    const candidates = [
      makeTransform(geoBounds, tissueBounds, false, false),
      makeTransform(geoBounds, tissueBounds, true, false),
      makeTransform(geoBounds, tissueBounds, false, true),
      makeTransform(geoBounds, tissueBounds, true, true),
    ];
    let bestTransform = candidates[0];
    let bestScore = scoreTransform(points, tissueBounds, bestTransform);
    for (let i = 1; i < candidates.length; i += 1) {
      const score = scoreTransform(points, tissueBounds, candidates[i]);
      if (score > bestScore) {
        bestScore = score;
        bestTransform = candidates[i];
      }
    }

    const transformedPaths = paths
      .map(
        (d) =>
          `<path d="${d}" fill="rgba(46, 204, 113, 0.14)" stroke="rgba(39, 174, 96, 0.85)" stroke-width="0.9" vector-effect="non-scaling-stroke"></path>`
      )
      .join("");

    overlayEl.innerHTML = `<g transform="matrix(${bestTransform.matrixA} 0 0 ${bestTransform.matrixD} ${bestTransform.matrixE} ${bestTransform.matrixF})">${transformedPaths}</g>`;

    overlayLoaded = true;
    statusEl.textContent = "";
  } catch {
    statusEl.textContent = "GeoJSON 객체를 불러오지 못했습니다.";
    toggleEl.disabled = true;
  }
}

if (!sample) {
  setError("유효하지 않은 샘플입니다.");
} else {
  titleEl.textContent = sample.title;
  imageEl.src = sample.image;
}

toggleEl.addEventListener("click", async () => {
  if (!overlayLoaded) {
    await loadOverlay();
    if (!overlayLoaded) return;
  }

  overlayVisible = !overlayVisible;
  overlayEl.style.display = overlayVisible ? "block" : "none";
  toggleEl.textContent = overlayVisible ? "객체 숨기기" : "객체 보기";
});
