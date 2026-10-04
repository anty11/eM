import { kv } from "./auth/kv";

export type AuditType =
  | "scan"
  | "login"
  | "login_failed"
  | "password_set"
  | "password_changed"
  | "user_added"
  | "user_reset"
  | "user_disabled"
  | "user_enabled"
  | "user_deleted"
  | "role_changed"
  | "mode_changed"
  | "contact_saved"
  | "ai_settings"
  | "ai_check"
  | "company_removed"
  | "order"
  | "order_status"
  | "protocol_sealed";

export interface AuditEvent {
  at: string;
  type: AuditType;
  by: string;
  target?: string;
  detail?: string;
  ico?: string;
  company?: string;
  verdict?: string;
  score?: number;
  scanId?: string;
}

const KEY = "audit";
const MAX = 20000;

export async function audit(e: Omit<AuditEvent, "at">) {
  try {
    await kv().lpush(KEY, { at: new Date().toISOString(), ...e }, MAX);
  } catch (err) {
    console.error("audit zlyhal", err);
  }
}

export async function listAudit(opts: { limit?: number; type?: string; q?: string } = {}): Promise<AuditEvent[]> {
  const limit = Math.min(opts.limit ?? 500, 5000);
  const all = await kv().lrange<AuditEvent>(KEY, 0, opts.q || opts.type ? MAX - 1 : limit - 1);
  const q = (opts.q || "").toLowerCase();
  return all
    .filter((e) => !opts.type || (opts.type === "admin" ? !["scan", "login", "login_failed", "contact_saved", "ai_check"].includes(e.type) : e.type === opts.type))
    .filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q))
    .slice(0, limit);
}
