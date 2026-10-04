// PRD 1.6 behavior state machine + 1.5 verb playback.
// States: idle -> listening -> errand(exit -> working -> return) -> sleep, plus play (and short-lived intent/reaction/approval).
// Each state is a generator "routine"; yielding a function means "call me each frame until I return true".
import type { ActionStep, BusEvent, LocalIntent, Mode, Mood, RunEvent, Verb } from '@fetch/contracts';
import { Animator, applyMood, MOODS, type Pose } from './anim';
import type { Needs } from './needs';
import type { Prop } from './props';
import type { ParticleKind, SpeciesPack } from './species';

export type State = 'idle' | 'listening' | 'exit' | 'working' | 'return' | 'approval' | 'sleep' | 'play' | 'intent' | 'reaction';

export interface FurnitureSpot { id: 'bed' | 'bowl' | 'rug' | 'window' | 'toybin'; position: { x: number; z: number }; heading: number; kind: 'sleep' | 'eat' | 'play' | 'watch' | 'fetch'; clip: string; weight: (stats: Needs['stats'], mood: Mood, mode: Mode) => number; }

export interface BehaviorHost {
  bounds(): { xmin: number; xmax: number; zmin?: number; zmax?: number };
  platformSpots(): { id: string; x: number; y: number }[]; // world-space perch points, from setPlatforms
  furnitureSpots?(): FurnitureSpot[];
  setVisible(v: boolean): void;
  emit(e: BusEvent): void;
  burst(kind: ParticleKind, x: number, y: number): void;
  setCarry(p?: Prop): void;
  setWorldProp(p?: Prop, x?: number, y?: number): void;
  peek(e: RunEvent): void; // edge-peek scene hook (1.9)
  ball(): { x: number; y: number; resting: boolean; held: boolean } | undefined;
  takeBall(): void;              // pet picked it up (shown as the carry prop)
  dropBall(x: number, y: number): void;
}

