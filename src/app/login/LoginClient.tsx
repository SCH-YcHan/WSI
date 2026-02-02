"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string>("");
  const nextParam = searchParams.get("next");
  const nextPath = nextParam && nextParam.startsWith("/") ? nextParam : "/";

  const onLogin = async () => {
    setMsg("");
    try {
      await signInWithEmailAndPassword(auth, email, pw);
      router.push(nextPath);
    } catch (e: any) {
      setMsg(e?.message ?? "로그인 실패");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="signal">Secure Access</div>
        <h1>WSI 로그인</h1>
        <p>병리 분석 워크스페이스에 연결합니다.</p>
        <label className="auth-field">
          이메일
          <input
            className="auth-input"
            placeholder="lab@hospital.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="auth-field">
          비밀번호
          <input
            className="auth-input"
            placeholder="••••••••"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </label>
        <div className="auth-actions">
          <button className="auth-button" onClick={onLogin}>
            로그인
          </button>
          {msg && <p style={{ color: "crimson" }}>{msg}</p>}
        </div>
        <div className="auth-help">
          접근 권한이 없는 경우 관리자에게 계정을 요청하세요.
        </div>
      </div>
    </div>
  );
}
