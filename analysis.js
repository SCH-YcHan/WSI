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
const wrapEl = document.getElementById("image-wrap");
const imageEl = document.getElementById("sample-image");
const overlayEl = document.getElementById("overlay");
const toggleEl = document.getElementById("toggle-overlay");
const statusEl = document.getElementById("status-text");
const modalEl = document.getElementById("zoom-modal");
const modalCloseEl = document.getElementById("zoom-close");
const modalZoomInEl = document.getElementById("zoom-in");
const modalZoomOutEl = document.getElementById("zoom-out");
const modalViewportEl = document.getElementById("zoom-viewport");
const modalContentEl = document.getElementById("zoom-content");
const modalImageEl = document.getElementById("zoom-image");
const modalOverlayEl = document.getElementById("zoom-overlay");
const modalDrawOverlayEl = document.getElementById("zoom-draw-overlay");
const modalScaleLabelEl = document.getElementById("zoom-scale-label");
const drawToggleEl = document.getElementById("draw-toggle");
const drawCloseEl = document.getElementById("draw-close");
const drawDeleteEl = document.getElementById("draw-delete");
const drawLinkDirEl = document.getElementById("draw-link-dir");
const drawSaveEl = document.getElementById("draw-save");
const zoomHelpEl = document.getElementById("zoom-help");

let overlayLoaded = false;
let overlayVisible = false;
let overlayMarkup = "";

let modalZoom = 1;
let modalBaseScale = 1;
let modalPanX = 0;
let modalPanY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
const activePointers = new Map();
let pinchStartDistance = 0;
let pinchStartZoom = 1;
let drawMode = false;
let draftPoints = [];
let userPolygons = [];
let selectedPolygonId = null;
let dragVertex = null;
let polygonIdSeed = 1;
let saveRootDirHandle = null;

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

function waitForImageReady(imgEl) {
  if (imgEl.complete && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
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
      imgEl.removeEventListener("load", onLoad);
      imgEl.removeEventListener("error", onError);
    };

    imgEl.addEventListener("load", onLoad);
    imgEl.addEventListener("error", onError);
  });
}