type Step = (dt: number) => boolean;
type Routine = Generator<Step, void, void>;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Behavior {
  state: State = 'idle';
  mode: Mode = 'work';
  mood: Mood = 'neutral';
  x = 0; y = 0; z = 0;
  private dir = 1;
  private yaw = 0.6;
  private anim = new Animator();
  private routine?: Routine;
  private step?: Step;
  private runId = '';
  private plan: ActionStep[] = [];
  private stepIdx = 0;
  private approvalPending = false;
  private listening = false;
  private fast = false;
  private cursor?: { x: number; y: number; t: number };
  private animId = 0;
  private spot?: { id: FurnitureSpot['id']; until: number };
  /** false = command-only (camera view): never walks or changes pose by itself, and held poses last until the next command. */
  private autonomous = true;

  constructor(private pack: SpeciesPack, private host: BehaviorHost, private needs: Needs) {
    this.start(this.idle(), 'idle');
  }

  // ---------- public inputs ----------
  setMode(m: Mode) { this.mode = m; if (this.state === 'idle' || this.state === 'play') this.start(this.idle(), m === 'play' ? 'play' : 'idle'); }
  /** Turn the idle pose toward +x (1) or -x (-1). Applied now, and again when a walk in progress arrives (walking faces the way it travels). */
  face(sign: 1 | -1) { this.dir = this.arriveDir = sign; }
  private arriveDir?: 1 | -1;
  setAutonomous(on: boolean) { this.autonomous = on; if (this.state === 'idle' || this.state === 'play') this.start(this.idle(), this.state); }
  setListening(on: boolean) {
    this.listening = on;
    if (on && (this.state === 'idle' || this.state === 'play')) this.start(this.listen(), 'listening');
  }

  doIntent(i: LocalIntent) {
    if (this.state === 'exit' || this.state === 'working' || this.state === 'return') return; // never interrupt an errand
    const name = this.pack.intents[i];
    if (!name) return;
    const id = `intent-${++this.animId}`;
    if (i === 'sleep') { this.start(this.sleepRoutine(false), 'sleep'); return; }
    if (i === 'stop' || i === 'wake') { this.start(this.idle(), this.mode === 'play' ? 'play' : 'idle'); return; }
    if (i === 'come') { this.start(this.come(id), 'intent'); return; }
    this.start(this.intent(name, id, i === 'sit' || i === 'stay' || i === 'play_dead' || i === 'hide'), 'intent');
  }

  react(kind: 'pet' | 'poke' | 'feed' | 'tap') {
    if (kind === 'pet' && this.state === 'reaction') return; // stroke events repeat; don't restart the clip
    if (kind === 'tap') { this.needs.petted(1, 0.3); kind = 'pet'; } // friendly tap: happiness bump + the species' petting reaction
    if (this.state === 'exit' || this.state === 'working' || this.state === 'return' || this.state === 'approval') return;
    this.start(this.reaction(this.pack.reactions[kind]), 'reaction');
  }

  runPlan(steps: ActionStep[]) {
    this.plan = steps; this.stepIdx = 0;
    if (this.state === 'exit' || this.state === 'working') return; // re-plan mid-run: keep working, just update steps
    this.setProp(undefined);
    this.start(this.exitRoutine(), 'exit'); // exit starts on run.plan, never waits for tool results
  }

  pushToolEvent(e: RunEvent) {
    switch (e.type) {
      case 'run.started': this.runId = e.runId; break;
      case 'run.plan': this.runPlan(e.steps); break;
      case 'tool.start': {
        const i = this.plan.findIndex(s => s.id === e.stepId);
        if (i >= 0) this.stepIdx = i;
        this.host.peek(e);
        break;
      }
      case 'tool.progress': case 'tool.retry': case 'tool.end': this.host.peek(e); break;
      case 'approval.required': this.returnWith({ prop: { kind: 'preset', name: 'envelope' }, mood: 'eager' }, true); break;
      case 'run.result': this.returnWith({ prop: e.prop, mood: e.mood }); break;
      case 'run.error': this.returnWith({ mood: e.mood, error: true }); break;
      case 'run.cancelled': this.returnWith({ mood: 'neutral' }); break;
    }
  }

  showResult(prop: Prop | undefined, mood: Mood) { this.returnWith({ prop, mood }); }

  setApprovalPending(p: boolean) {
    this.approvalPending = p;
    if (!p && this.state === 'approval') { this.setProp(undefined); this.start(this.idle(), this.mode === 'play' ? 'play' : 'idle'); }
  }

  get currentStep(): ActionStep | undefined { return this.plan[this.stepIdx]; }

  /** Play a verb (composed animation) on the visible pet — used by the peek scene and for previews. */
  previewVerb(v: Verb, mood: Mood = 'neutral', secs = 3, prop?: Prop) {
    this.mood = mood;
    this.start(this.verb(v, mood, secs, prop), 'intent');
  }

  // ---------- frame update ----------
  update(dt: number): { pose: Pose; x: number; y: number; z: number; yaw: number } {
    for (let guard = 0; guard < 8; guard++) {
      if (!this.step) {
        const n = this.routine?.next();
        if (!n || n.done) { this.routine = undefined; this.onRoutineEnd(); if (!this.routine) break; continue; }
        this.step = n.value;
      }
      if (this.step(dt)) this.step = undefined; else break;
    }
    this.needs.tick(dt, this.state === 'sleep' ? 'sleep' : this.moving ? (this.fast ? 'run' : 'walk') : 'rest');
    const mood = MOODS[this.mood];
    const pose = applyMood(this.anim.update(dt * mood.speed * this.speedBias), this.mood);
    // face travel direction; idle poses are 3/4 view toward the camera
    const target = this.moving ? this.dir * Math.PI / 2 : this.dir * 0.7;
    this.yaw += (target - this.yaw) * Math.min(1, dt * 8);
    this.moving = false;
    this.y += ((this.targetY - this.y)) * Math.min(1, dt * 10);
    return { pose, x: this.x, y: this.y + (pose.y ?? 0), z: this.z, yaw: this.yaw + (pose.yaw ?? 0) };
  }

  // ---------- internals ----------
  private targetY = 0;
  private moving = false;
  private speedBias = 1;

  private start(r: Routine, s: State) {
    this.routine = r; this.step = undefined; this.state = s; this.speedBias = 1;
    this.host.setVisible(true);
    if (s !== 'return' && s !== 'approval') { this.setProp(undefined); this.host.setWorldProp(undefined); } // drop props from an interrupted routine
  }

  private onRoutineEnd() {
    // routines that fall off the end return to idle (or hold: working/approval never end by themselves)
    this.start(this.idle(), this.mode === 'play' ? 'play' : 'idle');
  }

  private setProp(p?: Prop) { this.host.setCarry(p); }

  private playClip(name: string, speed = 1) { this.anim.play(this.pack.clips[name] ?? this.pack.clips.stand, speed); }

  private *wait(secs: number): Routine { let t = 0; yield dt => (t += dt) >= secs; }

  private *play(name: string, secs?: number, speed = 1): Routine {
    const c = this.pack.clips[name] ?? this.pack.clips.stand;
    this.playClip(name, speed);
    yield* this.wait(secs ?? c.dur / speed);
  }

  /** Walk/run to a floor point. The boolean overload preserves the desk's old 1-D calls. */
  private *walkTo(x: number, zOrFast: number | boolean = this.z, fastArg = false): Routine {
    const targetZ = typeof zOrFast === 'number' ? zOrFast : this.z;
    const fast = typeof zOrFast === 'boolean' ? zOrFast : fastArg;
    const name = fast ? this.pack.locomotion.run : this.pack.locomotion.walk, c = this.pack.clips[name];
    this.playClip(name);
    this.fast = fast;
    const spd = (c.move ?? 0.7) * MOODS[this.mood].speed;
    yield dt => {
      const dx = x - this.x, dz = targetZ - this.z, distance = Math.hypot(dx, dz);
      this.dir = dx >= 0 ? 1 : -1;
      this.moving = true;
      if (distance > 0.001) { const step = Math.min(distance, spd * dt); this.x += dx / distance * step; this.z += dz / distance * step; this.yaw += (Math.atan2(dx, dz) - this.yaw) * Math.min(1, dt * 8); }
      return Math.hypot(x - this.x, targetZ - this.z) < 0.02;
    };
  }

  private *hopTo(y: number): Routine {
    this.targetY = y;
    this.playClip(this.pack.verbs.SUCCEED.clips[0]);
    yield* this.wait(0.5);
  }

  private *idle(): Routine {
    this.targetY = 0; // y eases back down via update
    while (true) {
      this.mood = this.base();
      if (this.listening) { yield* this.listen(); }
      if (!this.autonomous) { yield* this.play('stand', rand(3, 6)); continue; } // breathing + tail only, stays put
      // zero energy auto-naps, only here (idle) so errands are never affected
      if (this.needs.stats.energy <= 0) { yield* this.sleepRoutine(true); continue; }
      if (this.needs.stats.energy < 25 && Math.random() < 0.4) { yield* this.play('yawn', undefined); continue; }
      if (this.mode === 'play' && this.cursor && performance.now() - this.cursor.t < 3000 && (this.pack.id === 'cat' || this.pack.id === 'bird')) { yield* this.chaseCursor(); continue; }
      const { xmin, xmax, zmin = 0, zmax = 0 } = this.host.bounds();
      const furniture = this.host.furnitureSpots?.() ?? [];
      if (furniture.length) {
        const now = performance.now();
        let chosen = furniture.find(s => s.id === this.spot?.id && now < (this.spot?.until ?? 0));
        if (!chosen) {
          const ranked = furniture.map(s => ({ s, score: s.weight(this.needs.stats, this.mood, this.mode) + Math.random() * .2 })).sort((a, b) => b.score - a.score);
          chosen = ranked[0]?.s;
          if (chosen) this.spot = { id: chosen.id, until: now + rand(6000, 15000) };
        }
        if (chosen && Math.random() < .8) {
          yield* this.walkTo(chosen.position.x, chosen.position.z, this.mode === 'play' && chosen.kind === 'play');
          this.host.emit({ type: 'PET_AT_PLATFORM', platformId: chosen.id });
          yield* this.play(chosen.clip, Math.max(2, (this.spot?.until ?? now + 6000) - performance.now()) / 1000);
          if (chosen.kind === 'eat') this.needs.fed();
          if (chosen.kind === 'play') this.needs.played(3);
          continue;
        }
      }
      const spots = this.host.platformSpots();
      if (this.mode === 'work' && spots.length && Math.random() < 0.55) {
        // Work-mode idle: perch / watch near the Desk
        const s = spots[Math.floor(Math.random() * spots.length)];
        yield* this.walkTo(s.x);
        yield* this.hopTo(s.y);
        this.host.emit({ type: 'PET_AT_PLATFORM', platformId: s.id });
        yield* this.play(this.pick(this.pack.workIdle), rand(4, 8));
        yield* this.hopTo(0);
      } else if (this.mode === 'play' || Math.random() < 0.3) {
        // Play-mode idle roams
        const targetZ = zmax > zmin ? rand(zmin + 0.5, zmax - 0.5) : 0;
        yield* this.walkTo(rand(xmin + 0.5, xmax - 0.5), targetZ, this.mode === 'play' && Math.random() < 0.4);
        yield* this.play(this.pick(this.pack.idleList), rand(1.5, 3));
      } else {
        yield* this.play(this.pick(this.pack.idleList), rand(3, 6));
      }
    }
  }

  private base(): Mood { return this.needs.mood; }

  private pick(l: string[]) { return l[Math.floor(Math.random() * l.length)]; }

  private *listen(): Routine {
    this.state = 'listening';
    this.playClip(this.pack.listenClip);
    yield () => !this.listening;
    this.state = this.mode === 'play' ? 'play' : 'idle';
  }

  private *intent(name: string, id: string, hold: boolean): Routine {
    this.playClip(name);
    const c = this.pack.clips[name];
    if (hold && !this.autonomous) { yield () => false; return; } // sit/stay: held until the next command starts a routine
    yield* this.wait(hold ? 3 : c.dur * (c.loop ? 2 : 1));
    this.host.emit({ type: 'ANIM_DONE', id });
  }

  private *come(id: string): Routine {
    yield* this.walkTo(0, true); // "come" = run to the center of the stage
    yield* this.play(this.pack.reactions.feed, 1);
    this.host.emit({ type: 'ANIM_DONE', id });
  }

  private *reaction(name: string): Routine {
    const c = this.pack.clips[name];
    this.playClip(name);
    yield* this.wait(c.loop ? 1.5 : c.dur);
  }

  private *sleepRoutine(auto = false): Routine {
    const prev = this.state;
    this.state = 'sleep';
    this.mood = 'sleepy';
    this.playClip('sleep');
    // manual sleep: until wake/stop/intent starts a new routine; auto-nap: until rested
    yield () => auto && this.needs.stats.energy >= 60;
    this.state = prev === 'sleep' ? 'idle' : prev;
  }

  // 1.5: compose base clips for a verb; mood scales pace via the animator; prop on carry socket or as a world billboard.
  private *verb(v: Verb, mood: Mood, secs: number, prop?: Prop): Routine {
    const va = this.pack.verbs[v];
    this.mood = mood;
    if (va.particle) this.host.burst(va.particle, this.x, this.y + 0.3);
    if (prop && va.prop === 'carry') this.setProp(prop);
    if (prop && va.prop === 'world') this.host.setWorldProp(prop, this.x + this.dir * 0.4, this.y + 0.25);
    const per = secs / va.clips.length;
    for (const cn of va.clips) {
      const c = this.pack.clips[cn] ?? this.pack.clips.stand;
      this.playClip(cn, va.speed ?? 1);
      if (c.move) {
        const spd = c.move * MOODS[mood].speed, { xmin, xmax } = this.host.bounds();
        yield* (function* (self: Behavior): Routine {
          let t = 0;
          yield dt => {
            self.moving = true;
            self.x += self.dir * spd * dt;
            if (self.x > xmax - 0.4) self.dir = -1; else if (self.x < xmin + 0.4) self.dir = 1;
            return (t += dt) >= per;
          };
        })(this);
      } else yield* this.wait(per);
    }
    this.host.setWorldProp(undefined);
    if (va.prop === 'carry') this.setProp(undefined);
  }

  // ---------- errand ----------
  private *exitRoutine(): Routine {
    const { xmin, xmax } = this.host.bounds();
    const edge = this.x >= (xmin + xmax) / 2 ? xmax + 1.2 : xmin - 1.2;
    this.targetY = 0;
    this.host.burst(this.pack.exit.particle, this.x, 0.2);
    const first = this.plan[0];
    this.mood = first?.mood ?? 'eager';
    yield* this.walkTo(edge, true);
    this.host.setVisible(false);
    this.state = 'working';
    yield () => false; // off-canvas: the peek scene shows the work; return is triggered by run.result/error/approval
  }

  private returnWith(r: { prop?: Prop; mood: Mood; error?: boolean }, awaitApproval = false) {
    this.start(this.returnRoutine(r, awaitApproval), 'return');
  }

  private *returnRoutine(r: { prop?: Prop; mood: Mood; error?: boolean }, awaitApproval: boolean): Routine {
    const { xmin, xmax } = this.host.bounds();
    const from = Math.random() < 0.5 ? xmin - 1.2 : xmax + 1.2;
    this.x = from; this.dir = from < 0 ? 1 : -1; this.targetY = 0; this.y = 0;
    this.host.setVisible(true);
    this.host.burst(this.pack.enter.particle, this.x, 0.2);
    if (r.prop) this.setProp(r.prop);
    this.mood = r.mood;
    yield* this.walkTo(awaitApproval ? 0 : rand(-0.6, 0.6), true);
    if (awaitApproval) {
      this.state = 'approval';
      this.playClip(this.pack.listenClip);
      this.host.emit({ type: 'RETURNED', runId: this.runId });
      yield () => false; // stays until setApprovalPending(false) starts idle
      return;
    }
    // report outcome: SUCCEED/FAIL beat; prop dropped at your feet as a world billboard
    yield* this.verb(r.error ? 'FAIL' : 'SUCCEED', r.mood, 1.6);
    if (r.prop) { this.setProp(undefined); this.host.setWorldProp(r.prop, this.x + this.dir * 0.5, 0.15); }
    this.host.emit({ type: 'RETURNED', runId: this.runId });
    yield* this.wait(5);
    this.host.setWorldProp(undefined);
    this.mood = this.base();
  }

  // ---------- 1.8 interactions ----------
  setCursor(x: number, y: number) {
    const now = performance.now(), stale = !this.cursor || now - this.cursor.t >= 3000;
    this.cursor = { x, y, t: now };
    // cursor became active: restart idle so it notices (Play mode: laser dot / landing target)
    if (stale && this.mode === 'play' && this.state === 'play' && (this.pack.id === 'cat' || this.pack.id === 'bird')) this.start(this.idle(), 'play');
  }

  pointTo(x: number, z = this.z) {
    this.arriveDir = undefined;
    if (this.state === 'exit' || this.state === 'working' || this.state === 'return' || this.state === 'approval') return;
    this.start(this.pointRoutine(x, z), 'intent');
  }

  dragTo(x: number, z: number, drop = false) {
    if (this.state === 'exit' || this.state === 'working' || this.state === 'return' || this.state === 'approval') return;
    this.x = x; this.z = z; this.y = drop ? 0 : .12;
    if (drop) this.start(this.pointRoutine(x, z), 'intent');
  }

  private *pointRoutine(x: number, z = this.z): Routine {
    yield* this.walkTo(x, z, Math.hypot(x - this.x, z - this.z) > 1.5);
    if (this.arriveDir) this.dir = this.arriveDir;
    // dog/cat sniff or sit at the target; bird just settles
    yield* this.play(this.pack.id === 'bird' ? 'perch' : this.pick(['sniff', 'sit']), rand(1.5, 3));
  }

  /** THROW: the dog chases the ball, picks it up, and brings it back to centre stage. Others just look. */
  fetchBall() {
    if (this.state === 'exit' || this.state === 'working' || this.state === 'return' || this.state === 'approval') return;
    if (!this.pack.games.includes('ball_fetch')) { this.start(this.reaction(this.pack.listenClip), 'reaction'); return; }
    this.start(this.fetchRoutine(), 'play');
  }

  private *fetchRoutine(): Routine {
    this.mood = 'eager';
    const t0 = performance.now();
    this.playClip(this.pack.locomotion.run);
    this.fast = true;
    const spd = this.pack.clips[this.pack.locomotion.run].move! * MOODS.eager.speed;
    yield dt => {
      const b = this.host.ball();
      if (!b || performance.now() - t0 > 20000) return true;
      const d = b.x - this.x;
      this.dir = d >= 0 ? 1 : -1;
      if (!b.held && b.resting && Math.abs(d) < 0.2) return true;
      this.moving = true;
      this.x += Math.sign(d) * Math.min(Math.abs(d), spd * dt);
      return false;
    };
    const b = this.host.ball();
    if (!b || Math.abs(b.x - this.x) > 0.3) return; // gave up
    yield* this.play('dig', 0.4);
    this.host.takeBall();
    this.setProp({ kind: 'preset', name: 'ball' });
    this.needs.played(4);
    yield* this.walkTo(0, true);
    this.setProp(undefined);
    this.host.dropBall(this.x + this.dir * 0.35, 0.1);
    this.host.emit({ type: 'ANIM_DONE', id: 'fetch_ball' });
    yield* this.play('wag', 1.5);
  }

  snapshot() { return { x: this.x, z: this.z, heading: this.yaw, y: this.y, state: this.state }; }
  applySnapshot(s: { x: number; z: number; heading?: number; y?: number }) { this.x = s.x; this.z = s.z; this.yaw = s.heading ?? this.yaw; this.y = s.y ?? this.y; }

  /** Cat chases the laser dot; bird lands on the cursor target. */
  private *chaseCursor(): Routine {
    this.mood = 'eager';
    yield dt => {
      const c = this.cursor;
      if (!c || performance.now() - c.t > 3000 || this.mode !== 'play') return true;
      const d = c.x - this.x;
      this.dir = d >= 0 ? 1 : -1;
      if (Math.abs(d) < 0.12) {
        if (this.pack.id === 'bird') this.targetY = Math.max(0, c.y - 0.1); // land on the cursor
        if (this.anim.clip !== this.pack.clips[this.pack.id === 'cat' ? 'bat' : 'perch']) this.playClip(this.pack.id === 'cat' ? 'bat' : 'perch');
        return false;
      }
      const run = Math.abs(d) > 0.6, name = run ? this.pack.locomotion.run : this.pack.locomotion.walk, cl = this.pack.clips[name];
      if (this.anim.clip !== cl) this.playClip(name);
      this.fast = run; this.moving = true;
      this.targetY = this.pack.id === 'bird' ? Math.max(0, c.y - 0.1) : 0;
      this.x += Math.sign(d) * Math.min(Math.abs(d), (cl.move ?? 0.7) * MOODS.eager.speed * dt);
      return false;
    };
  }
}
