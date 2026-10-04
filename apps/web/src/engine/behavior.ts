// PRD 1.6 behavior state machine + 1.5 verb playback.
// States: idle -> listening -> errand(exit -> working -> return) -> sleep, plus play (and short-lived intent/reaction/approval).
// Each state is a generator "routine"; yielding a function means "call me each frame until I return true".
import type { ActionStep, BusEvent, LocalIntent, Mode, Mood, RunEvent, Verb } from '@fetch/contracts';
import { Animator, applyMood, MOODS, type Pose } from './anim';
import type { Prop } from './props';
import type { ParticleKind, SpeciesPack } from './species';

export type State = 'idle' | 'listening' | 'exit' | 'working' | 'return' | 'approval' | 'sleep' | 'play' | 'intent' | 'reaction';

export interface BehaviorHost {
  bounds(): { xmin: number; xmax: number };
  platformSpots(): { id: string; x: number; y: number }[]; // world-space perch points, from setPlatforms
  setVisible(v: boolean): void;
  emit(e: BusEvent): void;
  burst(kind: ParticleKind, x: number, y: number): void;
  setCarry(p?: Prop): void;
  setWorldProp(p?: Prop, x?: number, y?: number): void;
  peek(e: RunEvent): void; // edge-peek scene hook (1.9)
}

type Step = (dt: number) => boolean;
type Routine = Generator<Step, void, void>;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Behavior {
  state: State = 'idle';
  mode: Mode = 'work';
  mood: Mood = 'neutral';
  x = 0; y = 0;
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
  private animId = 0;

  constructor(private pack: SpeciesPack, private host: BehaviorHost) {
    this.start(this.idle(), 'idle');
  }

  // ---------- public inputs ----------
  setMode(m: Mode) { this.mode = m; if (this.state === 'idle' || this.state === 'play') this.start(this.idle(), m === 'play' ? 'play' : 'idle'); }
  setListening(on: boolean) {
    this.listening = on;
    if (on && (this.state === 'idle' || this.state === 'play')) this.start(this.listen(), 'listening');
  }

  doIntent(i: LocalIntent) {
    if (this.state === 'exit' || this.state === 'working' || this.state === 'return') return; // never interrupt an errand
    const name = this.pack.intents[i];
    if (!name) return;
    const id = `intent-${++this.animId}`;
    if (i === 'sleep') { this.start(this.sleepRoutine(), 'sleep'); return; }
    if (i === 'stop' || i === 'wake') { this.start(this.idle(), this.mode === 'play' ? 'play' : 'idle'); return; }
    if (i === 'come') { this.start(this.come(id), 'intent'); return; }
    this.start(this.intent(name, id, i === 'sit' || i === 'stay' || i === 'play_dead' || i === 'hide'), 'intent');
  }

  react(kind: 'pet' | 'poke' | 'feed') {
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
  update(dt: number): { pose: Pose; x: number; y: number; yaw: number } {
    for (let guard = 0; guard < 8; guard++) {
      if (!this.step) {
        const n = this.routine?.next();
        if (!n || n.done) { this.routine = undefined; this.onRoutineEnd(); if (!this.routine) break; continue; }
        this.step = n.value;
      }
      if (this.step(dt)) this.step = undefined; else break;
    }
    const mood = MOODS[this.mood];
    const pose = applyMood(this.anim.update(dt * mood.speed * this.speedBias), this.mood);
    // face travel direction; idle poses are 3/4 view toward the camera
    const target = this.moving ? this.dir * Math.PI / 2 : this.dir * 0.7;
    this.yaw += (target - this.yaw) * Math.min(1, dt * 8);
    this.moving = false;
    this.y += ((this.targetY - this.y)) * Math.min(1, dt * 10);
    return { pose, x: this.x, y: this.y + (pose.y ?? 0), yaw: this.yaw + (pose.yaw ?? 0) };
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

  /** Walk/run to world x (y stays); `fast` uses the run clip. */
  private *walkTo(x: number, fast = false): Routine {
    const name = fast ? this.pack.locomotion.run : this.pack.locomotion.walk, c = this.pack.clips[name];
    this.playClip(name);
    const spd = (c.move ?? 0.7) * MOODS[this.mood].speed;
    yield dt => {
      const d = x - this.x;
      this.dir = d >= 0 ? 1 : -1;
      this.moving = true;
      this.x += Math.sign(d) * Math.min(Math.abs(d), spd * dt);
      return Math.abs(x - this.x) < 0.02;
    };
  }

  private *hopTo(y: number): Routine {
    this.targetY = y;
    this.playClip(this.pack.verbs.SUCCEED.clips[0]);
    yield* this.wait(0.5);
  }

  private *idle(): Routine {
    this.targetY = 0; // y eases back down via update
    this.mood = 'neutral';
    while (true) {
      if (this.listening) { yield* this.listen(); }
      const { xmin, xmax } = this.host.bounds();
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
        yield* this.walkTo(rand(xmin + 0.5, xmax - 0.5), this.mode === 'play' && Math.random() < 0.4);
        yield* this.play(this.pick(this.pack.idleList), rand(1.5, 3));
      } else {
        yield* this.play(this.pick(this.pack.idleList), rand(3, 6));
      }
    }
  }

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

  private *sleepRoutine(): Routine {
    this.mood = 'sleepy';
    this.playClip('sleep');
    yield () => false; // wake/stop/intent starts a new routine
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
    this.mood = 'neutral';
  }
}
