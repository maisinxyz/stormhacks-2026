// Friendly copy for generatePet's progress stages and errors (PRD 2.3 step 5, 2.10).
// Drawing removed from frontend (F2 polish). Input is always a photo.
import type { Species } from '../contracts'

export type StageId = 'upload' | 'pose' | 'segment' | '3d' | 'fallback' | 'rig' | 'save'

export function stagePlan(): StageId[] {
  return ['upload', 'pose', 'segment', '3d', 'rig', 'save']
}

export function stageCopy(stage: string, ctx: { name: string; species: Species }): string {
  const pet = ctx.name || 'your pet'
  const copy: Record<string, string> = {
    upload: `Sending your photo to the studio`,
    pose: `Getting ${pet} to stand still for the sculptor`,
    segment: `Cutting ${pet} out of the background`,
    '3d': 'Sculpting your pet in 3D (about a minute)',
    fallback: `3D didn't work out, so we're making a flat ${ctx.species} instead`,
    rig: `Teaching ${pet} how to move`,
    save: `Saving ${pet} to your desk`,
  }
  return copy[stage] ?? 'Working on it'
}

export function stageLabel(stage: StageId): string {
  return { upload: 'Upload', pose: 'Stand up', segment: 'Cut out', '3d': '3D sculpt', fallback: 'Flat cutout', rig: 'Rig', save: 'Save' }[stage]
}

/** 7800 -> "2h 10m", 95 -> "2m", 20 -> "a moment" */
export function formatWait(seconds?: number): string {
  if (!seconds || seconds < 45) return 'a moment'
  const m = Math.round(seconds / 60), h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : `${m}m`
}

export interface FailureCopy { title: string; body: string }

export function errorCopy(code: string, retryAfter?: number): FailureCopy {
  if (code === 'gen_quota') return { title: 'The free 3D sculptor is resting', body: `We've used up today's free GPU time. Try again in ${formatWait(retryAfter)}.` }
  if (code === 'offline' || code === 'http_502' || code === 'http_504') return { title: "Can't reach the Fetch server", body: 'Start it with "pnpm dev" in apps/server, then try again.' }
  if (code === 'service_unavailable') return { title: "Pet creation isn't set up on this server", body: 'The 3D service is not configured. Ask whoever runs the server, then try again.' }
  if (code === 'rate_limited' || code === 'http_429') return { title: 'Too many pets at once', body: 'Give it a moment and try again.' }
  if (code === 'auth_required' || code === 'http_401') return { title: 'Please sign in first', body: 'Your session expired. Reload the page and try again.' }
  if (code.startsWith('validation') || code === 'http_400' || code === 'http_413' || code === 'http_415') return { title: "We couldn't use that image", body: 'Try a clear JPG, PNG or WebP under 10 MB with the whole pet in view.' }
  return { title: 'Something went wrong making your pet', body: 'Nothing was saved. Try again in a moment.' }
}

/** Why the 3D path fell back to the flat cutout. */
export function fallbackReason(code?: string): string {
  if (code === 'gen_low_quality') return "The 3D model came out too thin or patchy to animate well."
  if (code === 'gen_timeout') return 'The 3D sculptor took too long.'
  if (code === 'gen_interrupted') return 'The server restarted while sculpting.'
  return 'The 3D sculptor had trouble with this picture.'
}
