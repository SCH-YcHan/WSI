"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

const samples: Record<string, { title: string; src: string; tif: string }> = {
  "wt1-adenine-x20": {
    title: "WT1 Adenine x20",
    src: "/analysis-samples/large/wt1-adenine-x20.jpg",
    tif: "WT1-Adenine_x20.tif",
  },
  "wt2-adenine-x20": {
    title: "WT2 Adenine x20",
    src: "/analysis-samples/large/wt2-adenine-x20.jpg",
    tif: "WT2-Adenine_x20.tif",
  },
  "wt3-adenine-x20": {
    title: "WT3 Adenine x20",
    src: "/analysis-samples/large/wt3-adenine-x20.jpg",
    tif: "WT3-Adenine_x20.tif",
  },
  "wt4-normal-x20": {
    title: "WT4 Normal x20",
    src: "/analysis-samples/large/wt4-normal-x20.jpg",
    tif: "WT4-Normal_x20.tif",
  },
  "wt5-normal-x20": {
    title: "WT5 Normal x20",
    src: "/analysis-samples/large/wt5-normal-x20.jpg",
    tif: "WT5-Normal_x20.tif",
  },
  "wt6-normal-x20": {
    title: "WT6 Normal x20",
    src: "/analysis-samples/large/wt6-normal-x20.jpg",
    tif: "WT6-Normal_x20.tif",
  },
};

