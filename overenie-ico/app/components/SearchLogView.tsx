"use client";

import { queryLine, searchLine } from "@/lib/searchlog";
import type { SearchLog } from "@/lib/types";

/**
 * Ako sa v zdroji hľadalo – riadok vždy viditeľný (aj v PDF), po rozbalení dopyty s odkazmi, počty a ukážka vrátených záznamov,
 * ktoré sa nezhodovali (na kontrolu, či hľadanie mieri správne).
 */
export default function SearchLogView({ search }: { search?: SearchLog[] }) {
  if (!search?.length) return null;
  return (
    <div className="search-log">
      {search.map((s, i) => (
        <details key={i}>
          <summary>{searchLine(s)}</summary>
          <ol>
            {s.queries.map((q, j) => (
              <li key={j}>
                {queryLine(q)}
                {q.url ? (
                  <>
                    {" · "}
                    <a href={q.url} target="_blank" rel="noreferrer" className="no-print">
                      dopyt ↗
                    </a>
                    <span className="print-only mono"> {q.url}</span>
                  </>
                ) : null}
              </li>
            ))}
          </ol>
          {s.sample?.length ? (
            <div className="src">
              Vrátené, ale nezhodné záznamy (ukážka): {s.sample.join(" | ")}
            </div>
          ) : null}
        </details>
      ))}
    </div>
  );
}
