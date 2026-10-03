"use client";

import { useEffect, useState } from "react";

export interface Me {
  email: string;
  role: "admin" | "user";
  mode?: "firma" | "advokat";
  name?: string;
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.status === 401 ? (location.href = "/login", null) : r.json()))
      .then((j) => j && setMe(j))
      .catch(() => {});
  }, []);
  return me;
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  location.href = "/login";
}

export default function Header({ me, active }: { me?: Me | null; active?: "check" | "admin" | "account" }) {
  return (
    <header className="top">
      <div className="wrap">
        <a className="brand" href="/app" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="mark">§</span> Preverto
        </a>
        {me ? (
          <nav className="nav no-print">
            <a href="/app" style={{ fontWeight: active === "check" ? 600 : 400 }}>Preverenie</a>
            {me.role === "admin" && <a href="/admin" style={{ fontWeight: active === "admin" ? 600 : 400 }}>Administrácia</a>}
            <a href="/account" style={{ fontWeight: active === "account" ? 600 : 400 }}>Preverené spoločnosti</a>
            <a href="/account" className="who" title="Môj účet">{me.name || me.email}</a>
            <button className="linkbtn" onClick={logout}>Odhlásiť</button>
          </nav>
        ) : (
          <small>Verejné registre Slovenskej republiky</small>
        )}
      </div>
    </header>
  );
}
