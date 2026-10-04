"use client";

/**
 * Firma, v mene ktorej pracuje správca platformy (uložená v prehliadači). Používatelia firiem ju nepotrebujú –
 * server pre nich parameter `org` ignoruje a vždy použije ich vlastnú firmu.
 */
const KEY = "oi_org";

export function selectedOrg(): string {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function setSelectedOrg(id: string) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {}
}

/** Doplní `org=` do adresy API, ak je zvolená firma. */
export function withOrg(url: string): string {
  const o = selectedOrg();
  if (!o) return url;
  return `${url}${url.includes("?") ? "&" : "?"}org=${encodeURIComponent(o)}`;
}
