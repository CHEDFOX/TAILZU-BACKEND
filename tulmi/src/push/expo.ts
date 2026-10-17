/**
 * Expo's push service: the app registers an Expo push token (see
 * POST /v1/push/register), and Expo relays to APNs and FCM.
 *
 * Two calls. `send` hands over up to a hundred messages at a time and gets a
 * ticket per message, in order. `receipts`, a while later, says what APNs or
 * FCM did with each ticket — which is where a token that no longer belongs to
 * an installed app shows up (DeviceNotRegistered), so the engine can drop it.
 *
 * EXPO_ACCESS_TOKEN is only needed if "enhanced push security" is turned on
 * for the project in Expo's dashboard.
 */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  channelId?: string;
  /** Seconds a push may wait for an offline phone before it is dropped. */
  ttl?: number;
  priority?: "default" | "normal" | "high";
}

export interface Ticket {
  status: "ok" | "error";
  id?: string;
  /** Expo's error code, e.g. DeviceNotRegistered, MessageRateExceeded. */
  error?: string;
}

export interface Receipt {
  status: "ok" | "error";
  error?: string;
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<Ticket[]>;
  receipts(ids: string[]): Promise<Record<string, Receipt>>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class ExpoSender implements PushSender {
  private readonly base: string;
  private readonly token?: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: { accessToken?: string; baseUrl?: string; fetch?: FetchLike; timeoutMs?: number } = {}) {
    this.base = (opts.baseUrl ?? "https://exp.host/--/api/v2/push").replace(/\/$/, "");
    this.token = opts.accessToken || undefined;
    this.fetchFn = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  private async post(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.base}${path}`, {
        method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: ctl.signal,
      });
      let json: unknown = null;
      try { json = await res.json(); } catch { /* an HTML error page */ }
      return { ok: res.ok, status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  async send(messages: PushMessage[]): Promise<Ticket[]> {
    const out: Ticket[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const r = await this.post("/send", chunk);
        const data = (r.json as { data?: unknown })?.data;
        if (!r.ok || !Array.isArray(data)) {
          out.push(...chunk.map(() => ({ status: "error" as const, error: `http_${r.status}` })));
          continue;
        }
        for (let j = 0; j < chunk.length; j++) {
          const t = data[j] as { status?: string; id?: string; details?: { error?: string } } | undefined;
          out.push(t?.status === "ok"
            ? { status: "ok", id: typeof t.id === "string" ? t.id : undefined }
            : { status: "error", error: t?.details?.error ?? "unknown" });
        }
      } catch (e) {
        out.push(...chunk.map(() => ({ status: "error" as const, error: (e as Error)?.name === "AbortError" ? "timeout" : "network" })));
      }
    }
    return out;
  }

  async receipts(ids: string[]): Promise<Record<string, Receipt>> {
    const out: Record<string, Receipt> = {};
    for (let i = 0; i < ids.length; i += 1000) {
      try {
        const r = await this.post("/getReceipts", { ids: ids.slice(i, i + 1000) });
        const data = (r.json as { data?: Record<string, { status?: string; details?: { error?: string } }> })?.data;
        if (!r.ok || !data || typeof data !== "object") continue;
        for (const [id, v] of Object.entries(data)) {
          out[id] = v?.status === "ok" ? { status: "ok" } : { status: "error", error: v?.details?.error ?? "unknown" };
        }
      } catch { /* asked again on the next pass */ }
    }
    return out;
  }
}
