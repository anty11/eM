"use client";

/** Prepojenia osôb: tabuľka ďalších firiem štatutárov a spoločníkov (z `data.persons` zdroja `persons`). */
type Company = { ico: string; name: string; role: string; since?: string; until?: string; currentRole: boolean; terminated?: string; verified: boolean; flags: string[]; risky: boolean };
type Link = { name: string; role: string; returned: number; examined: number; excluded: number; companies: Company[]; error?: string };

const d = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("sk-SK", { day: "numeric", month: "numeric", year: "numeric" }) : "");

export default function PersonsTable({ persons }: { persons?: Link[] }) {
  if (!persons?.length) return null;
  const rows = persons.flatMap((p) => p.companies.map((c) => ({ p, c })));
  return (
    <div className="persons">
      {rows.length > 0 && (
        <table className="persons-table">
          <thead>
            <tr>
              <th>Osoba</th>
              <th>Ďalšia firma</th>
              <th>Funkcia</th>
              <th>Stav</th>
              <th>Zistenia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, c }, i) => (
              <tr key={i} className={c.risky ? "f-warning" : undefined}>
                <td>{p.name}</td>
                <td>
                  {c.ico ? (
                    <a href={`https://www.orsr.sk/hladaj_ico.asp?ICO=${c.ico}&SID=0`} target="_blank" rel="noreferrer">{c.name}</a>
                  ) : (
                    c.name
                  )}
                  {c.ico ? <span className="src"> · IČO {c.ico}</span> : null}
                </td>
                <td>
                  {c.role}
                  {c.since ? ` od ${d(c.since)}` : ""}
                  {c.until ? ` do ${d(c.until)}` : ""}
                </td>
                <td>{c.terminated ? `zanikla ${d(c.terminated)}` : c.currentRole ? "aktívna, osoba vo funkcii" : "aktívna, osoba už mimo"}</td>
                <td>
                  {c.flags.filter((f) => !/^zanikla/.test(f)).join(", ") || "bez záznamu"}
                  {!c.verified ? <span className="src"> (zhoda len podľa mena)</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="src">
        {persons
          .map((p) => `${p.name} (${p.role}): register vrátil ${p.returned} ${p.returned === 1 ? "záznam" : p.returned >= 2 && p.returned <= 4 ? "záznamy" : "záznamov"}, preverených ${p.examined}${p.excluded ? `, vylúčených menovcov ${p.excluded}` : ""}${p.error ? `, chyba: ${p.error}` : ""}`)
          .join(" · ")}
      </div>
    </div>
  );
}
