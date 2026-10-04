/**
 * Logo Obozretne.
 * - Wordmark (hlavné logo): „obozretne“ + zlatá bodka – číta sa ako výrok „Obozretne.“; prvé písmeno zvýraznené zlatou.
 * - Seal (symbol): dvojitý kruh so zlatou fajkou – používa sa tam, kde treba len znak (favicon, malé plochy).
 * Farby sa dedia z CSS premenných, kde sú k dispozícii; na tmavom pozadí použite `onDark`.
 */
export function Wordmark({ size = 26, onDark = false, sub }: { size?: number; onDark?: boolean; sub?: string }) {
  const ink = onDark ? "#ffffff" : "var(--s-ink, var(--ink, #1d1a2b))";
  const gold = onDark ? "#e2c07a" : "var(--s-gold, var(--gold, #b8893a))";
  const dot = onDark ? "#ffffff" : "var(--s-primary, var(--brand, #5b35c9))";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1, width: "max-content" }}>
      <span
        style={{
          fontFamily: '"Montserrat", "Inter", "Segoe UI", system-ui, sans-serif',
          fontWeight: 600,
          fontSize: size,
          letterSpacing: "-0.02em",
          color: ink,
          display: "inline-flex",
          alignItems: "baseline",
        }}
      >
        <span style={{ color: gold }}>o</span>bozretne
        <span aria-hidden style={{ display: "inline-block", width: size * 0.26, height: size * 0.26, borderRadius: "50%", background: dot, marginLeft: size * 0.14, transform: "translateY(-1px)" }} />
      </span>
      {sub && (
        <span style={{ fontFamily: '"Montserrat", "Inter", system-ui, sans-serif', fontSize: Math.max(9, size * 0.34), letterSpacing: "0.14em", textTransform: "uppercase", color: gold, fontWeight: 600, marginTop: size * 0.2, whiteSpace: "nowrap" }}>
          {sub}
        </span>
      )}
    </span>
  );
}

export function Seal({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  const ring = onDark ? "#ffffff" : "var(--s-primary, var(--brand, #5b35c9))";
  const tick = onDark ? "#e2c07a" : "var(--s-gold, var(--gold, #b8893a))";
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden focusable="false">
      <circle cx="28" cy="28" r="22" fill="none" stroke={ring} strokeWidth="3" />
      <circle cx="28" cy="28" r="15" fill="none" stroke={ring} strokeWidth="1.5" opacity="0.45" />
      <path d="M19 29 L25.5 35.5 L38 21" fill="none" stroke={tick} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
