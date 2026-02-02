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
  const centroids = [];
  featureCollection.features.forEach((feature) => {
    const geometry = feature.geometry;
    if (!geometry) return;

    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach((polygon) => {
      paths.push(buildPath(polygon));
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      polygon.forEach((ring) => {
        ring.forEach(([x, y]) => {
          points.push([x, y]);
          sumX += x;
          sumY += y;
          count += 1;
        });
      });
      if (count) {
        centroids.push([sumX / count, sumY / count]);
      }
    });
  });
  return { paths, points, centroids };
}

function scanTissue(imageData, width, height, step = 2) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  let sumX = 0;
  let sumY = 0;

  function isTissueAt(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const index = (y * width + x) * 4;
    const r = imageData[index];
    const g = imageData[index + 1];
    const b = imageData[index + 2];
    const a = imageData[index + 3];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const spread = max - min;
    const lum = (r + g + b) / 3;
    // White background is high-luminance and low-chroma. Keep tissue detection strict.
    return a > 0 && !((lum > 246 && spread < 8) || (lum > 240 && spread < 5));
  }

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (!isTissueAt(x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
      sumX += x;
      sumY += y;
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
      centerX: width / 2,
      centerY: height / 2,
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
    centerX: count ? sumX / count : (minX + maxX) / 2,
    centerY: count ? sumY / count : (minY + maxY) / 2,
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

function collectGeoStats(points) {
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1, centerX: 0.5, centerY: 0.5 };
  }
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = quantile(xs, 0.01);
  const minY = quantile(ys, 0.01);
  const maxX = quantile(xs, 0.99);
  const maxY = quantile(ys, 0.99);
  const centerX = quantile(xs, 0.5);
  const centerY = quantile(ys, 0.5);
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY), centerX, centerY };
}

function scoreTransform(points, tissueBounds, transform) {
  if (!points.length) return 0;
  const sampleStep = Math.max(1, Math.floor(points.length / 500));
  let tissueHits = 0;
  let nearHits = 0;
  let outOfBounds = 0;
  let backgroundHits = 0;
  let total = 0;

  for (let i = 0; i < points.length; i += sampleStep) {
    const [x, y] = points[i];
    const mappedX = Math.round(transform.matrixA * x + transform.matrixE);
    const mappedY = Math.round(transform.matrixD * y + transform.matrixF);
    const isOutside =
      mappedX < 0 || mappedY < 0 || mappedX >= imageEl.naturalWidth || mappedY >= imageEl.naturalHeight;
    if (isOutside) {
      outOfBounds += 1;
      total += 1;
      continue;
    }
    const hit = tissueBounds.isTissueAt(mappedX, mappedY);
    if (hit) {
      tissueHits += 1;
    } else {
      const near =
        tissueBounds.isTissueAt(mappedX - 1, mappedY) ||
        tissueBounds.isTissueAt(mappedX + 1, mappedY) ||
        tissueBounds.isTissueAt(mappedX, mappedY - 1) ||
        tissueBounds.isTissueAt(mappedX, mappedY + 1) ||
        tissueBounds.isTissueAt(mappedX - 2, mappedY) ||
        tissueBounds.isTissueAt(mappedX + 2, mappedY) ||
        tissueBounds.isTissueAt(mappedX, mappedY - 2) ||
        tissueBounds.isTissueAt(mappedX, mappedY + 2);
      if (near) nearHits += 1;
      else backgroundHits += 1;
    }
    total += 1;
  }

  const hitRate = (tissueHits + nearHits * 0.35) / Math.max(1, total);
  const oobRate = outOfBounds / Math.max(1, total);
  const backgroundRate = backgroundHits / Math.max(1, total);
  return hitRate - oobRate * 1.2 - backgroundRate * 1.0;
}

function makeTransform(scale, centerGeoX, centerGeoY, centerImgX, centerImgY, flipX = false, flipY = false) {
  const matrixA = flipX ? -scale : scale;
  const matrixD = flipY ? -scale : scale;
  const matrixE = centerImgX - matrixA * centerGeoX;
  const matrixF = centerImgY - matrixD * centerGeoY;
  return { matrixA, matrixD, matrixE, matrixF };
}

function refineTranslation(points, tissueBounds, transform) {
  let best = { ...transform };
  let bestScore = scoreTransform(points, tissueBounds, best);
  let step = Math.max(imageEl.naturalWidth, imageEl.naturalHeight) / 5;

  for (let round = 0; round < 8; round += 1) {
    const candidates = [
      { dx: 0, dy: 0 },
      { dx: step, dy: 0 },
      { dx: -step, dy: 0 },
      { dx: 0, dy: step },
      { dx: 0, dy: -step },
      { dx: step, dy: step },
      { dx: step, dy: -step },
      { dx: -step, dy: step },
      { dx: -step, dy: -step },
    ];

    let improved = false;
    candidates.forEach(({ dx, dy }) => {
      const candidate = { ...best, matrixE: best.matrixE + dx, matrixF: best.matrixF + dy };
      const score = scoreTransform(points, tissueBounds, candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
        improved = true;
      }
    });

    if (!improved) step /= 2;
  }

  return { transform: best, score: bestScore };
}

function optimizeTransform(points, tissueBounds) {
  const geo = collectGeoStats(points);
  const baseScaleX = tissueBounds.width / Math.max(1, geo.width);
  const baseScaleY = tissueBounds.height / Math.max(1, geo.height);
  const scaleMultipliers = [0.45, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.1, 2.5, 3.0];
  const orientations = [
    { flipX: false, flipY: false },
    { flipX: true, flipY: false },
    { flipX: false, flipY: true },
    { flipX: true, flipY: true },
  ];

  let bestTransform = makeTransform(
    Math.min(baseScaleX, baseScaleY),
    geo.centerX,
    geo.centerY,
    tissueBounds.centerX,
    tissueBounds.centerY
  );
  let bestScore = Number.NEGATIVE_INFINITY;

  orientations.forEach(({ flipX, flipY }) => {
    scaleMultipliers.forEach((multX) => {
      scaleMultipliers.forEach((multY) => {
        const scaleX = Math.max(0.0001, baseScaleX * multX);
        const scaleY = Math.max(0.0001, baseScaleY * multY);
        const matrixA = flipX ? -scaleX : scaleX;
        const matrixD = flipY ? -scaleY : scaleY;
        const seed = {
          matrixA,
          matrixD,
          matrixE: tissueBounds.centerX - matrixA * geo.centerX,
          matrixF: tissueBounds.centerY - matrixD * geo.centerY,
        };
        const refined = refineTranslation(points, tissueBounds, seed);
        if (refined.score > bestScore) {
          bestScore = refined.score;
          bestTransform = refined.transform;
        }
      });
    });
  });

  return bestTransform;
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
    const { paths, centroids } = collectGeometry(data);
    const tissueBounds = detectTissueBoundsFromImage();
    overlayEl.setAttribute("viewBox", `0 0 ${imageEl.naturalWidth} ${imageEl.naturalHeight}`);
    const bestTransform = optimizeTransform(centroids, tissueBounds);

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
