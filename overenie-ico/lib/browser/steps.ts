import type { SessionLog } from "./session";

/**
 * Krok sedenia ľudskými slovami (do protokolu): „Vyplnené pole „IČO:“ = 31322832“, „Kliknuté na „Vyhľadať podania““ – namiesto
 * technických odkazov na prvky (e26, e31). Popis prvku: viditeľný popis, inak technický názov poľa bez predpôn ASP.NET.
 */
export function describeStep(l: SessionLog): string {
  const t = l.target;
  const raw = (t?.label || t?.placeholder || t?.name || "").trim();
  const name = raw.includes("$") ? raw.split("$").pop()!.replace(/^(txt|tb|inp|ddl|rb|chk|btn|lbl|cmb)(?=[A-Z])/, "") : raw;
  const what = name ? `„${name.replace(/[:\s]+$/, "")}“` : "prvok";
  const fail = l.ok ? "" : ` – neúspešné${l.note ? ` (${l.note.slice(0, 120)})` : ""}`;
  const [verb, ...rest] = l.action.split(" ");
  let text: string;
  switch (verb) {
    case "open": {
      let u = rest.join(" ");
      try {
        const x = new URL(u);
        u = `${x.hostname}${x.pathname}`;
      } catch {}
      text = `Otvorená stránka ${u}`;
      break;
    }
    case "fill":
      text = `Vyplnené pole ${what}: ${l.value ?? ""}`;
      break;
    case "click":
      text = /^„/.test(rest.join(" ")) ? `Kliknuté na odkaz ${rest.join(" ")}` : t?.kind === "radio" || t?.kind === "checkbox" ? `Zvolená možnosť ${what}` : `Kliknuté na ${what}`;
      break;
    case "enter":
      text = `Odoslané klávesom Enter v poli ${what}`;
      break;
    case "select":
      text = `Vybraté v ${what}: ${l.value ?? ""}`;
      break;
    case "wait":
      text = "Čakanie na načítanie stránky";
      break;
    default:
      text = l.action;
  }
  return `${l.ok ? "✓" : "✗"} ${text}${fail}`;
}

