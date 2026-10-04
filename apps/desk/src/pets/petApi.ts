// B1/B2 pet + session endpoints (proxied to the server by vite.config.ts in dev).
import type { PetBundle } from '../contracts'

const API_BASE = ((import.meta.env.VITE_FETCH_API_URL as string | undefined) ?? '').replace(/\/$/, '')
const apiUrl = (path: string) => `${API_BASE}${path}`

export interface ServerSession { userName?: string; activePetId: string | null; mock?: { agent?: boolean; connectors?: boolean } }

const opts: RequestInit = { credentials: 'include' }

async function ok(r: Response) {
  if (!r.ok) throw new Error(`${r.url} -> ${r.status}`)
  return r
}

export async function fetchSession(): Promise<ServerSession> {
  return (await ok(await fetch(apiUrl('/session'), opts))).json()
}

/** GET /pets; mockGen comes from the X-Fetch-Mock-Gen header B2 puts on every protected response. */
export async function listPets(): Promise<{ pets: PetBundle[]; mockGen: boolean }> {
  const r = await ok(await fetch(apiUrl('/pets'), opts))
  const flag = r.headers.get('x-fetch-mock-gen') ?? ''
  return { pets: await r.json(), mockGen: flag === '1' || flag === 'true' }
}

export async function setActivePet(activePetId: string | null) {
  await ok(await fetch(apiUrl('/session'), { ...opts, method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activePetId }) }))
}

export async function deletePet(id: string) {
  await ok(await fetch(apiUrl(`/pets/${encodeURIComponent(id)}`), { ...opts, method: 'DELETE' }))
}
