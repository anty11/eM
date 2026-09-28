import type { KeyFact } from "@/lib/types";

const ICON = { good: "✓", bad: "✕", warn: "!", neutral: "•", unknown: "?" } as const;

export default function KeyFacts({ facts }: { facts: KeyFact[] }) {
  if (!facts?.length) return null;
  return (
    <section className="card">
      <h2>Prehľad – kľúčové otázky</h2>
      <dl className="facts">
        {facts.map((f) => (
          <div key={f.id} className={`fact t-${f.tone}`}>
            <span className="ficon" aria-hidden>{ICON[f.tone]}</span>
            <dt>{f.question}</dt>
            <dd>
              {f.answer}
              {f.source && <span className="src"> · {f.source}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
