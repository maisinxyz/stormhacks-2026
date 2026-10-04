// PRD 1.7: energy / happiness / hunger (0-100). Needs only colour mood, pace and posture.
// They never delay or block real task execution (the errand routines don't read them).
import type { Mood, PetBundle } from '@fetch/contracts';

export type Stats = PetBundle['stats'];
export type Activity = 'sleep' | 'rest' | 'walk' | 'run';

const clamp = (v: number) => Math.max(0, Math.min(100, v));

export class Needs {
  stats: Stats;
  private sent: Stats;

  /** onChange fires when any stat moves by >= 1 point since the last emission; F2 persists via PATCH /pets/:id. */
  constructor(stats: Stats, private onChange: (s: Stats) => void = () => {}) {
    this.stats = { ...stats };
    this.sent = { ...stats };
  }

  tick(dt: number, a: Activity) {
    const s = this.stats;
    s.energy = clamp(s.energy + dt * { sleep: 2, rest: -0.04, walk: -0.15, run: -0.5 }[a]); // activity drains, sleeping restores
    s.hunger = clamp(s.hunger + dt * 0.05);
    s.happiness = clamp(s.happiness - dt * (s.hunger > 80 ? 0.1 : 0.03));
    this.flush();
  }

  /** Petting raises happiness; `amount` is intensity (0..1) integrated over dt. */
  petted(intensity: number, dt: number) { this.stats.happiness = clamp(this.stats.happiness + intensity * dt * 8); this.flush(); }
  fed() { this.stats.hunger = 0; this.stats.happiness = clamp(this.stats.happiness + 5); this.flush(); }
  played(amount = 3) { this.stats.happiness = clamp(this.stats.happiness + amount); this.stats.energy = clamp(this.stats.energy - amount / 2); this.flush(); }

  get mood(): Mood {
    const s = this.stats;
    if (s.energy < 25) return 'sleepy';
    if (s.hunger > 80) return 'worried';
    if (s.happiness > 85) return 'eager';
    return 'neutral';
  }

  private flush() {
    const a = this.stats, b = this.sent;
    if (Math.abs(a.energy - b.energy) >= 1 || Math.abs(a.happiness - b.happiness) >= 1 || Math.abs(a.hunger - b.hunger) >= 1) {
      this.sent = { ...a };
      this.onChange({ ...a });
    }
  }
}
