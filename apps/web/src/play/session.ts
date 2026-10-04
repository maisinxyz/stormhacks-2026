import type { PetBundle } from '@fetch/contracts';
import type { PetSession } from './types';

const placeholder: PetBundle = { id: 'placeholder-dog', name: 'Pip', species: 'dog', splatUrl: '/bundles/dog/pet.splat', rigUrl: '/bundles/dog/rig.json', weightsUrl: '/bundles/dog/weights.bin', thumbnailUrl: '', personality: { eager: .85, sassy: .2, anxious: .15, chatty: .3 }, stats: { energy: 82, happiness: 88, hunger: 20 }, createdAt: new Date().toISOString() };

export async function loadPetSession(id?: string): Promise<{ session: PetSession; fallback: boolean }> {
  const species = id?.toLowerCase().includes('bird') ? 'bird' : 'dog';
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
