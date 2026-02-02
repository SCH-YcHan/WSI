const samples = {
  "wt1-adenine-x20": {
    title: "WT1 Adenine x20",
    image: "public/analysis-detail/wt1-adenine-x20.png",
    sourceWidth: 13300,
    sourceHeight: 19432,
    geojson: "public/geojson/wt1-adenine-x20.geojson",
  },
  "wt2-adenine-x20": {
    title: "WT2 Adenine x20",
    image: "public/analysis-detail/wt2-adenine-x20.png",
    sourceWidth: 13297,
    sourceHeight: 21276,
    geojson: "public/geojson/wt2-adenine-x20.geojson",
  },
  "wt3-adenine-x20": {
    title: "WT3 Adenine x20",
    image: "public/analysis-detail/wt3-adenine-x20.png",
    sourceWidth: 13299,
    sourceHeight: 20354,
    geojson: "public/geojson/wt3-adenine-x20.geojson",
  },
  "wt4-normal-x20": {
    title: "WT4 Normal x20",
    image: "public/analysis-detail/wt4-normal-x20.png",
    sourceWidth: 11096,
    sourceHeight: 19437,
    geojson: "public/geojson/wt4-normal-x20.geojson",
  },
  "wt5-normal-x20": {
    title: "WT5 Normal x20",
    image: "public/analysis-detail/wt5-normal-x20.png",
    sourceWidth: 11096,
    sourceHeight: 19437,
    geojson: "public/geojson/wt5-normal-x20.geojson",
  },
  "wt6-normal-x20": {
    title: "WT6 Normal x20",
    image: "public/analysis-detail/wt6-normal-x20.png",
    sourceWidth: 14403,
    sourceHeight: 19430,
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

function buildPath(rings, scaleX, scaleY) {
  return rings
    .map(
      (ring) =>
        ring
          .map((point, index) => `${index === 0 ? "M" : "L"}${point[0] * scaleX} ${point[1] * scaleY}`)
          .join(" ") + " Z"
    )
    .join(" ");
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
    const scaleX = imageEl.naturalWidth / sample.sourceWidth;
    const scaleY = imageEl.naturalHeight / sample.sourceHeight;
    overlayEl.setAttribute("viewBox", `0 0 ${imageEl.naturalWidth} ${imageEl.naturalHeight}`);
    const paths = [];
    data.features.forEach((feature) => {
      const geometry = feature.geometry;
      if (!geometry) return;
      if (geometry.type === "Polygon") {
        paths.push(buildPath(geometry.coordinates, scaleX, scaleY));
      } else {
        geometry.coordinates.forEach((polygon) => {
          paths.push(buildPath(polygon, scaleX, scaleY));
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
