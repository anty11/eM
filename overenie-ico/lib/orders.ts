import { audit } from "./audit";
import { kv } from "./auth/kv";
import { normalizeIco } from "./ico";

/**
 * Objednávky / dopyty z verejného webu. Ukladajú sa do databázy a zobrazujú administrátorom
 * (Administrácia → Objednávky). E-mailové upozornenie sa pošle, ak je nastavený ORDER_WEBHOOK_URL
 * (napr. Make/Zapier/Slack webhook) – aplikácia sama e-maily neodosiela.
 */
export interface Order {
  id: string;
  at: string;
  company: string;
  ico: string;
  contactName: string;
  email: string;
  phone: string;
  users: number;
  plan: "standard" | "rozsirene";
  message: string;
  consent: true;
  ip?: string;
  status: "new" | "contacted" | "done";
}

const KEY = "orders";
const MAX = 5000;
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export class OrderError extends Error {}

export async function createOrder(input: Record<string, unknown>, ip: string): Promise<Order> {
  if (str(input.website, 50)) throw new OrderError("Odoslanie zlyhalo."); // pasca na roboty
  const n = await kv().incr(`rl:order:${ip}`, 3600);
  if (n > 10) throw new OrderError("Príliš veľa odoslaní z tejto adresy. Skúste to o hodinu alebo nám napíšte e-mail.");

  const company = str(input.company, 160);
  const contactName = str(input.contactName, 120);
  const email = str(input.email, 120).toLowerCase();
  const phone = str(input.phone, 40);
  const ico = normalizeIco(str(input.ico, 12)) || "";
  if (company.length < 2) throw new OrderError("Zadajte názov spoločnosti.");
  if (str(input.ico, 12) && !ico) throw new OrderError("IČO má 6 až 8 číslic.");
  if (contactName.length < 3) throw new OrderError("Zadajte meno kontaktnej osoby.");
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new OrderError("Zadajte platný e-mail.");
  if (phone && !/^[+\d][\d\s/()-]{5,}$/.test(phone)) throw new OrderError("Neplatné telefónne číslo.");
  if (input.consent !== true && input.consent !== "true" && input.consent !== "on") throw new OrderError("Potvrďte súhlas so spracovaním údajov.");
  const users = Math.min(500, Math.max(1, parseInt(String(input.users || "1"), 10) || 1));
  const plan = input.plan === "rozsirene" ? "rozsirene" : "standard";

  const o: Order = {
    id: `OBJ-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    at: new Date().toISOString(),
    company,
    ico,
    contactName,
    email,
    phone,
    users,
    plan,
    message: str(input.message, 2000),
    consent: true,
    ip,
    status: "new",
  };
  await kv().lpush(KEY, o, MAX);
  await audit({ type: "order", by: email, target: o.id, ico: ico || undefined, company, detail: `${plan}, ${users} používateľov` });
  notify(o).catch(() => undefined);
  return o;
}

async function notify(o: Order) {
  const url = process.env.ORDER_WEBHOOK_URL;
  if (!url) return;
  const text = `Nová objednávka ${o.id}: ${o.company} (IČO ${o.ico || "–"}), ${o.contactName}, ${o.email}, ${o.phone || "–"}, ${o.users} používateľov, verzia ${o.plan}. ${o.message}`;
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, order: o }) });
}

export async function listOrders(limit = 500): Promise<Order[]> {
  return kv().lrange<Order>(KEY, 0, limit - 1);
}

export async function setOrderStatus(id: string, status: Order["status"], by: string) {
  const all = await kv().lrange<Order>(KEY, 0, MAX - 1);
  const i = all.findIndex((o) => o.id === id);
  if (i < 0) throw new OrderError("Objednávka sa nenašla.");
  all[i] = { ...all[i], status };
  // zoznam sa prepíše celý (objednávok je málo)
  await kv().del(KEY);
  for (const o of [...all].reverse()) await kv().lpush(KEY, o, MAX);
  await audit({ type: "order_status", by, target: id, detail: status });
  return all[i];
}
