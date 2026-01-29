"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useRouter } from "next/navigation";

type Job = {
  sessionId: string;
  state: string;
  input?: { fileName?: string; fileSize?: number; storagePath?: string };
};

export default function JobsPage() {
  const router = useRouter();
  const [uid, setUid] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (!u) router.push("/login");
      else setUid(u.uid);
    });
    return () => unsubAuth();
  }, [router]);

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

  return (
    <div style={{ maxWidth: 720, margin: "40px auto" }}>
      <h1>내 작업 목록</h1>
      <button onClick={() => router.push("/upload")}>업로드로</button>
      {error && <p style={{ color: "crimson", marginTop: 12 }}>{error}</p>}
      <ul style={{ marginTop: 16 }}>
        {jobs.map((j) => (
          <li key={j.sessionId} style={{ padding: 12, border: "1px solid #ddd", marginBottom: 8 }}>
            <div>sessionId: {j.sessionId}</div>
            <div>state: {j.state}</div>
            <div>file: {j.input?.fileName}</div>
            <div>path: {j.input?.storagePath}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
