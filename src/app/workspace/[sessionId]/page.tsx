"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { useParams, useRouter } from "next/navigation";

type Job = {
  sessionId: string;
  state: string;
  input?: { fileName?: string; fileSize?: number; storagePath?: string };
  createdAt?: { seconds?: number; nanoseconds?: number };
};

function formatDate(ts?: { seconds?: number }) {
  if (!ts?.seconds) return "-";
  return new Date(ts.seconds * 1000).toLocaleString();
}

function formatBytes(size?: number) {
  if (!size) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let value = size;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[idx]}`;
}

function stateTone(state?: string) {
  const s = (state || "").toUpperCase();
  if (s === "FAILED") return "bad";
  if (s === "COMPLETED") return "good";
  if (s === "UPLOADED") return "pending";
  return "neutral";
}

export default function WorkspacePage() {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params?.sessionId ?? "";
  const [uid, setUid] = useState("");
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
  const [predicting, setPredicting] = useState(false);
  const [overviewTick, setOverviewTick] = useState(0);
  const [overviewAvailable, setOverviewAvailable] = useState(false);
  const [overviewGenerating, setOverviewGenerating] = useState(false);
  const overviewRequestedRef = useRef<string | null>(null);
  const [previewFit, setPreviewFit] = useState<{ width: number; height: number } | null>(
    null
  );
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const previewNaturalRef = useRef<{ width: number; height: number } | null>(null);
  const [progress, setProgress] = useState<{
    state: string;
    total_tiles?: number;
    processed_tiles?: number;
    predicted_objects?: number;
  } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
      else setUid("");
      setCheckingAuth(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!checkingAuth && !uid) {
      router.push(`/login?next=/workspace/${sessionId}`);
    }
  }, [checkingAuth, uid, router, sessionId]);

  useEffect(() => {
    if (!uid) return;
    if (!sessionId) return;
    const refDoc = doc(db, "users", uid, "jobs", sessionId);
    const unsub = onSnapshot(
      refDoc,
      (snap) => {
        if (!snap.exists()) {
          setJob(null);
          setError("해당 세션을 찾을 수 없습니다.");
          return;
        }
        setError("");
        setJob(snap.data() as Job);
      },
      () => {
        setJob(null);
        setError("세션 정보를 불러오지 못했습니다.");
      }
    );
    return () => unsub();
  }, [uid, sessionId]);

  const onDownload = async () => {
    if (!job?.input?.storagePath) return;
    setBusy(true);
    try {
      const url = await getDownloadURL(ref(storage, job.input.storagePath));
      window.open(url, "_blank");
    } catch (e: any) {
      setError(e?.message ?? "다운로드 링크를 가져오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const generateOverview = async () => {
    if (!job?.input?.fileName || overviewGenerating) return;
    setOverviewGenerating(true);
    setOverlayError(null);
    try {
      let downloadUrl = "";
      if (job.input.storagePath) {
        downloadUrl = await getDownloadURL(ref(storage, job.input.storagePath));
      }
      const res = await fetch(`/api/workspace/${sessionId}/overview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: job.input.fileName, downloadUrl }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }
      setOverviewTick((t) => t + 1);
    } catch (err: any) {
      setOverlayError(err?.message ?? "미리보기 생성에 실패했습니다.");
    } finally {
      setOverviewGenerating(false);
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

  const computePreviewFit = () => {
    const stage = previewStageRef.current;
    const natural = previewNaturalRef.current;
    if (!stage || !natural) return;
    const maxWidth = stage.clientWidth;
    const maxHeight = stage.clientHeight;
    if (!maxWidth || !maxHeight) return;
    const scale = Math.min(maxWidth / natural.width, maxHeight / natural.height);
    setPreviewFit({
      width: Math.max(1, Math.round(natural.width * scale)),
      height: Math.max(1, Math.round(natural.height * scale)),
    });
  };

  const loadOverlay = async () => {
    if (!job?.input?.fileName) return;
    setOverlayLoading(true);
    setOverlayError(null);
    try {
      const res = await fetch(
        `/api/workspace/${sessionId}/geojson?fileName=${encodeURIComponent(job.input.fileName)}`
      );
      if (!res.ok) throw new Error("overlay fetch failed");
      const payload = await res.json();
      setOverlayData(payload);
    } catch {
      setOverlayError("객체 데이터를 불러오지 못했습니다.");
      setOverlayOpen(false);
    } finally {
      setOverlayLoading(false);
    }
  };

  const onPredict = async () => {
    if (!job?.input?.fileName) return;
    if (progress?.state === "done") {
      if (
        !window.confirm(
          "사구체 예측을 다시 실행하시겠습니까? 기존 결과는 새 결과로 대체됩니다."
        )
      ) {
        return;
      }
    }
    setPredicting(true);
    setOverlayError(null);
    try {
      let downloadUrl = "";
      if (job.input.storagePath) {
        downloadUrl = await getDownloadURL(ref(storage, job.input.storagePath));
      }
      const res = await fetch(`/api/workspace/${sessionId}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: job.input.fileName, downloadUrl }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }
      setProgress({ state: "queued" });
    } catch (err: any) {
      setOverlayError(err?.message ?? "예측 실행에 실패했습니다.");
    } finally {
      setPredicting(false);
    }
  };

  const onCancelPredict = async () => {
    if (!job?.input?.fileName || cancelling) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/workspace/${sessionId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: job.input.fileName }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }
      setProgress({ state: "cancelled" });
    } catch (err: any) {
      setOverlayError(err?.message ?? "예측 취소에 실패했습니다.");
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (!job?.input?.fileName) return;
    let timer: number | null = null;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch(
          `/api/workspace/${sessionId}/overview?mode=exists&t=${Date.now()}`,
          { method: "GET", cache: "no-store" }
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.exists) {
            setOverviewAvailable(true);
            setOverviewTick((t) => t + 1);
            stopped = true;
            return;
          }
        }
      } catch {
        // ignore
      }
      if (!stopped) {
        timer = window.setTimeout(check, 10000);
      }
    };
    const init = async () => {
      try {
        const res = await fetch(
          `/api/workspace/${sessionId}/overview?mode=exists&t=${Date.now()}`,
          { method: "GET", cache: "no-store" }
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.exists) {
            setOverviewAvailable(true);
            setOverviewTick((t) => t + 1);
            stopped = true;
            return;
          }
        }
      } catch {
        // ignore
      }
      setOverviewAvailable(false);
      if (overviewRequestedRef.current !== sessionId) {
        overviewRequestedRef.current = sessionId;
        generateOverview();
      }
      if (!stopped) {
        timer = window.setTimeout(check, 10000);
      }
    };
    init();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [job?.input?.fileName, sessionId]);

  useEffect(() => {
    const stage = previewStageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => computePreviewFit());
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!job?.input?.fileName) return;
    if (progress && (progress.state === "done" || progress.state === "failed")) return;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/workspace/${sessionId}/progress?fileName=${encodeURIComponent(job.input.fileName)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        setProgress(data);
        if (data.state === "done") {
          setOverviewTick((t) => t + 1);
          setOverviewAvailable(true);
          setOverlayOpen(true);
          await loadOverlay();
          return;
        }
        if (data.state === "failed") {
          setOverlayError("예측에 실패했습니다.");
          return;
        }
        timer = window.setTimeout(poll, 3000);
      } catch {
        timer = window.setTimeout(poll, 5000);
      }
    };
    poll();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [job?.input?.fileName, sessionId, progress?.state]);

  if (checkingAuth) {
    return (
      <main className="workspace-page">
        <section className="workspace-header">
          <div>
            <div className="signal">Workspace</div>
            <h1>분석 공간</h1>
            <p>세션을 확인 중입니다.</p>
          </div>
        </section>
        <section className="workspace-grid">
          <div className="card workspace-card">
            <div className="skeleton line" />
            <div className="skeleton block" />
            <div className="skeleton line short" />
          </div>
          <div className="card workspace-card">
            <div className="skeleton line" />
            <div className="skeleton block" />
            <div className="skeleton line short" />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace-page">
      <section className="workspace-header">
        <div>
          <div className="signal">Workspace</div>
          <h1>분석 공간</h1>
          <p>업로드한 슬라이드를 확인하고 분석 결과를 모아보는 공간입니다.</p>
        </div>
        <div className="workspace-actions">
          <button className="btn ghost" onClick={() => router.push("/jobs")}>
            작업 목록
          </button>
          <button className="btn" onClick={() => router.push("/upload")}>
            새 업로드
          </button>
        </div>
      </section>

      {error && <p className="status error">{error}</p>}

      <section className="workspace-grid">
        <div className="card workspace-card">
          <div className="signal">Uploaded File</div>
          <h2>업로드 파일</h2>
          <div className="workspace-preview">
            {job?.input?.fileName && overviewAvailable ? (
              <div className="analysis-tile workspace-upload-tile">
                <div className="workspace-upload-stage" ref={previewStageRef}>
                  <div
                    className="workspace-upload-inner"
                    style={previewFit ? { width: previewFit.width, height: previewFit.height } : undefined}
                  >
                    <img
                      src={`/api/workspace/${sessionId}/overview?t=${overviewTick}`}
                      alt="WSI overview"
                      onLoad={(event) => {
                        const img = event.currentTarget;
                        previewNaturalRef.current = {
                          width: img.naturalWidth || img.width,
                          height: img.naturalHeight || img.height,
                        };
                        computePreviewFit();
                      }}
                      style={!previewFit ? { width: "100%", height: "100%" } : undefined}
                    />
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
                </div>
              </div>
            ) : (
              <div className="preview-placeholder">
                <div>
                  <strong>
                    {overviewGenerating ? "미리보기 생성 중" : "파일 미리보기 준비 중"}
                  </strong>
                  <span>
                    {overviewGenerating
                      ? "WSI에서 overview를 생성하고 있습니다."
                      : "미리보기를 생성하면 업로드 파일을 바로 확인할 수 있습니다."}
                  </span>
                </div>
              </div>
            )}
            <div className="workspace-meta">
              <div>
                <span>파일명</span>
                <strong>{job?.input?.fileName ?? "-"}</strong>
              </div>
              <div>
                <span>파일 크기</span>
                <strong>{formatBytes(job?.input?.fileSize)}</strong>
              </div>
              <div>
                <span>업로드 시간</span>
                <strong>{formatDate(job?.createdAt)}</strong>
              </div>
              <div>
                <span>저장 경로</span>
                <strong>{job?.input?.storagePath ?? "-"}</strong>
              </div>
            </div>
            <div className="workspace-actions-row">
              <button className="btn ghost" onClick={onDownload} disabled={busy || !job}>
                원본 다운로드
              </button>
              <button className="btn ghost" onClick={onPredict} disabled={!job || predicting}>
                {predicting ? "예측 실행 중..." : "사구체 예측 실행"}
              </button>
              {progress && !["idle", "done", "failed", "cancelled"].includes(progress.state) && (
                <button className="btn ghost" onClick={onCancelPredict} disabled={cancelling}>
                  {cancelling ? "예측 취소 중..." : "예측 취소"}
                </button>
              )}
              {progress?.state === "done" && (
                <button
                  className="btn ghost"
                  onClick={() => {
                    const next = !overlayOpen;
                    setOverlayOpen(next);
                    if (next) loadOverlay();
                  }}
                  disabled={!job?.input?.fileName || overlayLoading}
                >
                  {overlayOpen ? "객체 숨기기" : "객체 보기"}
                </button>
              )}
            </div>
            {progress && (
              <div className="progress-meta">
                <span>예측 상태</span>
                <strong>
                  {progress.state}
                  {typeof progress.total_tiles === "number" &&
                  typeof progress.processed_tiles === "number"
                    ? ` (${progress.processed_tiles}/${progress.total_tiles})`
                    : ""}
                </strong>
              </div>
            )}
            {overlayLoading && <span className="hint">객체 로딩 중...</span>}
            {overlayError && <span className="status error">{overlayError}</span>}
          </div>
        </div>

        <div className="card workspace-card">
          <div className="signal">Analysis</div>
          <h2>분석 요약</h2>
          <div className="workspace-summary">
            <div className="summary-row">
              <span>작업 상태</span>
              <span className={`badge ${stateTone(job?.state)}`}>{job?.state ?? "-"}</span>
            </div>
            <div className="summary-row">
              <span>세션 ID</span>
              <strong>{job?.sessionId ?? sessionId}</strong>
            </div>
            <div className="summary-row">
              <span>마지막 업데이트</span>
              <strong>{formatDate(job?.createdAt)}</strong>
            </div>
          </div>
          <div className="analysis-empty">
            <strong>분석 결과 준비 중</strong>
            <span>작업이 완료되면 객체/통계 결과가 여기에 표시됩니다.</span>
          </div>
          <div className="workspace-actions-row">
            <button className="btn primary" disabled>
              분석 실행 (준비 중)
            </button>
            <button className="btn ghost" onClick={() => router.push("/")}>
              대시보드
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
