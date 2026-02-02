"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useRouter } from "next/navigation";

type Job = {
  sessionId: string;
  state?: string;
  createdAt?: { seconds?: number; nanoseconds?: number };
  input?: { fileName?: string; fileSize?: number };
};

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function stateTone(state?: string) {
  const s = (state || "").toUpperCase();
  if (s === "FAILED") return "bad";
  if (s === "COMPLETED") return "good";
  if (s === "UPLOADED") return "pending";
  return "neutral";
}

export default function Home() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string>("");
  const [latestPredictState, setLatestPredictState] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid ?? null);
      setCheckingAuth(false);
    });
    return () => unsub();
  }, []);

  const handleProtectedNav = (path: string) => {
    if (checkingAuth) return;
    if (uid) router.push(path);
    else router.push(`/login?next=${encodeURIComponent(path)}`);
  };

  useEffect(() => {
    if (!uid) {
      setJobs([]);
      setError("");
      return;
    }
    const q = query(collection(db, "users", uid, "jobs"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setError("");
        setJobs(snap.docs.map((d) => d.data() as Job));
      },
      (err) => {
        setJobs([]);
        setError(
          err?.code === "permission-denied"
            ? "Firestore 접근 권한이 없습니다. 로그인 상태와 보안 규칙을 확인하세요."
            : "작업 데이터를 불러오지 못했습니다."
        );
      }
    );
    return () => unsub();
  }, [uid]);

  const metrics = useMemo(() => {
    const totalJobs = jobs.length;
    const totalBytes = jobs.reduce((acc, j) => acc + (j.input?.fileSize ?? 0), 0);
    const failedJobs = jobs.filter((j) => j.state === "FAILED").length;
    const latestState = jobs[0]?.state ?? (uid ? "NO_JOBS" : "SIGNED_OUT");
    return { totalJobs, totalBytes, failedJobs, latestState };
  }, [jobs, uid]);

  const latestJob = useMemo(() => {
    if (jobs.length === 0) return undefined;
    return [...jobs].sort((a, b) => {
      const aSec = a.createdAt?.seconds ?? 0;
      const bSec = b.createdAt?.seconds ?? 0;
      return bSec - aSec;
    })[0];
  }, [jobs]);

  useEffect(() => {
    if (!latestJob?.sessionId) {
      setLatestPredictState(null);
      return;
    }
    let timer: number | null = null;
    const poll = async () => {
      try {
        const res = await fetch(`/api/workspace/${latestJob.sessionId}/progress`);
        if (!res.ok) return;
        const data = await res.json();
        setLatestPredictState(data?.state ?? null);
      } catch {
        // ignore
      } finally {
        timer = window.setTimeout(poll, 4000);
      }
    };
    poll();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [latestJob?.sessionId]);

  return (
    <main className="page">
      <section className="hero">
        <div>
          <div className="signal">Pathology Intelligence</div>
          <h1>
            <span className="hero-headline-line">인공지능 기술로</span>
            <span className="hero-headline-line">병리를 진단합니다</span>
          </h1>
          <p>
            <span className="hero-line">
              슬라이드 수집부터 품질 관리, 조직 구조 분석, 리포팅까지.
            </span>
            <span className="hero-line">
              임상·연구 환경에 최적화된 전 과정을 한 화면에서 관리합니다.
            </span>
          </p>
          <div className="cta-row">
            <a
              className="cta primary"
              href="/upload"
              onClick={(e) => {
                e.preventDefault();
                handleProtectedNav("/upload");
              }}
            >
              슬라이드 업로드
            </a>
            <a
              className="cta ghost"
              href="/jobs"
              onClick={(e) => {
                e.preventDefault();
                handleProtectedNav("/jobs");
              }}
            >
              작업 현황 보기
            </a>
          </div>
        </div>
        <div className="hero-card">
          <div className="signal">Run Status</div>
          <p>
            {uid
              ? "업로드된 슬라이드와 분석 상태를 실시간으로 모니터링합니다."
              : checkingAuth
                ? "세션을 확인 중입니다."
                : "로그인하면 개인 작업 상태와 업로드 통계를 확인할 수 있습니다."}
          </p>
          {error && <p style={{ color: "#9a2f2f", marginTop: 8 }}>{error}</p>}
          <div className="metrics">
            <div className="metric">
              <strong>{metrics.totalJobs}</strong>
              <span>Total Jobs</span>
            </div>
            <div className="metric">
              <strong>{formatBytes(metrics.totalBytes)}</strong>
              <span>Uploaded Size</span>
            </div>
            <div className="metric">
              <strong>{metrics.failedJobs}</strong>
              <span>Failed Jobs</span>
            </div>
            <div className="metric">
              <strong>{metrics.latestState}</strong>
              <span>Latest State</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section-head">
        <div>
          <div className="section-kicker">Workspace</div>
          <h2>내 분석 공간</h2>
        </div>
        <p>최근 업로드한 슬라이드로 바로 이동해 확인하고 분석을 진행할 수 있습니다.</p>
      </section>
      <section className="workspace-entry-grid">
        <div className="card workspace-entry-card">
          <div className="workspace-entry-head">
            <div>
              <div className="signal">Latest Session</div>
              <h3>{latestJob?.sessionId ?? "최근 업로드 없음"}</h3>
            </div>
            {uid && latestJob?.state && (
              <span
                className={`badge ${
                  latestPredictState && latestPredictState !== "idle"
                    ? stateTone(
                        latestPredictState === "done"
                          ? "COMPLETED"
                          : latestPredictState === "failed" || latestPredictState === "cancelled"
                            ? "FAILED"
                            : "PROCESSING"
                      )
                    : stateTone(latestJob.state)
                }`}
              >
                {latestPredictState && latestPredictState !== "idle"
                  ? latestPredictState.toUpperCase()
                  : latestJob.state}
              </span>
            )}
          </div>
          <div className="workspace-entry-meta">
            <div>
              <span>파일명</span>
              <strong>{latestJob?.input?.fileName ?? "-"}</strong>
            </div>
            <div>
              <span>업로드 용량</span>
              <strong>{latestJob?.input?.fileSize ? formatBytes(latestJob.input.fileSize) : "-"}</strong>
            </div>
          </div>
          <div className="workspace-entry-actions">
            <button
              className="btn primary"
              onClick={() => {
                if (!uid) return handleProtectedNav("/jobs");
                if (latestJob?.sessionId) handleProtectedNav(`/workspace/${latestJob.sessionId}`);
                else handleProtectedNav("/upload");
              }}
            >
              분석 공간 열기
            </button>
            <button
              className="btn ghost"
              onClick={() => handleProtectedNav("/jobs")}
            >
              작업 목록
            </button>
          </div>
        </div>
        <div className="card workspace-entry-card">
          <div className="signal">Quick Start</div>
          <h3>새 슬라이드 분석</h3>
          <p className="hint">
            아직 업로드한 슬라이드가 없나요? 바로 업로드하고 분석을 시작하세요.
          </p>
          <div className="workspace-entry-actions">
            <button
              className="btn"
              onClick={() => handleProtectedNav("/upload")}
            >
              슬라이드 업로드
            </button>
          </div>
        </div>
      </section>

      <section className="section-head">
        <div>
          <div className="section-kicker">Platform Overview</div>
          <h2>워크플로우 구성</h2>
        </div>
        <p>데이터 수집부터 분석 결과 공유까지, 병리 데이터 파이프라인을 모듈로 제공합니다.</p>
      </section>
      <section className="panel-grid">
        <div className="panel">
          <h3>Specimen Intake</h3>
          <p>WSI 업로드 및 Metadata 자동 연결</p>
        </div>
        <div className="panel">
          <h3>QC &amp; Tiling</h3>
          <p>배경 제거, 타일링, 객체 검출 수행</p>
        </div>
        <div className="panel">
          <h3>Feature Extraction</h3>
          <p>조직 패턴 및 염색 특성 지표 요약</p>
        </div>
        <div className="panel">
          <h3>Review &amp; Share</h3>
          <p>리포트 생성 및 협업 공유 지원</p>
        </div>
      </section>

      <section className="section-head">
        <div>
          <div className="section-kicker">Execution Flow</div>
          <h2>분석 파이프라인</h2>
        </div>
        <p>표준화된 4단계 흐름으로 분석 품질과 재현성을 확보합니다.</p>
      </section>
      <section className="pipeline">
        <div className="step">
          <div className="signal">Step 01</div>
          <h3>Slide Ingestion</h3>
          <p>WSI 수집 및 스토리지 저장</p>
        </div>
        <div className="step">
          <div className="signal">Step 02</div>
          <h3>Quality Gates</h3>
          <p>품질 및 염색 변이 평가</p>
        </div>
        <div className="step">
          <div className="signal">Step 03</div>
          <h3>Model Inference</h3>
          <p>조직 패턴 분류 및 이상 영역 탐지</p>
        </div>
        <div className="step">
          <div className="signal">Step 04</div>
          <h3>Reporting</h3>
          <p>임상 리포트 (요약 지표, 시각화)</p>
        </div>
      </section>

      <section className="analysis-preview">
        <div className="analysis-head">
          <div className="section-kicker">Analysis Sample</div>
          <h2>분석 예시 이미지</h2>
          <p>대표 슬라이드에 대한 분석 결과 예시를 확인할 수 있습니다.</p>
        </div>
        <div className="analysis-grid">
          {[
            "wt1-adenine-x20",
            "wt2-adenine-x20",
            "wt3-adenine-x20",
            "wt4-normal-x20",
            "wt5-normal-x20",
            "wt6-normal-x20",
          ].map((id, idx) => (
            <a
              className="analysis-tile"
              key={id}
              href={`/analysis/${id}`}
              onClick={(e) => {
                e.preventDefault();
                handleProtectedNav(`/analysis/${id}`);
              }}
            >
              <img src={`/analysis-samples/${id}.jpg`} alt={`Analysis sample ${idx + 1}`} />
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
