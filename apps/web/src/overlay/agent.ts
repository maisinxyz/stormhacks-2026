// Agent client for the overlay (PRD 2.6 / B1 contract): POST /agent/run, SSE run events forwarded to the engine,
// a compact approval card (Approve / Cancel, or Connect for "connect this app" links), and a tiny run chip.
import type { RunEvent } from '@fetch/contracts';
import type { Engine } from '../engine';
import { API, ApiError, api, bridge } from './bridge';

type Approval = Extract<RunEvent, { type: 'approval.required' }>;

const FRIENDLY: Record<string, string> = {
  mode_forbidden: "I'm in Play mode, switch to Work mode to give me tasks.",
  rate_limited: 'Phew, too many tasks. Give me a minute!',
  auth_required: 'Sign in on the desk first.',
  not_connected_yet: 'Finish signing in with the link first.',
  approval_expired: 'That approval expired.',
  content_hash_mismatch: 'That draft changed, take another look.',
  approval_not_pending: 'Already handled!',
};
const friendly = (e: unknown) => e instanceof ApiError ? FRIENDLY[e.code] ?? (e.message || 'Something went wrong.') : "I can't reach the server right now.";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};

export class AgentClient {
  private runId?: string;
  private es?: EventSource;
  private approval?: Approval;
  private busy = false;
  private readonly card = document.getElementById('approval') as HTMLDivElement;
  private readonly chip = document.getElementById('chip') as HTMLDivElement;
  private readonly chipText = document.getElementById('chip-text') as HTMLSpanElement;

  constructor(private engine: Engine, private petId: () => string | undefined, private say: (text: string, secs?: number) => void) {
    document.getElementById('chip-cancel')!.addEventListener('click', () => void this.cancel());
    engine.on('APPROVE', e => { if (this.approval && e.actionId === this.approval.actionId) void this.approve(); }); // pet-to-approve
  }

  get running() { return !!this.runId; }
  get approvalOpen() { return !this.card.hidden; }

  async start(text: string) {
    const petId = this.petId();
    if (!text.trim()) return;
    if (this.running) { this.say('Still busy with the last one!'); return; }
    if (!petId) { this.say('Make a pet on the desk first.'); return; }
    this.say('On it!', 2);
    try {
      const { runId } = await api<{ runId: string }>('/agent/run', { method: 'POST', json: { petId, text } });
      this.runId = runId;
      this.showChip('Starting...');
      this.subscribe(runId);
    } catch (e) { this.say(friendly(e), 5); }
  }

  /** SSE: unnamed data frames; EventSource retries with Last-Event-ID by itself. The server closes after a terminal event. */
  private subscribe(runId: string) {
    const es = this.es = new EventSource(`${API}/agent/runs/${encodeURIComponent(runId)}/events`, { withCredentials: true });
    es.onmessage = m => { try { this.handle(JSON.parse(m.data) as RunEvent); } catch (err) { console.warn('[overlay] bad run event', err); } };
    es.onerror = () => { if (es.readyState === EventSource.CLOSED && this.es === es) this.finish(); };
  }

  private handle(e: RunEvent) {
    const E = this.engine;
    // Any progress after an approval card means it was resolved (approved, or the app got connected).
    if (this.approval && e.type !== 'approval.required' && e.type !== 'run.say') this.closeApproval();
    switch (e.type) {
      case 'run.started': E.pushToolEvent(e); break;
      case 'run.plan': E.runPlan(e.steps); this.showChip(e.steps[0]?.label ?? 'Working...'); break;
      case 'tool.start': E.pushToolEvent(e); this.showChip(e.label); break;
      case 'tool.progress': E.pushToolEvent(e); this.showChip(e.note); break;
      case 'tool.retry': case 'tool.end': E.pushToolEvent(e); break;
      case 'run.say': this.say(e.text, 4); break;
      case 'approval.required': E.pushToolEvent(e); E.setApprovalPending(true); this.openApproval(e); break;
      case 'run.result': E.pushToolEvent(e); this.say(e.summary, 7); this.finish(); break; // engine routes run.result to showResult(prop, mood)
      case 'run.error': E.pushToolEvent(e); this.say(e.message || 'Oops, that went wrong.', 6); this.finish(); break;
      case 'run.cancelled': E.pushToolEvent(e); this.say('Okay, stopped.', 3); this.finish(); break;
    }
  }

  private finish() {
    this.es?.close(); this.es = undefined;
    this.runId = undefined;
    this.closeApproval();
    this.chip.hidden = true;
  }

  private showChip(text: string) { this.chipText.textContent = text; this.chip.hidden = false; }

  // ---- approval card ----
  private openApproval(a: Approval) {
    this.approval = a;
    const p = a.preview, link = a.kind === 'other' && /^https:\/\/\S+$/i.test(p.body?.trim() ?? '') ? p.body!.trim() : undefined;
    const meta = (k: string, v?: string) => v ? [el('div', { className: 'meta' }, el('b', {}, `${k}: `), v)] : [];
    const busyBtn = (b: HTMLButtonElement, fn: () => Promise<void>) => { b.onclick = async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } }; return b; };
    const cancel = busyBtn(el('button', { className: 'btn ghost', type: 'button', textContent: link ? 'Not now' : 'Cancel' }), () => this.cancel());
    const go = link
      ? el('button', { className: 'btn primary', type: 'button', textContent: 'Connect', onclick: () => { bridge.openExternal(link); this.showChip('Waiting for you to sign in...'); } })
      : busyBtn(el('button', { className: 'btn approve', type: 'button', textContent: 'Approve' }), () => this.approve());
    this.card.replaceChildren(
      el('h4', { textContent: p.summary || 'Okay to do this?' }),
      ...meta('To', p.to?.join(', ')),
      ...meta('Subject', p.subject),
      ...(p.body && !link ? [el('pre', { textContent: p.body })] : []),
      el('div', { className: 'row' }, cancel, go),
      el('div', { className: 'hint', textContent: link ? "I'll keep going as soon as you're connected." : 'Tip: stroke me to approve.' }),
    );
    this.card.hidden = false;
  }

  private closeApproval() {
    if (!this.approval && this.card.hidden) return;
    this.approval = undefined;
    this.card.hidden = true;
    this.engine.setApprovalPending(false);
  }

  async approve() {
    const a = this.approval, runId = this.runId;
    if (!a || !runId || this.busy) return;
    this.busy = true;
    try {
      await api(`/agent/runs/${encodeURIComponent(runId)}/approve`, { method: 'POST', json: { actionId: a.actionId, contentHash: a.contentHash } });
      if (this.approval === a) this.closeApproval();
    } catch (e) {
      this.say(friendly(e), 4);
      if (e instanceof ApiError && (e.code === 'approval_expired' || e.code === 'approval_not_pending')) this.closeApproval();
    } finally { this.busy = false; }
  }

  async cancel() {
    const runId = this.runId;
    if (!runId) return;
    try { await api(`/agent/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', json: {} }); }
    catch (e) { this.say(friendly(e), 4); }
    this.closeApproval(); // the server ends the run (run.result sheepish / run.cancelled), which closes the stream
  }
}
