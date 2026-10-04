import type { PetBundle } from '@fetch/contracts';
import type { PetSession } from './types';
import { KNOWN_DOGS, knownBundle } from '../engine/sdf/known';

const env = (import.meta as ImportMeta & { env?: { VITE_FETCH_API_URL?: string } }).env;
const API_BASE = (env?.VITE_FETCH_API_URL ?? '').replace(/\/$/, '');

const placeholder: PetBundle = { id: 'placeholder-dog', name: 'Biscuit', species: 'dog', splatUrl: '/bundles/dog/pet.splat', rigUrl: '/bundles/dog/rig.json', weightsUrl: '/bundles/dog/weights.bin', thumbnailUrl: '', personality: { eager: .85, sassy: .2, anxious: .15, chatty: .3 }, stats: { energy: 82, happiness: 88, hunger: 20 }, createdAt: new Date().toISOString() };

const sessionFor = (bundle: PetBundle): PetSession => ({ bundle, position: { x: 0, z: 0 }, heading: 0, scale: .55, muted: false, quality: 'low', lastView: 'room' });

/** `id` is the Desk's active pet (?pet=...): a hard-coded pet ("known-dachshund" or just "dachshund"), or a pet saved on the server. */
export async function loadPetSession(id?: string, name?: string): Promise<{ session: PetSession; fallback: boolean }> {
  const key = id?.toLowerCase() ?? '';
  const known = KNOWN_DOGS.find(k => k.id === key.replace(/^known-/, ''));
  if (known) return { session: sessionFor(knownBundle(known, name || known.name)), fallback: false };
  if (id && !/^(plush|default-plush|golden|splat)/.test(key)) { // a generated pet: ask the server for it (same list the Desk shows)
    try {
      const r = await fetch(`${API_BASE}/pets`, { credentials: 'include' });
      const pet = r.ok ? (await r.json() as PetBundle[]).find(p => p.id === id) : undefined;
      if (pet) return { session: sessionFor(pet), fallback: false };
    } catch { /* server not running: fall through to the default pet */ }
  }
  const species = key.includes('golden') || key.includes('splat') ? 'dog' : 'plush'; // default: the plush dog, before any photo is uploaded
  try {
    const response = await fetch(`/bundles/${species}/bundle.json`);
    if (!response.ok) throw new Error('bundle unavailable');
    const bundle = await response.json() as PetBundle;
    return { session: { bundle, position: { x: 0, z: 0 }, heading: 0, scale: .55, muted: false, quality: 'low', lastView: 'room' }, fallback: false };
  } catch {
    return { session: { bundle: placeholder, position: { x: 0, z: 0 }, heading: 0, scale: .55, muted: false, quality: 'low', lastView: 'room' }, fallback: true };
  }
}

export function snapshotEngine(session: PetSession, engine: { getPetState(): { x: number; z: number; heading: number } }): PetSession { const state = engine.getPetState(); return { ...session, position: { x: state.x, z: state.z }, heading: state.heading }; }
