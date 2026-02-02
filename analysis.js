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
const openHiresEl = document.getElementById("open-hires");
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

function collectBounds(featureCollection) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  featureCollection.features.forEach((feature) => {
    const geometry = feature.geometry;
    if (!geometry) return;

    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach((polygon) => {
      polygon.forEach((ring) => {
        ring.forEach(([x, y]) => {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        });
      });
    });
  });

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, width: 1, height: 1 };
  }
  return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

async function loadOverlay() {
  if (!sample || overlayLoaded) return;

  statusEl.textContent = "객체를 불러오는 중...";
  try {
    const res = await fetch(sample.geojson);
    if (!res.ok) throw new Error("geojson load failed");
    const data = await res.json();
    const bounds = collectBounds(data);
    overlayEl.setAttribute("viewBox", `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`);

    const paths = [];
    data.features.forEach((feature) => {
      const geometry = feature.geometry;
      if (!geometry) return;

      if (geometry.type === "Polygon") {
        paths.push(buildPath(geometry.coordinates));
      } else {
        geometry.coordinates.forEach((polygon) => {
          paths.push(buildPath(polygon));
        });
      }
    });

    overlayEl.innerHTML = paths
      .map(
        (d) =>
          `<path d="${d}" fill="rgba(46, 204, 113, 0.14)" stroke="rgba(39, 174, 96, 0.85)" stroke-width="0.9" vector-effect="non-scaling-stroke"></path>`
      )
      .join("");

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
  openHiresEl.href = sample.image;
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
