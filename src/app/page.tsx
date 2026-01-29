"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

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

export default function Home() {
  const [uid, setUid] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid ?? null);
    });
    return () => unsub();
  }, []);

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

  return (
    <main className="page">
      <section className="hero">
        <div>
          <div className="signal">Pathology Intelligence</div>
          <h1>WSI 병리 데이터에서 의미 있는 신호를 찾아냅니다.</h1>
          <p>
            슬라이드 입력, 자동 품질 검증, 조직 구조 탐지, 리포트 출력까지.
            병리 데이터 분석 파이프라인을 한 화면에서 관리하세요.
          </p>
          <div className="cta-row">
            <a className="cta primary" href="/upload">
              새 슬라이드 업로드
            </a>
            <a className="cta ghost" href="/jobs">
              분석 작업 보기
            </a>
            <a className="cta ghost" href="/login">
              연구실 로그인
            </a>
          </div>
        </div>
        <div className="hero-card">
          <div className="signal">Run Status</div>
          <h2>Workspace Snapshot</h2>
          <p>
            {uid
              ? "업로드된 슬라이드와 작업 상태를 실시간으로 집계합니다."
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

      <section className="panel-grid">
        <div className="panel">
          <h3>Specimen Intake</h3>
          <p>WSI 파일을 업로드하면 자동으로 샘플 메타데이터가 연결됩니다.</p>
        </div>
        <div className="panel">
          <h3>QC &amp; Tiling</h3>
          <p>배경 제거와 타일링, 아티팩트 감지를 병렬로 수행합니다.</p>
        </div>
        <div className="panel">
          <h3>Feature Extraction</h3>
          <p>핵 밀도, 구조 패턴, 염색 강도를 벡터로 요약합니다.</p>
        </div>
        <div className="panel">
          <h3>Review &amp; Share</h3>
          <p>리포트를 생성하고 팀과 분석 결과를 공유할 수 있습니다.</p>
        </div>
      </section>

      <section className="pipeline">
        <div className="step">
          <div className="signal">Step 01</div>
          <h3>Slide Ingestion</h3>
          <p>2GB까지 WSI를 받아 스토리지에 안전하게 저장합니다.</p>
        </div>
        <div className="step">
          <div className="signal">Step 02</div>
          <h3>Quality Gates</h3>
          <p>초점 품질과 염색 변이를 평가하고 불량 영역을 마스킹합니다.</p>
        </div>
        <div className="step">
          <div className="signal">Step 03</div>
          <h3>Model Inference</h3>
          <p>조직 패턴 분류와 이상 영역 탐지 모델을 동시 실행합니다.</p>
        </div>
        <div className="step">
          <div className="signal">Step 04</div>
          <h3>Reporting</h3>
          <p>임상 리포트에 필요한 요약 지표와 시각화를 준비합니다.</p>
        </div>
      </section>
    </main>
  );
}
