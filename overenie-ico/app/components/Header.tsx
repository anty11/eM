"use client";

import { useEffect, useState } from "react";
import { Wordmark } from "./Logo";
import { selectedOrg, setSelectedOrg } from "./org";

export interface Me {
  email: string;
  role: "admin" | "user";
  mode?: "firma" | "advokat";
  name?: string;
  orgId?: string;
  orgName?: string;
}

interface OrgRow { id: string; name: string; mode: "firma" | "advokat"; disabled?: boolean; used: number; seats: number }

/** Výber firmy, v mene ktorej správca platformy pracuje (preverenia, databáza, kontakty). */
export function OrgPicker() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [sel, setSel] = useState("");
  useEffect(() => {
    setSel(selectedOrg());
    fetch("/api/admin/orgs").then((r) => r.json()).then((j) => Array.isArray(j) && setOrgs(j)).catch(() => {});
  }, []);
  return (
    <select
      className="org-pick no-print"
      value={sel}
      onChange={(e) => { setSelectedOrg(e.target.value); location.reload(); }}
      title="Firma, v mene ktorej pracujete"
    >
      <option value="">– zvoľte firmu –</option>
      {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}{o.disabled ? " (pozastavená)" : ""}</option>)}
    </select>
  );
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
      {/* Rovnaké písma ako verejný web; v tlači (PDF) sa používajú pôvodné písma z globals.css */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Playfair+Display:wght@400;600;700&display=swap" />
      <div className="wrap">
        <a className="brand" href="/app" style={{ textDecoration: "none", color: "inherit" }} aria-label="Obozretne – klientska sekcia">
          <Wordmark size={22} sub="klientska sekcia" />
        </a>
        {me ? (
          <nav className="nav no-print">
            <a href="/app" style={{ fontWeight: active === "check" ? 600 : 400 }}>Preverenie</a>
            {me.role === "admin" && <a href="/admin" style={{ fontWeight: active === "admin" ? 600 : 400 }}>Administrácia</a>}
            <a href="/account" style={{ fontWeight: active === "account" ? 600 : 400 }}>Preverené spoločnosti</a>
            {me.role === "admin" ? <OrgPicker /> : me.orgName && <span className="who org" title="Vaša spoločnosť">{me.orgName}</span>}
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
