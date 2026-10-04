// Electron preload API (apps/overlay/src/preload.cjs). In a plain browser tab these fall back to no-ops / window.open,
// so overlay.html can also be opened directly at http://localhost:5174/overlay.html for debugging.
interface OverlayBridge {
  setInteractive(on: boolean, focus?: boolean): void;
  openExternal(url: string): void;
}

const native = (window as unknown as { fetchOverlay?: OverlayBridge }).fetchOverlay;

let current: boolean | undefined;
export const bridge = {
  inElectron: !!native,
  /** Mouse capture on/off (deduped). focus: true takes keyboard focus for typing, false releases it. */
  setInteractive(on: boolean, focus?: boolean) {
    if (on === current && focus === undefined) return;
    current = on;
    native?.setInteractive(on, focus);
  },
  openExternal(url: string) {
    if (!/^https:\/\//i.test(url)) return;
    if (native) native.openExternal(url); else window.open(url, '_blank', 'noopener');
  },
};

/** API base: ?api=... overrides the Vercel build-time backend URL. */
const env = (import.meta as ImportMeta & { env?: { VITE_FETCH_API_URL?: string } }).env;
export const API = (new URLSearchParams(location.search).get('api') ?? env?.VITE_FETCH_API_URL ?? '').replace(/\/$/, '');

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const r = await fetch(API + path, {
    credentials: 'include',
    ...rest,
    headers: json === undefined ? rest.headers : { 'content-type': 'application/json', ...rest.headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const body = r.status === 204 ? undefined : await r.json().catch(() => undefined);
  if (!r.ok) {
    const b = (body ?? {}) as { error?: string; code?: string; message?: string };
    throw new ApiError(r.status, b.error ?? b.code ?? `http_${r.status}`, b.message ?? '', body);
  }
  return body as T;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly body: unknown) { super(message || code); }
}
