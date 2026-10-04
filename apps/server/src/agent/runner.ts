// Agent run loop (PRD B1.3). Turns brain decisions into RunEvents, enforces approvals (B1.4)
// and mode (B1.5), and treats every tool output as untrusted data.
import { randomBytes } from 'node:crypto';
import type { ActionStep, Mood } from '@fetch/contracts';
import { connectorsFor } from '../connectors';
import { ConnectorError } from '../connectors/types';
import { ApprovalGate, contentHash } from './approvals';
import { FINISH_TOOL, FinishInput, PLAN_TOOL, PlanInput, type Brain, type ToolCall, type ToolResultMsg } from './brain';
import type { B1Context } from './context';
import type { RunHub } from './hub';
import { DEFAULT_PROP, PRESET_PROPS, TOOL_BY_API_NAME, type ToolDef } from './tools';
import type { Approval, Run, RunEvent, User } from './types';

export const newId = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`;
const MAX_SAY_WORDS = 15;
const RETRIES = 2;

/** At most 15 words, for TTS (PRD 0.5 run.say). */
export const clampSay = (s: string) => {
  const words = s.trim().split(/\s+/).filter(Boolean);
  return words.length <= MAX_SAY_WORDS ? words.join(' ') : `${words.slice(0, MAX_SAY_WORDS).join(' ').replace(/[,;:.!?]*$/, '')}…`;
};

/** Delimits tool output so the model treats it as data, never instructions (PRD B1.3). */
export function untrusted(source: string, data: unknown): string {
  const json = JSON.stringify(data, null, 1).replace(/<(\/?)untrusted_data/gi, '&lt;$1untrusted_data');
  return `<untrusted_data source="${source}">\n${json}\n</untrusted_data>`;
}

class RunEnded extends Error {}
/** Background writes must never become unhandled rejections (Node would exit). */
const logError = (err: unknown) => console.error(JSON.stringify({ level: 'error', b1: 'run', err: String((err as Error)?.stack ?? err) }));
class StepLimit extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ConnectorError('timeout', `Timed out after ${ms}ms`, true)), ms);
    const onAbort = () => reject(new RunEnded());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); });
  });
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class AgentRunner {
  private active = new Map<string, AbortController>();

  constructor(private ctx: B1Context, private hub: RunHub, readonly gate: ApprovalGate, private brain: Brain) {}

  async start(user: User, petId: string, text: string): Promise<Run> {
    const now = new Date().toISOString();
    const run: Run = { id: newId('run'), userId: user.id, petId, text, status: 'running', steps: [], createdAt: now, updatedAt: now };
    await this.ctx.store.createRun(run);
    await this.ctx.store.setUserState(user.id, { activePetId: petId });
    const abort = new AbortController();
    this.active.set(run.id, abort);
    void new RunExecution(this.ctx, this.hub, this.gate, this.brain, run, user, abort.signal)
      .execute()
      .catch(logError)
      .finally(() => this.active.delete(run.id));
    return run;
  }

  /** Aborts an in-flight run. Returns false if it is not running here. */
  abort(runId: string): boolean {
    const a = this.active.get(runId);
    if (!a) return false;
    a.abort();
    return true;
  }

  isActive(runId: string) { return this.active.has(runId); }
}

class RunExecution {
  private steps: ActionStep[] = [];
  private planned = false;
  private toolCalls = 0;
  private ended = false;
  /** stepId -> requested non-preset prop, awaiting a generated sticker. */
  private wantedProps = new Map<string, string>();

  constructor(
    private ctx: B1Context, private hub: RunHub, private gate: ApprovalGate, private brain: Brain,
    private run: Run, private user: User, private signal: AbortSignal,
  ) {}

  private emit(e: RunEvent) { return this.hub.emit(this.run.id, e); }
  private log(msg: string, extra: Record<string, unknown> = {}) {
    console.log(JSON.stringify({ level: 'info', b1: 'run', runId: this.run.id, userId: this.user.id, msg, ...extra }));
  }

  private async end(status: Run['status'], e: RunEvent) {
    if (this.ended) return;
    this.ended = true;
    await this.ctx.store.updateRun(this.run.id, { status, steps: this.steps });
    await this.emit(e);
    this.log('run ended', { status, toolCalls: this.toolCalls });
  }

  async execute() {
    try {
      await this.emit({ type: 'run.started', runId: this.run.id });
      const pet = await this.ctx.pets.get(this.run.petId);
      const session = this.brain({ pet, text: this.run.text, user: this.user, now: new Date().toISOString() });
      let results: ToolResultMsg[] = [];

      for (;;) {
        if (this.signal.aborted) throw new RunEnded();
        const turn = await session.next(results, this.signal);
        if (this.signal.aborted) throw new RunEnded();
        results = [];

        // A plan always goes out before any tool runs (PRD B1.3 "planning first").
        for (const call of turn.calls.filter(c => c.name === PLAN_TOOL)) results.push(await this.handlePlan(call));
        const work = turn.calls.filter(c => c.name !== PLAN_TOOL && c.name !== FINISH_TOOL);
        if (!this.planned && work.length) await this.autoPlan(work);

        for (const call of work) results.push(await this.handleTool(call));

        const finish = turn.calls.find(c => c.name === FINISH_TOOL);
        if (finish) {
          const parsed = FinishInput.safeParse(finish.input);
          if (parsed.success) return await this.finish(parsed.data);
          results.push({ id: finish.id, isError: true, content: `Invalid finish input: ${parsed.error.message}` });
        }
        for (const c of turn.calls.filter(c => c.name === FINISH_TOOL && c !== finish)) results.push({ id: c.id, content: 'ignored' });

        if (turn.calls.length === 0) {
          return await this.finish({ summary: turn.text?.trim() || 'All done.', mood: 'proud' });
        }
      }
    } catch (err) {
      if (err instanceof RunEnded || this.signal.aborted) {
        return this.end('cancelled', { type: 'run.cancelled' });
      }
      if (err instanceof StepLimit) {
        return this.end('failed', { type: 'run.error', code: 'max_steps', message: 'That errand took too many steps, so I stopped.', mood: 'exhausted' });
      }
      if (err instanceof ConnectorError && err.code === 'mode_forbidden') {
        return this.end('failed', { type: 'run.error', code: 'mode_forbidden', message: 'It\'s playtime, so I put the errand down.', mood: 'sheepish' });
      }
      console.error(JSON.stringify({ level: 'error', b1: 'run', runId: this.run.id, err: String((err as Error)?.stack ?? err) }));
      const code = (err as { status?: number }).status ? 'agent_unavailable' : 'internal';
      return this.end('failed', { type: 'run.error', code, message: 'Something went wrong on my end. Try again?', mood: 'exhausted' });
    }
  }

  // ---- plan ---------------------------------------------------------------------------------

  private async handlePlan(call: ToolCall): Promise<ToolResultMsg> {
    const parsed = PlanInput.safeParse(call.input);
    if (!parsed.success) return { id: call.id, isError: true, content: `Invalid plan: ${parsed.error.message}` };
    const { steps, say } = parsed.data;
    const first = !this.planned;
    this.steps = steps.map((s, i) => this.makeStep(`s${i + 1}`, s.verb, s.label, s.mood ?? 'focused', s.prop));
    this.planned = true;
    await this.emitPlan();
    if (first && say) await this.emit({ type: 'run.say', text: clampSay(say) });
    this.resolveGeneratedProps();
    return {
      id: call.id,
      content: `Plan accepted. Pass the matching stepId with each tool call: ${this.steps.map(s => `${s.id} (${s.verb}: ${s.label})`).join('; ')}`,
    };
  }

  /** The brain called tools without planning first: derive the plan from the calls. */
  private async autoPlan(calls: ToolCall[]) {
    this.steps = calls.map((c, i) => {
      const def = TOOL_BY_API_NAME.get(c.name);
      const input = def?.input.safeParse(stripStepId(c.input));
      const verb = def && input?.success ? def.verb(input.data) : 'WAIT';
      const label = def && input?.success ? def.label(input.data) : 'Working on it';
      const step = this.makeStep(`s${i + 1}`, verb, label, 'focused');
      c.input = { ...c.input, stepId: step.id };
      return step;
    });
    this.planned = true;
    await this.emitPlan();
  }

  private makeStep(shortId: string, verb: ActionStep['verb'], label: string, mood: Mood, prop?: string): ActionStep {
    const step: ActionStep = { id: `${this.run.id}.${shortId}`, verb, mood, label };
    const preset = prop?.toLowerCase().trim();
    if (preset && (PRESET_PROPS as readonly string[]).includes(preset)) step.prop = { kind: 'preset', name: preset };
    else {
      const fallback = DEFAULT_PROP[verb];
      if (fallback) step.prop = { kind: 'preset', name: fallback };
      if (prop) this.wantedProps.set(step.id, prop);
    }
    return step;
  }

  private emitPlan() {
    const steps = structuredClone(this.steps);
    this.ctx.store.updateRun(this.run.id, { steps }).catch(logError);
    return this.emit({ type: 'run.plan', steps });
  }

  /** Non-preset props: plan goes out with a preset stand-in, then is revised once B2 returns a sticker. */
  private resolveGeneratedProps() {
    for (const [stepId, want] of this.wantedProps) {
      this.wantedProps.delete(stepId);
      const step = this.steps.find(s => s.id === stepId);
      if (!step) continue;
      this.ctx.media.generateProp(want).then(async ({ imageUrl }) => {
        if (!imageUrl || this.ended) return;
        step.prop = { kind: 'generated', name: want, imageUrl };
        await this.emitPlan();
      }).catch(() => { /* keep the preset stand-in */ });
    }
  }

  private findOrAddStep(stepId: unknown, def: ToolDef, input: unknown): ActionStep | Promise<ActionStep> {
    const id = typeof stepId === 'string' ? stepId : '';
    const step = this.steps.find(s => s.id === id || s.id.endsWith(`.${id}`));
    if (step) return step;
    const added = this.makeStep(`s${this.steps.length + 1}`, def.verb(input), def.label(input), 'focused');
    this.steps.push(added);
    return this.emitPlan().then(() => added);
  }

  // ---- tools --------------------------------------------------------------------------------

  private async handleTool(call: ToolCall): Promise<ToolResultMsg> {
    const def = TOOL_BY_API_NAME.get(call.name);
    if (!def) return { id: call.id, isError: true, content: `Unknown tool ${call.name}` };
    const parsed = def.input.safeParse(stripStepId(call.input));
    if (!parsed.success) return { id: call.id, isError: true, content: `Invalid input for ${def.name}: ${parsed.error.message}` };
    if (++this.toolCalls > this.ctx.config.maxSteps) throw new StepLimit();

    const input = parsed.data;
    const step = await this.findOrAddStep(call.input.stepId, def, input);
    step.toolCallId = call.id;

    let connectors;
    if (def.policy !== 'meta') {
      // Mode is re-checked on every connector call, so a mid-run switch to Play stops the errand.
      if ((await this.ctx.store.getUserState(this.user.id)).mode !== 'work') throw new ConnectorError('mode_forbidden', 'Play mode');
      try { connectors = await connectorsFor(this.ctx, this.user.id); }
      catch (err) {
        if (err instanceof ConnectorError) return { id: call.id, isError: true, content: err.message };
        throw err;
      }
    }

    await this.emit({ type: 'tool.start', stepId: step.id, tool: def.name, label: step.label });

    // Progress from an attempt that timed out (and was superseded or ended the run) is dropped.
    let currentAttempt = 0;
    const tctxFor = (attempt: number) => ({
      connectors: connectors!,
      progress: (note: string, itemsRead?: number) => {
        if (attempt !== currentAttempt || this.ended) return;
        this.emit({ type: 'tool.progress', stepId: step.id, note, ...(itemsRead !== undefined && { itemsRead }) }).catch(logError);
      },
    });

    let payload = input;
    let spec = def.approval?.(input);
    if (spec) {
      if (def.prepare) {
        try { payload = await withTimeout(def.prepare(input, tctxFor(-1)), this.ctx.config.toolTimeoutMs, this.signal); }
        catch (err) {
          if (err instanceof RunEnded || this.signal.aborted) throw new RunEnded();
          await this.emit({ type: 'tool.end', stepId: step.id, ok: false });
          return { id: call.id, isError: true, content: err instanceof ConnectorError ? `${err.code}: ${err.message}` : 'Lookup failed.' };
        }
        spec = def.approval!(payload)!;
      }
      const approved = await this.awaitApproval(step, def, payload, spec);
      if (!approved) throw new RunEnded('denied');   // run already ended with a sheepish result
      payload = approved.payload;
    }

    // Anything that needed approval runs exactly once: a timeout may still have delivered it.
    const attempts = def.policy === 'outbound' || spec ? 1 : RETRIES + 1;
    for (let attempt = 1; ; attempt++) {
      currentAttempt = attempt;
      try {
        const out = await withTimeout(def.run(payload, tctxFor(attempt)), this.ctx.config.toolTimeoutMs, this.signal);
        await this.emit({ type: 'tool.end', stepId: step.id, ok: true });
        if (out.undo) await this.ctx.store.recordUndo({ runId: this.run.id, tool: def.name, undo: out.undo, at: new Date().toISOString() });
        this.log('tool ok', { tool: def.name, attempt });
        return { id: call.id, content: untrusted(def.name, out.data) };
      } catch (err) {
        if (err instanceof RunEnded || this.signal.aborted) throw new RunEnded();
        const retryable = err instanceof ConnectorError && err.retryable;
        if (retryable && attempt < attempts) {
          await this.emit({ type: 'tool.retry', stepId: step.id, attempt: attempt + 1 });
          await sleep(300 * attempt);
          continue;
        }
        await this.emit({ type: 'tool.end', stepId: step.id, ok: false });
        this.log('tool failed', { tool: def.name, attempt, err: (err as Error).message });
        const msg = err instanceof ConnectorError ? `${err.code}: ${err.message}` : 'The tool failed unexpectedly.';
        return { id: call.id, isError: true, content: msg };
      }
    }
  }

  /** Stores the exact payload, emits approval.required, and pauses until a human decides. */
  private async awaitApproval(step: ActionStep, def: ToolDef, input: unknown, spec: NonNullable<ReturnType<NonNullable<ToolDef['approval']>>>) {
    const actionId = newId('act');
    const payload = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
    const now = Date.now();
    const approval: Approval = {
      actionId, runId: this.run.id, userId: this.user.id, stepId: step.id, tool: def.name, kind: spec.kind,
      payload, preview: spec.preview, contentHash: contentHash(this.run.id, actionId, def.name, payload),
      status: 'pending', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + this.ctx.config.approvalTtlMs).toISOString(),
    };
    await this.ctx.store.createApproval(approval);
    await this.ctx.store.updateRun(this.run.id, { status: 'awaiting_approval' });
    const waiting = this.gate.wait(this.run.id, actionId, this.ctx.config.approvalTtlMs, this.signal);
    await this.emit({ type: 'approval.required', actionId, kind: spec.kind, preview: spec.preview, contentHash: approval.contentHash });
    this.log('approval required', { tool: def.name, actionId });

    const d = await waiting;
    if (d.decision === 'approved') {
      const stored = await this.ctx.store.getApproval(d.actionId);
      if (stored && stored.runId === this.run.id && stored.status === 'approved') {
        await this.ctx.store.updateRun(this.run.id, { status: 'running' });
        this.log('approval granted', { actionId: d.actionId });
        // Execute the stored payload (re-validated), never anything the model regenerates.
        return { payload: def.input.parse(stored.payload) };
      }
    }
    // Close out whichever approval was pending (an edit may have replaced the original).
    await this.ctx.store.transitionApproval(d.actionId, 'pending', d.decision === 'expired' ? 'expired' : 'denied');
    await this.emit({ type: 'tool.end', stepId: step.id, ok: false });
    const why = d.decision === 'expired' ? 'The approval expired, so I didn\'t do it.' : 'Okay, I won\'t do that.';
    await this.emit({ type: 'run.say', text: clampSay(why) });
    await this.end('denied', { type: 'run.result', summary: `${why} Nothing was sent or changed.`, mood: 'sheepish' });
    return undefined;
  }

  // ---- finish -------------------------------------------------------------------------------

  private async finish(f: FinishInput) {
    if (f.say) await this.emit({ type: 'run.say', text: clampSay(f.say) });
    const prop = f.prop
      ? (PRESET_PROPS as readonly string[]).includes(f.prop.toLowerCase())
        ? { kind: 'preset' as const, name: f.prop.toLowerCase() }
        : await this.generatedProp(f.prop)
      : undefined;
    await this.end(f.mood === 'sheepish' || f.mood === 'exhausted' ? 'failed' : 'succeeded', {
      type: 'run.result', summary: f.summary, mood: f.mood, ...(f.card && { card: f.card }), ...(prop && { prop }),
    });
  }

  private async generatedProp(name: string): Promise<ActionStep['prop']> {
    try {
      const { imageUrl } = await Promise.race([
        this.ctx.media.generateProp(name),
        sleep(4000).then(() => ({ imageUrl: '' })),
      ]);
      if (imageUrl) return { kind: 'generated', name, imageUrl };
    } catch { /* fall through */ }
    return { kind: 'preset', name: 'box' };
  }
}

function stripStepId(input: Record<string, unknown>) {
  const { stepId: _s, ...rest } = input ?? {};
  return rest;
}
