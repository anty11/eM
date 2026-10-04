import { kv } from "./auth/kv";
import { LEGACY_ORG, orgKey } from "./orgs";

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
  | "protocol_sealed"
  | "org_created"
  | "org_updated"
  | "ov_import";

export interface AuditEvent {
  at: string;
  type: AuditType;
  /** Firma, ktorej sa udalosť týka; bez firmy = udalosť platformy (správcovia, objednávky, neznáme prihlásenia) */
  orgId?: string;
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

/** Zápis udalosti: s `orgId` do protokolu firmy, bez neho do protokolu platformy. */
export async function audit(e: Omit<AuditEvent, "at">) {
  try {
    const key = e.orgId ? orgKey(e.orgId, "audit") : KEY;
    await kv().lpush(key, { at: new Date().toISOString(), ...e }, MAX);
  } catch (err) {
    console.error("audit zlyhal", err);
  }
}

/**
 * Čítanie protokolu: `orgId` = protokol firmy (pre LEGACY_ORG aj pôvodný spoločný protokol spred viacfiremného režimu),
 * bez `orgId` = protokol platformy. Volajúci musí oprávnenie overiť vopred.
 */
export async function listAudit(opts: { orgId?: string; limit?: number; type?: string; q?: string } = {}): Promise<AuditEvent[]> {
  const limit = Math.min(opts.limit ?? 500, 5000);
  const take = opts.q || opts.type ? MAX - 1 : limit - 1;
  let all = await kv().lrange<AuditEvent>(opts.orgId ? orgKey(opts.orgId, "audit") : KEY, 0, take);
  if (opts.orgId === LEGACY_ORG) {
    const legacy = (await kv().lrange<AuditEvent>(KEY, 0, MAX - 1)).filter((e) => !e.orgId && !PLATFORM_TYPES.has(e.type));
    all = [...all, ...legacy].sort((a, b) => (a.at < b.at ? 1 : -1));
  }
  const q = (opts.q || "").toLowerCase();
  return all
    .filter((e) => !opts.type || (opts.type === "admin" ? !["scan", "login", "login_failed", "contact_saved", "ai_check"].includes(e.type) : e.type === opts.type))
    .filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q))
    .slice(0, limit);
}

/** Udalosti, ktoré patria platforme aj v pôvodnom spoločnom protokole (nepresúvajú sa do firmy LEGACY_ORG). */
const PLATFORM_TYPES = new Set<AuditType>(["order", "order_status", "ai_settings", "org_created", "org_updated"]);