export default function AnalysisDetailClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [fitSize, setFitSize] = useState({ w: 0, h: 0 });
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [overlayData, setOverlayData] = useState<{
    width: number | null;
    height: number | null;
    data: {
      type: "FeatureCollection";
      features: Array<{
        geometry: {
          type: "Polygon" | "MultiPolygon";
          coordinates: unknown;
        } | null;
      }>;
    };
  } | null>(null);
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const sample = useMemo(
    () =>
      samples[slug]
        ? { ...samples[slug], src: `/analysis-samples/hires/${slug}.png` }
        : undefined,
    [slug]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.replace(`/login?next=/analysis/${slug}`);
      setChecking(false);
    });
    return () => unsub();
  }, [router, slug]);

  useEffect(() => {
    if (!zoomOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [zoomOpen]);

  useEffect(() => {
    if (!dragging) return;
    const onUp = () => setDragging(false);
    const onMove = (e: MouseEvent) => {
      setOffset(clampOffset({ x: dragStart.x - e.clientX, y: dragStart.y - e.clientY }));
    };
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
    };
  }, [dragging, dragStart]);

  useEffect(() => {
    if (zoomScale === 1) return;
    setOffset((current) => clampOffset(current));
  }, [zoomScale]);


  const resetZoom = () => {
    setZoomScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const clampOffset = (next: { x: number; y: number }) => {
    const media = mediaRef.current;
    const img = imgRef.current;
    if (!media || !img) return next;
    const cw = media.clientWidth;
    const ch = media.clientHeight;
    const iw = fitSize.w || img.clientWidth;
    const ih = fitSize.h || img.clientHeight;
    const scaledW = iw * zoomScale;
    const scaledH = ih * zoomScale;
    const maxX = Math.max(0, (scaledW - cw) / 2);
    const maxY = Math.max(0, (scaledH - ch) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  };

  const loadOverlay = async () => {
    if (overlayData || overlayLoading) return;
    setOverlayLoading(true);
    setOverlayError(null);
    try {
      const res = await fetch(`/api/analysis/${slug}/geojson`);
      if (!res.ok) {
        throw new Error("Failed to load overlay data");
      }
      const payload = await res.json();
      setOverlayData(payload);
    } catch (err) {
      setOverlayError("좌표 데이터를 불러오지 못했습니다.");
      setOverlayOpen(false);
    } finally {
      setOverlayLoading(false);
    }
  };

  const buildPath = (rings: number[][][]) =>
    rings
      .map((ring) =>
        ring
          .map((point, index) => `${index === 0 ? "M" : "L"}${point[0]} ${point[1]}`)
          .join(" ") + " Z"
      )
      .join(" ");

  const overlayPaths = useMemo(() => {
    if (!overlayData) return [];
    const paths: string[] = [];
    for (const feature of overlayData.data.features) {
      const geometry = feature.geometry;
      if (!geometry) continue;
      if (geometry.type === "Polygon") {
        paths.push(buildPath(geometry.coordinates as number[][][]));
      } else if (geometry.type === "MultiPolygon") {
        for (const polygon of geometry.coordinates as number[][][][]) {
          paths.push(buildPath(polygon));
        }
      }
    }
    return paths;
  }, [overlayData]);

  if (checking) {
    return (
      <main className="analysis-detail">
        <div className="analysis-detail-card">
          <div className="skeleton line" />
          <div className="skeleton block" />
        </div>
      </main>
    );
  }

  if (!sample) {
    return (
      <main className="analysis-detail">
        <div className="analysis-detail-card">
          <h1>이미지를 찾을 수 없습니다.</h1>
          <p>요청한 분석 예시가 존재하지 않습니다.</p>
          <a className="btn primary" href="/">
            메인으로
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="analysis-detail">
      <div className="analysis-detail-card">
        <div className="signal">Analysis Sample</div>
        <h1>{sample.title}</h1>
        <button
          type="button"
          className="analysis-detail-image zoom-trigger"
          onClick={() => setZoomOpen(true)}
        >
          <div className="analysis-image-wrap">
            <img src={sample.src} alt={sample.title} className="zoomable" />
            {overlayOpen && overlayData && (
              <svg
                className="analysis-overlay"
                viewBox={`0 0 ${overlayData.width ?? 1} ${overlayData.height ?? 1}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {overlayPaths.map((d, index) => (
                  <path
                    key={`${index}-${d.length}`}
                    d={d}
                    fill="rgba(46, 204, 113, 0.14)"
                    stroke="rgba(39, 174, 96, 0.85)"
                    strokeWidth={0.9}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
            )}
          </div>
        </button>
        <div className="analysis-detail-actions">
          <a className="btn ghost" href="/">
            메인으로 돌아가기
          </a>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              const next = !overlayOpen;
              setOverlayOpen(next);
              if (next) loadOverlay();
            }}
          >
            {overlayOpen ? "객체 숨기기" : "객체 보기"}
          </button>
          <a className="btn" href={`/api/analysis/${slug}/download`}>
            원본 TIFF 다운로드
          </a>
          {overlayLoading && <span className="hint">객체 로딩 중...</span>}
          {overlayError && <span className="status error">{overlayError}</span>}
        </div>
      </div>

      {zoomOpen && (
        <div
          className="zoom-overlay"
          onClick={() => {
            setZoomOpen(false);
            resetZoom();
          }}
          onWheel={(e) => e.preventDefault()}
        >
          <div
            className="zoom-frame"
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              e.preventDefault();
              const delta = Math.sign(e.deltaY);
              setZoomScale((s) => {
                const next = delta > 0 ? s - 0.2 : s + 0.2;
                const clamped = Math.min(4, Math.max(1, Number(next.toFixed(2))));
                if (clamped === 1) setOffset({ x: 0, y: 0 });
                return clamped;
              });
            }}
          >
            <div
              className="zoom-media"
              ref={mediaRef}
              onMouseDown={(e) => {
                e.preventDefault();
                setDragging(true);
                setDragStart({ x: e.clientX + offset.x, y: e.clientY + offset.y });
              }}
            >
              <div
                className="zoom-pan"
                style={{ transform: `translate(${-offset.x}px, ${-offset.y}px)` }}
              >
                <div
                  className="zoom-image-wrap"
                  style={{
                    width: fitSize.w ? `${fitSize.w}px` : "100%",
                    height: fitSize.h ? `${fitSize.h}px` : "100%",
                    transform: `scale(${zoomScale})`,
                  }}
                >
                  <img
                    src={sample.src}
                    alt={`${sample.title} zoom`}
                    ref={imgRef}
                    style={{
                      width: "100%",
                      height: "100%",
                      maxWidth: fitSize.w ? "none" : "100%",
                      maxHeight: fitSize.h ? "none" : "100%",
                    }}
                    onLoad={() => {
                      const media = mediaRef.current;
                      const img = imgRef.current;
                      if (!media || !img) return;
                      const cw = media.clientWidth;
                      const ch = media.clientHeight;
                      const naturalW = img.naturalWidth || cw;
                      const naturalH = img.naturalHeight || ch;
                      const scale = Math.min(cw / naturalW, ch / naturalH);
                      setFitSize({ w: naturalW * scale, h: naturalH * scale });
                    }}
                  />
                  {overlayOpen && overlayData && (
                    <svg
                      className="analysis-overlay zoom-overlay-layer"
                      viewBox={`0 0 ${overlayData.width ?? 1} ${overlayData.height ?? 1}`}
                      preserveAspectRatio="xMidYMid meet"
                    >
                      {overlayPaths.map((d, index) => (
                        <path
                          key={`zoom-${index}-${d.length}`}
                          d={d}
                          fill="rgba(46, 204, 113, 0.14)"
                          stroke="rgba(39, 174, 96, 0.85)"
                          strokeWidth={0.9}
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                    </svg>
                  )}
                </div>
              </div>
              <button
                className="zoom-close"
                onClick={() => {
                  setZoomOpen(false);
                  resetZoom();
                }}
                type="button"
              >
                닫기
              </button>
            </div>
            <div className="zoom-scale">
              <div className="zoom-scale-track">
                <div
                  className="zoom-scale-fill"
                  style={{ width: `${((zoomScale - 1) / 3) * 100}%` }}
                />
              </div>
              <span>{Math.round(zoomScale * 100)}%</span>
            </div>
            <button
              className="zoom-overlay-toggle"
              onClick={() => {
                const next = !overlayOpen;
                setOverlayOpen(next);
                if (next) loadOverlay();
              }}
              type="button"
            >
              {overlayOpen ? "객체 숨기기" : "객체 보기"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
