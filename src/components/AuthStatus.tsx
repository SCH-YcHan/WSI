"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { usePathname, useRouter } from "next/navigation";

export default function AuthStatus() {
  const router = useRouter();
  const pathname = usePathname();
  const [uid, setUid] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid ?? null);
      setChecking(false);
    });
    return () => unsub();
  }, []);

  const onLogout = async () => {
    await signOut(auth);
    setConfirmOpen(false);
    router.push("/");
  };

  if (checking) {
    return (
      <div className="auth-top">
        <div className="skeleton pill" />
      </div>
    );
  }

  if (pathname === "/login") return null;

  return (
    <div className="auth-top">
      {uid ? (
        <div className="auth-wrap">
          <button
            className="auth-link"
            onClick={() => setConfirmOpen((v) => !v)}
            type="button"
          >
            <span className="auth-link-dot" />
            로그아웃
          </button>
          {confirmOpen && (
            <div className="auth-confirm">
              <div className="auth-confirm-head">
                <span className="auth-confirm-dot" />
                <div>
                  <div className="auth-confirm-title">Session Control</div>
                  <p>로그아웃 하시겠습니까?</p>
                </div>
              </div>
              <div className="auth-confirm-actions">
                <button className="btn ghost" onClick={() => setConfirmOpen(false)} type="button">
                  취소
                </button>
                <button className="btn primary" onClick={onLogout} type="button">
                  확인
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <button className="auth-link" onClick={() => router.push("/login")} type="button">
          <span className="auth-link-dot" />
          로그인
        </button>
      )}
    </div>
  );
}
