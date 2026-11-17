// Polite HTTP client of the migrator (spec 11.3): at most one request per second, one at a time, retries with
// exponential backoff, an identifiable User-Agent with a contact, robots.txt respected, and every answer cached
// under .cache/{host}/ so a run can be repeated or resumed without asking the source again.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FetcherOptions {
  userAgent: string;
  cacheDir: string;
  minIntervalMs?: number;
  retries?: number;
  /** Only the cache: fails on anything not cached (tests, and re-running a report) */
  offline?: boolean;
  log?: (msg: string) => void;
}

export class Fetcher {
  private last = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private robots = new Map<string, string[]>();
  requests = 0;
  cacheHits = 0;

  constructor(private o: FetcherOptions) {
    if (!o.offline && !/@|https?:\/\//.test(o.userAgent)) throw new Error("The User-Agent must identify a contact (email or URL)");
  }

  private file(url: string, ext: string) {
    const u = new URL(url);
    const dir = join(this.o.cacheDir, u.host);
    mkdirSync(dir, { recursive: true });
    return join(dir, createHash("sha1").update(url).digest("hex") + ext);
  }

  /** One request at a time, never closer than minIntervalMs to the previous one */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.last + (this.o.minIntervalMs ?? 1000) - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.last = Date.now();
      this.requests++;
      return fn();
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private async request(url: string, referer?: string): Promise<Response | null> {
    const retries = this.o.retries ?? 4;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.serial(() => fetch(url, {
          headers: { "User-Agent": this.o.userAgent, Accept: "*/*", ...(referer ? { Referer: referer } : {}) },
          redirect: "follow",
          signal: AbortSignal.timeout(30_000),
        }));
        if (res.status === 404 || res.status === 410) return null;
        if (res.ok) return res;
        if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} for ${url}`);
        if (attempt >= retries) throw new Error(`HTTP ${res.status} for ${url} after ${retries} retries`);
      } catch (err) {
        if (attempt >= retries || (err instanceof Error && /^HTTP 4\d\d/.test(err.message) && !/429/.test(err.message))) throw err;
      }
      const backoff = 1000 * 2 ** attempt + Math.floor(Math.random() * 500);
      this.o.log?.(`  retry ${attempt + 1}/${retries} in ${(backoff / 1000).toFixed(1)} s: ${url}`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }

  /** robots.txt of the host, read once (missing robots.txt = everything allowed) */
  private async allowed(url: string): Promise<boolean> {
    const u = new URL(url);
    if (!this.robots.has(u.host)) {
      const txt = await this.text(`${u.protocol}//${u.host}/robots.txt`, undefined, true);
      const rules: string[] = [];
      let applies = false;
      for (const line of (txt ?? "").split(/\r?\n/)) {
        const [k, ...rest] = line.split(":");
        const v = rest.join(":").trim();
        if (/^user-agent$/i.test(k.trim())) applies = v === "*" || /inmo-uy/i.test(v);
        else if (applies && /^disallow$/i.test(k.trim()) && v) rules.push(v);
      }
      this.robots.set(u.host, rules);
    }
    const path = u.pathname + u.search;
    return !this.robots.get(u.host)!.some(rule => path.startsWith(rule));
  }

  /** Text of a page (cached). null when the source answers 404. */
  async text(url: string, referer?: string, skipRobots = false): Promise<string | null> {
    const f = this.file(url, ".html");
    if (existsSync(f)) { this.cacheHits++; const s = readFileSync(f, "utf8"); return s === "\u0000404" ? null : s; }
    if (this.o.offline) throw new Error(`Not in the cache (offline): ${url}`);
    if (!skipRobots && !(await this.allowed(url))) throw new Error(`robots.txt does not allow ${url}`);
    const res = await this.request(url, referer);
    const body = res ? await res.text() : null;
    writeFileSync(f, body ?? "\u0000404");
    return body;
  }

  /** Bytes of a photo (cached). null when the source answers 404. */
  async bytes(url: string, referer?: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const f = this.file(url, ".bin");
    const meta = f + ".type";
    if (existsSync(f)) { this.cacheHits++; return { buffer: readFileSync(f), mimeType: readFileSync(meta, "utf8") }; }
    if (this.o.offline) throw new Error(`Not in the cache (offline): ${url}`);
    if (!(await this.allowed(url))) throw new Error(`robots.txt does not allow ${url}`);
    const res = await this.request(url, referer);
    if (!res) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = (res.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
    writeFileSync(f, buffer);
    writeFileSync(meta, mimeType);
    return { buffer, mimeType };
  }
}
