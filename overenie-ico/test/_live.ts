import { scan } from "../lib/scan";
async function main() {
  const r = await scan(process.argv[2] || "31322832");
  console.log(JSON.stringify({ verdict: r.verdict, profile: { name: r.profile.name, established: r.profile.established, legalForm: r.profile.legalForm } }, null, 1));
  for (const c of r.checks) console.log(c.id, c.status, "|", c.summary.slice(0, 220), "|", c.findings.map((f) => `${f.severity}:${f.penalty}:${f.text.slice(0, 90)}`).join(" ; "));
}
main();