function syncOverlayVisibility() {
  const display = overlayVisible ? "block" : "none";
  overlayEl.style.display = display;
  modalOverlayEl.style.display = display;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampPan() {
  const viewportW = modalViewportEl.clientWidth;
  const viewportH = modalViewportEl.clientHeight;
  const scale = modalBaseScale * modalZoom;
  const scaledW = modalImageEl.naturalWidth * scale;
  const scaledH = modalImageEl.naturalHeight * scale;

  if (scaledW <= viewportW) {
    modalPanX = (viewportW - scaledW) / 2;
  } else {
    modalPanX = clamp(modalPanX, viewportW - scaledW, 0);
  }

  if (scaledH <= viewportH) {
    modalPanY = (viewportH - scaledH) / 2;
  } else {
    modalPanY = clamp(modalPanY, viewportH - scaledH, 0);
  }
}

function renderModalTransform() {
  const scale = modalBaseScale * modalZoom;
  const scaledW = modalImageEl.naturalWidth * scale;
  const scaledH = modalImageEl.naturalHeight * scale;
  clampPan();
  modalContentEl.style.width = `${scaledW}px`;
  modalContentEl.style.height = `${scaledH}px`;
  modalContentEl.style.transform = `translate(${modalPanX}px, ${modalPanY}px)`;
  modalScaleLabelEl.textContent = `${Math.round(modalZoom * 100)}%`;
}

function zoomAt(nextZoom, cursorX, cursorY) {
  const currentScale = modalBaseScale * modalZoom;
  const worldX = (cursorX - modalPanX) / currentScale;
  const worldY = (cursorY - modalPanY) / currentScale;
  const clampedZoom = clamp(nextZoom, 1, 8);
  const nextScale = modalBaseScale * clampedZoom;
  modalPanX = cursorX - worldX * nextScale;
  modalPanY = cursorY - worldY * nextScale;
  modalZoom = clampedZoom;
  renderModalTransform();
}

function imageToSource(point) {
  return {
    x: (point.x * sample.sourceWidth) / modalImageEl.naturalWidth,
    y: (point.y * sample.sourceHeight) / modalImageEl.naturalHeight,
  };
}

function pointsToPath(points, closed = true) {
  if (!points.length) return "";
  const start = `M${points[0].x} ${points[0].y}`;
  const body = points.slice(1).map((point) => `L${point.x} ${point.y}`).join(" ");
  return `${start} ${body}${closed ? " Z" : ""}`;
}

function getClientToImagePoint(clientX, clientY) {
  const rect = modalViewportEl.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const scale = modalBaseScale * modalZoom;
  return {
    x: clamp((localX - modalPanX) / scale, 0, modalImageEl.naturalWidth),
    y: clamp((localY - modalPanY) / scale, 0, modalImageEl.naturalHeight),
  };
}

function setDrawHelp(text) {
  zoomHelpEl.textContent = text;
}

function renderDrawOverlay() {
  modalDrawOverlayEl.setAttribute("viewBox", `0 0 ${modalImageEl.naturalWidth} ${modalImageEl.naturalHeight}`);
  const hitboxMarkup = `<rect class="draw-hitbox" x="0" y="0" width="${modalImageEl.naturalWidth}" height="${modalImageEl.naturalHeight}"></rect>`;
  const polygonsMarkup = userPolygons
    .map((polygon) => {
      const className = polygon.id === selectedPolygonId ? "draw-poly selected" : "draw-poly";
      const pointsText = polygon.points.map((point) => `${point.x},${point.y}`).join(" ");
      return `<polygon class="${className}" data-poly-id="${polygon.id}" points="${pointsText}"></polygon>`;
    })
    .join("");

  const handlesMarkup = userPolygons
    .flatMap((polygon) =>
      polygon.points.map(
        (point, index) =>
          `<circle class="draw-handle" data-poly-id="${polygon.id}" data-vertex-index="${index}" r="6" cx="${point.x}" cy="${point.y}"></circle>`
      )
    )
    .join("");

  const draftLine =
    drawMode && draftPoints.length
      ? `<path class="draft-line" d="${pointsToPath(draftPoints, false)}"></path>`
      : "";
  const draftHandles =
    drawMode && draftPoints.length
      ? draftPoints
          .map((point, index) => {
            const closeClass = index === 0 && draftPoints.length >= 3 ? " close-target" : "";
            return `<circle class="draw-handle${closeClass}" data-draft-index="${index}" r="6" cx="${point.x}" cy="${point.y}"></circle>`;
          })
          .join("")
      : "";

  modalDrawOverlayEl.innerHTML = `${hitboxMarkup}${polygonsMarkup}${draftLine}${handlesMarkup}${draftHandles}`;
  modalDrawOverlayEl.style.display = drawMode ? "block" : "none";
}

function setDrawMode(next) {
  drawMode = next;
  drawToggleEl.textContent = drawMode ? "그리기 ON" : "그리기 OFF";
  setDrawHelp(
    drawMode
      ? "그리기 ON: 탭으로 점 추가, 첫 점 탭 또는 '폴리곤 닫기'로 완료, 점 드래그로 수정"
      : "그리기 OFF: 이동/확대 모드"
  );
  if (!drawMode) {
    draftPoints = [];
    dragVertex = null;
  }
  renderDrawOverlay();
}

function closeDraftPolygon() {
  if (draftPoints.length < 3) {
    setDrawHelp("점 3개 이상 필요합니다.");
    return;
  }
  userPolygons.push({ id: polygonIdSeed++, points: draftPoints.map((point) => ({ ...point })) });
  selectedPolygonId = userPolygons[userPolygons.length - 1].id;
  draftPoints = [];
  setDrawHelp("폴리곤이 추가되었습니다.");
  renderDrawOverlay();
}

function deleteSelectedPolygon() {
  if (selectedPolygonId == null) {
    setDrawHelp("삭제할 폴리곤을 먼저 선택하세요.");
    return;
  }
  userPolygons = userPolygons.filter((polygon) => polygon.id !== selectedPolygonId);
  selectedPolygonId = null;
  setDrawHelp("선택한 폴리곤을 삭제했습니다.");
  renderDrawOverlay();
}

function saveUserPolygons() {
  if (!userPolygons.length) {
    setDrawHelp("저장할 폴리곤이 없습니다.");
    return;
  }
  const featureCollection = {
    type: "FeatureCollection",
    metadata: {
      source: sample.title,
      slug,
      createdAt: new Date().toISOString(),
      note: "User annotations exported separately from original geojson",
    },
    features: userPolygons.map((polygon) => ({
      type: "Feature",
      properties: { objectType: "user-annotation", polygonId: polygon.id },
      geometry: {
        type: "Polygon",
        coordinates: [[...polygon.points.map((point) => {
          const source = imageToSource(point);
          return [Number(source.x.toFixed(3)), Number(source.y.toFixed(3))];
        }), (() => {
          const first = imageToSource(polygon.points[0]);
          return [Number(first.x.toFixed(3)), Number(first.y.toFixed(3))];
        })()]],
      },
    })),
  };

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const filename = `${slug}-user-annotations-${stamp}.geojson`;
  const payload = JSON.stringify(featureCollection, null, 2);

  if (saveRootDirHandle) {
    saveUserPolygonsToDirectory(filename, payload)
      .then(() => setDrawHelp(`저장 완료: public/user-annotations/${filename}`))
      .catch(() => {
        saveUserPolygonsAsDownload(filename, payload);
      });
    return;
  }

  saveUserPolygonsAsDownload(filename, payload);
}

function saveUserPolygonsAsDownload(filename, payload) {
  const blob = new Blob([payload], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setDrawHelp(`다운로드 저장 완료: ${filename}`);
}

async function connectSaveDirectory() {
  if (!window.showDirectoryPicker) {
    setDrawHelp("이 브라우저는 폴더 저장 연결을 지원하지 않습니다.");
    return;
  }

  const picked = await window.showDirectoryPicker({ mode: "readwrite" });
  saveRootDirHandle = picked;
  drawLinkDirEl.textContent = "저장 위치 연결됨";
  setDrawHelp("저장 위치 연결 완료. user-annotations 폴더에 저장합니다.");
}

async function saveUserPolygonsToDirectory(filename, payload) {
  const annotationsDir = await saveRootDirHandle.getDirectoryHandle("user-annotations", { create: true });
  const fileHandle = await annotationsDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(payload);
  await writable.close();
}

function renderOverlayInto(svgEl, imgEl) {
  svgEl.setAttribute("viewBox", `0 0 ${imgEl.naturalWidth} ${imgEl.naturalHeight}`);
  svgEl.innerHTML = overlayMarkup;
}

async function openZoomModal() {
  if (!sample) return;
  modalEl.hidden = false;
  document.body.classList.add("zoom-open");
  modalImageEl.src = sample.image;
  await waitForImageReady(modalImageEl);

  if (overlayLoaded) {
    renderOverlayInto(modalOverlayEl, modalImageEl);
    syncOverlayVisibility();
  }

  const viewportW = modalViewportEl.clientWidth;
  const viewportH = modalViewportEl.clientHeight;
  modalBaseScale = Math.min(viewportW / modalImageEl.naturalWidth, viewportH / modalImageEl.naturalHeight);
  if (!Number.isFinite(modalBaseScale) || modalBaseScale <= 0) modalBaseScale = 1;
  modalZoom = 1;
  modalPanX = (viewportW - modalImageEl.naturalWidth * modalBaseScale) / 2;
  modalPanY = (viewportH - modalImageEl.naturalHeight * modalBaseScale) / 2;
  renderModalTransform();
  renderDrawOverlay();
}

function closeZoomModal() {
  modalEl.hidden = true;
  document.body.classList.remove("zoom-open");
  isDragging = false;
  activePointers.clear();
  dragVertex = null;
  modalViewportEl.classList.remove("dragging");
}

async function loadOverlay() {
  if (!sample || overlayLoaded) return;

  statusEl.textContent = "객체를 불러오는 중...";
  try {
    await waitForImageReady(imageEl);
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

    overlayMarkup = paths
      .map(
        (d) =>
          `<path d="${d}" fill="rgba(46, 204, 113, 0.14)" stroke="rgba(39, 174, 96, 0.85)" stroke-width="0.9" vector-effect="non-scaling-stroke"></path>`
      ).join("");
    renderOverlayInto(overlayEl, imageEl);
    if (!modalEl.hidden && modalImageEl.naturalWidth > 0) {
      renderOverlayInto(modalOverlayEl, modalImageEl);
    }
    syncOverlayVisibility();

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

setDrawMode(false);

wrapEl.addEventListener("click", () => {
  openZoomModal();
});

toggleEl.addEventListener("click", async () => {
  if (!overlayLoaded) {
    await loadOverlay();
    if (!overlayLoaded) return;
  }

  overlayVisible = !overlayVisible;
  syncOverlayVisibility();
  toggleEl.textContent = overlayVisible ? "객체 숨기기" : "객체 보기";
});

modalCloseEl.addEventListener("click", closeZoomModal);

modalEl.addEventListener("click", (event) => {
  if (event.target === modalEl) closeZoomModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modalEl.hidden) closeZoomModal();
});

modalViewportEl.addEventListener(
  "wheel",
  (event) => {
    if (modalEl.hidden) return;
    event.preventDefault();
    const rect = modalViewportEl.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    zoomAt(modalZoom * (event.deltaY < 0 ? 1.1 : 0.9), cursorX, cursorY);
  },
  { passive: false }
);

function pointerDistance(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

function pointerMidpoint(p1, p2) {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

drawToggleEl.addEventListener("click", () => {
  setDrawMode(!drawMode);
});

drawCloseEl.addEventListener("click", () => {
  closeDraftPolygon();
});

drawDeleteEl.addEventListener("click", () => {
  deleteSelectedPolygon();
});

drawSaveEl.addEventListener("click", () => {
  saveUserPolygons();
});

drawLinkDirEl.addEventListener("click", async () => {
  try {
    await connectSaveDirectory();
  } catch {
    setDrawHelp("저장 위치 연결이 취소되었습니다.");
  }
});

modalDrawOverlayEl.addEventListener("pointerdown", (event) => {
  if (!drawMode) return;

  const handle = event.target.closest("circle[data-draft-index]");
  if (handle) {
    const index = Number(handle.dataset.draftIndex);
    if (index === 0 && draftPoints.length >= 3) {
      closeDraftPolygon();
    }
    event.preventDefault();
    return;
  }

  const poly = event.target.closest("[data-poly-id]");
  if (poly) {
    selectedPolygonId = Number(poly.dataset.polyId);
    renderDrawOverlay();
    event.preventDefault();
    return;
  }

  const point = getClientToImagePoint(event.clientX, event.clientY);
  draftPoints.push(point);
  selectedPolygonId = null;
  renderDrawOverlay();
  event.preventDefault();
});

modalViewportEl.addEventListener("pointerdown", (event) => {
  if (modalEl.hidden) return;
  if (drawMode) {
    const vertex = event.target.closest("circle[data-poly-id][data-vertex-index]");
    if (vertex) {
      dragVertex = {
        polyId: Number(vertex.dataset.polyId),
        vertexIndex: Number(vertex.dataset.vertexIndex),
        pointerId: event.pointerId,
      };
      event.preventDefault();
      modalViewportEl.setPointerCapture(event.pointerId);
      return;
    }
    return;
  }
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size === 1 && !drawMode) {
    isDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    modalViewportEl.classList.add("dragging");
  } else if (activePointers.size === 2) {
    const [p1, p2] = [...activePointers.values()];
    pinchStartDistance = pointerDistance(p1, p2) || 1;
    pinchStartZoom = modalZoom;
    isDragging = false;
    modalViewportEl.classList.remove("dragging");
  }
  modalViewportEl.setPointerCapture(event.pointerId);
});

modalViewportEl.addEventListener("pointermove", (event) => {
  if (modalEl.hidden) return;

  if (dragVertex && dragVertex.pointerId === event.pointerId) {
    const polygon = userPolygons.find((item) => item.id === dragVertex.polyId);
    if (polygon && polygon.points[dragVertex.vertexIndex]) {
      polygon.points[dragVertex.vertexIndex] = getClientToImagePoint(event.clientX, event.clientY);
      selectedPolygonId = polygon.id;
      renderDrawOverlay();
    }
    return;
  }

  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  if (activePointers.size === 2) {
    const [p1, p2] = [...activePointers.values()];
    const rect = modalViewportEl.getBoundingClientRect();
    const mid = pointerMidpoint(p1, p2);
    const currentDistance = pointerDistance(p1, p2) || 1;
    const nextZoom = pinchStartZoom * (currentDistance / pinchStartDistance);
    zoomAt(nextZoom, mid.x - rect.left, mid.y - rect.top);
    return;
  }

  if (!isDragging || activePointers.size !== 1 || drawMode) return;
  const dx = event.clientX - dragStartX;
  const dy = event.clientY - dragStartY;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  modalPanX += dx;
  modalPanY += dy;
  renderModalTransform();
});

function stopDragging(event) {
  if (dragVertex && event.pointerId === dragVertex.pointerId) {
    dragVertex = null;
    if (modalViewportEl.hasPointerCapture(event.pointerId)) {
      modalViewportEl.releasePointerCapture(event.pointerId);
    }
    return;
  }

  activePointers.delete(event.pointerId);
  if (activePointers.size < 2) {
    pinchStartDistance = 0;
  }
  if (activePointers.size === 1 && !drawMode) {
    const [pointer] = [...activePointers.values()];
    isDragging = true;
    dragStartX = pointer.x;
    dragStartY = pointer.y;
    modalViewportEl.classList.add("dragging");
  } else {
    isDragging = false;
    modalViewportEl.classList.remove("dragging");
  }
  modalViewportEl.classList.remove("dragging");
  if (event && modalViewportEl.hasPointerCapture(event.pointerId)) {
    modalViewportEl.releasePointerCapture(event.pointerId);
  }
}

modalViewportEl.addEventListener("pointerup", stopDragging);
modalViewportEl.addEventListener("pointercancel", stopDragging);

modalZoomInEl.addEventListener("click", () => {
  zoomAt(modalZoom * 1.2, modalViewportEl.clientWidth / 2, modalViewportEl.clientHeight / 2);
});

modalZoomOutEl.addEventListener("click", () => {
  zoomAt(modalZoom * 0.8, modalViewportEl.clientWidth / 2, modalViewportEl.clientHeight / 2);
});
