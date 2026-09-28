import { Redis } from "@upstash/redis";

/**
 * Minimálne úložisko kľúč–hodnota. V produkcii Upstash Redis (Vercel → Storage → Upstash),
 * lokálne a v testoch pamäťová náhrada.
 */
export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  lpush(key: string, value: unknown, maxLen: number): Promise<void>;
  lrange<T>(key: string, start: number, stop: number): Promise<T[]>;
  incr(key: string, ttlSec: number): Promise<number>;
}

class RedisKV implements KV {
  constructor(private r: Redis) {}
  async get<T>(key: string) {
    return (await this.r.get<T>(key)) ?? null;
  }
  async set(key: string, value: unknown, ttlSec?: number) {
    if (ttlSec) await this.r.set(key, value, { ex: ttlSec });
    else await this.r.set(key, value);
  }
  async del(key: string) {
    await this.r.del(key);
  }
  async sadd(key: string, m: string) {
    await this.r.sadd(key, m);
  }
  async srem(key: string, m: string) {
    await this.r.srem(key, m);
  }
  async smembers(key: string) {
    return (await this.r.smembers(key)) as string[];
  }
  async lpush(key: string, value: unknown, maxLen: number) {
    const p = this.r.pipeline();
    p.lpush(key, value);
    p.ltrim(key, 0, maxLen - 1);
    await p.exec();
  }
  async lrange<T>(key: string, start: number, stop: number) {
    return (await this.r.lrange<T>(key, start, stop)) as T[];
  }
  async incr(key: string, ttlSec: number) {
    const n = await this.r.incr(key);
    if (n === 1) await this.r.expire(key, ttlSec);
    return n;
  }
}

class MemoryKV implements KV {
  private m = new Map<string, { v: any; exp?: number }>();
  private live(key: string) {
    const e = this.m.get(key);
    if (e && e.exp && e.exp < Date.now()) {
      this.m.delete(key);
      return undefined;
    }
    return e;
  }
  async get<T>(key: string) {
    const e = this.live(key);
    return e ? (structuredClone(e.v) as T) : null;
  }
  async set(key: string, value: unknown, ttlSec?: number) {
    this.m.set(key, { v: structuredClone(value), exp: ttlSec ? Date.now() + ttlSec * 1000 : undefined });
  }
  async del(key: string) {
    this.m.delete(key);
  }
  async sadd(key: string, m: string) {
    const s = new Set<string>(this.live(key)?.v || []);
    s.add(m);
    this.m.set(key, { v: [...s] });
  }
  async srem(key: string, m: string) {
    const s = new Set<string>(this.live(key)?.v || []);
    s.delete(m);
    this.m.set(key, { v: [...s] });
  }
  async smembers(key: string) {
    return [...(this.live(key)?.v || [])];
  }
  async lpush(key: string, value: unknown, maxLen: number) {
    const arr = [structuredClone(value), ...(this.live(key)?.v || [])].slice(0, maxLen);
    this.m.set(key, { v: arr });
  }
  async lrange<T>(key: string, start: number, stop: number) {
    const arr = this.live(key)?.v || [];
    return structuredClone(arr.slice(start, stop < 0 ? undefined : stop + 1)) as T[];
  }
  async incr(key: string, ttlSec: number) {
    const e = this.live(key);
    const n = (e?.v || 0) + 1;
    this.m.set(key, { v: n, exp: e?.exp ?? Date.now() + ttlSec * 1000 });
    return n;
  }
}

const g = globalThis as unknown as { __kv?: KV };

export function kv(): KV {
  if (g.__kv) return g.__kv;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    g.__kv = new RedisKV(new Redis({ url, token }));
  } else {
    if (process.env.NODE_ENV === "production" && !process.env.ALLOW_MEMORY_STORE)
      throw new Error("Chýba databáza: pripojte Upstash Redis (KV_REST_API_URL, KV_REST_API_TOKEN).");
    g.__kv = new MemoryKV();
  }
  return g.__kv;
}

/** Len pre testy. */
export function useMemoryKV() {
  g.__kv = new MemoryKV();
}
