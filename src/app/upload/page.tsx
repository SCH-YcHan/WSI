"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable } from "firebase/storage";
import { useRouter } from "next/navigation";

export default function UploadPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [status, setStatus] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.push("/login");
      else setUid(u.uid);
    });
    return () => unsub();
  }, [router]);

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

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>WSI 업로드</h1>
        <button onClick={() => signOut(auth)}>로그아웃</button>
      </div>

      <p>UID: {uid}</p>
      <p>세션ID: {sessionId || "생성 중..."}</p>

      <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button onClick={onUpload} disabled={!uid || !file}>
        업로드 시작
      </button>

      <div>
        <div>진행률: {progress}%</div>
        <div style={{ height: 10, background: "#eee", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ width: `${progress}%`, height: 10, background: "#333" }} />
        </div>
      </div>

      {status && <p>{status}</p>}

      <hr />
      <button onClick={() => router.push("/jobs")}>내 작업 목록 보기</button>
    </div>
  );
}
