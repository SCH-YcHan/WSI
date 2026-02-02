"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { useRouter } from "next/navigation";

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

function stateTone(state?: string) {
  const s = (state || "").toUpperCase();
  if (s === "FAILED") return "bad";
  if (s === "COMPLETED") return "good";
  if (s === "UPLOADED") return "pending";
  return "neutral";
}

export default function JobsPage() {
  const router = useRouter();
  const [uid, setUid] = useState("");
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string>("");
  const [queryText, setQueryText] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sortOrder, setSortOrder] = useState<"latest" | "oldest">("latest");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [predictStatus, setPredictStatus] = useState<Record<string, { state: string }>>({});

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
      else setUid("");
      setCheckingAuth(false);
    });
    return () => unsubAuth();
  }, [router]);

  useEffect(() => {
    if (!checkingAuth && !uid) router.push("/login?next=/jobs");
  }, [checkingAuth, uid, router]);

  useEffect(() => {
    if (!uid) return;
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
            : "작업 목록을 불러오지 못했습니다."
        );
      }
    );
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (jobs.length === 0) return;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const next: Record<string, { state: string }> = {};
        await Promise.all(
          jobs.map(async (j) => {
            const fileName = j.input?.fileName;
            if (!fileName) return;
            const res = await fetch(
              `/api/workspace/${j.sessionId}/progress?fileName=${encodeURIComponent(fileName)}`
            );
            if (!res.ok) return;
            const data = await res.json();
            if (data?.state) next[j.sessionId] = { state: data.state };
          })
        );
        if (Object.keys(next).length > 0) setPredictStatus(next);
      } catch {
        // ignore polling errors
      } finally {
        timer = window.setTimeout(poll, 4000);
      }
    };
    poll();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [jobs]);

  const filteredJobs = jobs
    .filter((j) => {
      const name = j.input?.fileName?.toLowerCase() ?? "";
      const q = queryText.trim().toLowerCase();
      const matchQuery = !q || name.includes(q);
      const matchStatus = statusFilter === "ALL" || j.state === statusFilter;
      return matchQuery && matchStatus;
    })
    .sort((a, b) => {
      const aSec = a.createdAt?.seconds ?? 0;
      const bSec = b.createdAt?.seconds ?? 0;
      return sortOrder === "latest" ? bSec - aSec : aSec - bSec;
    });

  const onDownload = async (job: Job) => {
    if (!job.input?.storagePath) return;
    setBusyId(job.sessionId);
    try {
      const url = await getDownloadURL(ref(storage, job.input.storagePath));
      window.open(url, "_blank");
    } catch (e: any) {
      setError(e?.message ?? "다운로드 링크를 가져오지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (job: Job) => {
    if (!uid) return;
    setBusyId(job.sessionId);
    try {
      if (job.input?.storagePath) {
        await deleteObject(ref(storage, job.input.storagePath));
      }
      await deleteDoc(doc(db, "users", uid, "jobs", job.sessionId));
      await fetch(`/api/workspace/${job.sessionId}/cleanup`, { method: "POST" });
      setConfirmId(null);
    } catch (e: any) {
      setError(e?.message ?? "삭제에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  const predictBadge = (job: Job) => {
    const state = predictStatus[job.sessionId]?.state;
    if (!state || state === "idle") return null;
    return state.toUpperCase();
  };

  const predictTone = (state?: string) => {
    if (!state) return "neutral";
    if (state === "done") return "good";
    if (state === "failed" || state === "cancelled") return "bad";
    return "pending";
  };

  const onCancelPredict = async (job: Job) => {
    if (!job.input?.fileName) return;
    setBusyId(job.sessionId);
    try {
      await fetch(`/api/workspace/${job.sessionId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: job.input.fileName }),
      });
    } catch (e: any) {
      setError(e?.message ?? "예측 취소에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  if (checkingAuth) {
    return (
      <main className="workspace-page">
        <section className="workspace-header">
          <div>
            <div className="signal">Operations</div>
            <h1>분석 작업</h1>
            <p>세션을 확인 중입니다.</p>
          </div>
        </section>
        <section className="jobs-grid">
          <div className="card job-card">
            <div className="skeleton line" />
            <div className="skeleton line short" />
            <div className="skeleton block" />
          </div>
          <div className="card job-card">
            <div className="skeleton line" />
            <div className="skeleton line short" />
            <div className="skeleton block" />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace-page">
      <section className="workspace-header">
        <div>
          <div className="signal">Operations</div>
          <h1>분석 작업</h1>
          <p>슬라이드 분석 진행 상황과 결과를 추적합니다.</p>
        </div>
        <div className="workspace-actions">
          <button className="btn ghost" onClick={() => router.push("/upload")}>
            업로드로
          </button>
          <button className="btn" onClick={() => router.push("/")}>
            대시보드
          </button>
        </div>
      </section>

      {error && <p className="status error">{error}</p>}

      <div className="jobs-toolbar">
        <div className="jobs-search">
          <input
            className="jobs-input"
            placeholder="파일명으로 검색"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
          />
        </div>
        <div className="jobs-filters">
          <select
            className="jobs-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">전체 상태</option>
            <option value="UPLOADED">UPLOADED</option>
            <option value="PROCESSING">PROCESSING</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="FAILED">FAILED</option>
          </select>
          <select
            className="jobs-select"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as "latest" | "oldest")}
          >
            <option value="latest">최신순</option>
            <option value="oldest">오래된 순</option>
          </select>
        </div>
      </div>

      <section className="jobs-grid">
        {filteredJobs.length === 0 && !error ? (
          <div className="card empty-card">
            <h2>아직 작업이 없습니다.</h2>
            <p>새로운 슬라이드를 업로드하면 바로 작업이 생성됩니다.</p>
            <button className="btn primary" onClick={() => router.push("/upload")}>
              새 슬라이드 업로드
            </button>
          </div>
        ) : (
          filteredJobs.map((j) => (
            <div className="card job-card" key={j.sessionId}>
              <div className="job-head">
                <div>
                  <div className="signal">Session</div>
                  <h2>{j.sessionId}</h2>
                </div>
                {predictBadge(j) ? (
                  <span className={`badge ${predictTone(predictStatus[j.sessionId]?.state)}`}>
                    {predictBadge(j)}
                  </span>
                ) : (
                  <span className={`badge ${stateTone(j.state)}`}>{j.state}</span>
                )}
              </div>
              <div className="job-meta">
                <div>
                  <span>파일명</span>
                  <strong>{j.input?.fileName ?? "-"}</strong>
                </div>
                <div>
                  <span>저장 경로</span>
                  <strong>{j.input?.storagePath ?? "-"}</strong>
                </div>
                <div>
                  <span>업로드 시간</span>
                  <strong>{formatDate(j.createdAt)}</strong>
                </div>
              </div>
              <div className="job-actions">
                <button className="btn ghost" onClick={() => router.push(`/workspace/${j.sessionId}`)}>
                  분석 공간
                </button>
                <button
                  className="btn ghost"
                  disabled={busyId === j.sessionId}
                  onClick={() => onDownload(j)}
                >
                  다운로드
                </button>
                {(() => {
                  const st = predictStatus[j.sessionId]?.state;
                  if (!st || st === "idle" || st === "done" || st === "failed" || st === "cancelled") return null;
                  return (
                    <button
                      className="btn ghost"
                      disabled={busyId === j.sessionId}
                      onClick={() => onCancelPredict(j)}
                    >
                      예측 취소
                    </button>
                  );
                })()}
                {confirmId === j.sessionId ? (
                  <div className="job-confirm">
                    <span>삭제하시겠습니까?</span>
                    <button
                      className="btn ghost"
                      disabled={busyId === j.sessionId}
                      onClick={() => setConfirmId(null)}
                    >
                      취소
                    </button>
                    <button
                      className="btn primary"
                      disabled={busyId === j.sessionId}
                      onClick={() => onDelete(j)}
                    >
                      확인
                    </button>
                  </div>
                ) : (
                  <button className="btn" onClick={() => setConfirmId(j.sessionId)}>
                    삭제
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
