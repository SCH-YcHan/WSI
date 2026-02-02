"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable } from "firebase/storage";
import { useRouter } from "next/navigation";

export default function UploadPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string>("");
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [status, setStatus] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
      else setUid("");
      setCheckingAuth(false);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!checkingAuth && !uid) router.push("/login?next=/upload");
  }, [checkingAuth, uid, router]);

  useEffect(() => {
    const id = Math.random().toString(16).slice(2) + Date.now().toString(16);
    setSessionId(id);
  }, []);

  const onUpload = async () => {
    if (!uid) return;
    if (!file) return alert("파일을 선택해줘");

    // 2GB 제한 (규칙에도 있지만 UI에서 한번 더)
    if (file.size >= 2 * 1024 * 1024 * 1024) {
      return alert("파일이 2GB를 초과했어");
    }

    setStatus("업로드 시작...");
    setProgress(0);

    // Storage 경로: uploads/{uid}/{sessionId}/{filename}
    const path = `uploads/${uid}/${sessionId}/${file.name}`;
    const storageRef = ref(storage, path);

    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type || "application/octet-stream",
    });

    task.on(
      "state_changed",
      (snap) => {
        const p = (snap.bytesTransferred / snap.totalBytes) * 100;
        setProgress(Math.floor(p));
      },
      (err) => {
        setStatus("업로드 실패: " + err.message);
      },
      async () => {
        setStatus("업로드 완료. job 생성 중...");

        // Firestore에 job 문서 생성: users/{uid}/jobs/{sessionId}
        await setDoc(doc(db, "users", uid, "jobs", sessionId), {
          sessionId,
          uid,
          state: "UPLOADED",
          createdAt: serverTimestamp(),
          input: {
            storagePath: path,
            fileName: file.name,
            fileSize: file.size,
          },
        });

        setStatus("완료! (서버가 이제 예측을 시작하면 됨)");
      }
    );
  };

  if (checkingAuth) {
    return (
      <main className="workspace-page">
        <section className="workspace-header">
          <div>
            <div className="signal">Data Intake</div>
            <h1>WSI 업로드</h1>
            <p>세션을 확인 중입니다.</p>
          </div>
        </section>
        <section className="upload-grid">
          <div className="card upload-card">
            <div className="skeleton block" />
            <div className="skeleton line" />
            <div className="skeleton line short" />
            <div className="skeleton bar" />
          </div>
          <div className="card upload-card info-card">
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
          <div className="signal">Data Intake</div>
          <h1>WSI 업로드</h1>
          <p>병리 슬라이드를 안전하게 올리고 자동 분석 작업을 시작합니다.</p>
        </div>
        <div className="workspace-actions">
          <button className="btn ghost" onClick={() => router.push("/jobs")}>
            작업 목록
          </button>
        </div>
      </section>

      <section className="upload-grid">
        <div className="card upload-card">
          <div className="upload-drop">
            <input
              id="wsi-file"
              className="upload-input"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <label className="upload-label" htmlFor="wsi-file">
              <div className="upload-icon">+</div>
              <div>
                <strong>{file ? file.name : "파일 선택"}</strong>
                <span>{file ? `${Math.round(file.size / 1024 / 1024)} MB` : "WSI 파일을 선택하세요."}</span>
              </div>
            </label>
          </div>

          <div className="upload-actions">
            <button className="btn primary" onClick={onUpload} disabled={!uid || !file}>
              업로드 시작
            </button>
            <div className="progress-meta">
              <span>진행률</span>
              <strong>{progress}%</strong>
            </div>
          </div>

          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>

          {status && <p className="status">{status}</p>}
        </div>

        <div className="card upload-card info-card">
          <div className="signal">Session</div>
          <h2>업로드 정보</h2>
          <div className="info-list">
            <div>
              <span>UID</span>
              <strong>{uid}</strong>
            </div>
            <div>
              <span>세션 ID</span>
              <strong>{sessionId || "생성 중..."}</strong>
            </div>
          </div>
          <div className="hint">
            - 최대 2GB까지 업로드 가능
            <br />- 업로드 완료 후 자동으로 작업이 생성됩니다.
          </div>
        </div>
      </section>
    </main>
  );
}
