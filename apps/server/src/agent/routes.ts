// /agent/* (PRD B1.2): start, stream, approve, cancel.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/requireUser';
import { canonicalJson, contentHash, hashesEqual } from './approvals';
import type { B1Context } from './context';
import type { RunHub } from './hub';
import { newId, type AgentRunner } from './runner';
import { streamRun } from './sse';
import { TOOL_BY_NAME } from './tools';
import { TERMINAL_STATUSES, type Approval, type User } from './types';

/** Sliding-window limit per user (PRD B1.7). */
function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): number => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return Math.ceil((windowMs - (now - recent[0])) / 1000); }
    recent.push(now); hits.set(key, recent);
    return 0;
  };
}

const RunBody = z.object({ petId: z.string().min(1).max(200), text: z.string().trim().min(1).max(2000) });
const ApproveBody = z.object({
  actionId: z.string().min(1), contentHash: z.string().min(1),
  /** User edits to the draft. Any change requires a fresh approval (new actionId + hash). */
  edited: z.object({
    to: z.array(z.string()).optional(), cc: z.array(z.string()).optional(),
    subject: z.string().optional(), body: z.string().optional(),
  }).strict().optional(),
});

export async function agentRoutes(app: FastifyInstance, ctx: B1Context, hub: RunHub, runner: AgentRunner) {
  const auth = requireUser(ctx.config, ctx.store);
  const limit = rateLimiter(ctx.config.runRateLimit.max, ctx.config.runRateLimit.windowMs);
  const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: 'mode_forbidden', message: 'Connectors are off in Play mode.' });
  const isPlay = async (user: User) => (await ctx.store.getUserState(user.id)).mode !== 'work';

  async function ownedRun(user: User, id: string) {
    const run = await ctx.store.getRun(id);
    return run && run.userId === user.id ? run : undefined;
  }

  app.post('/agent/run', { preHandler: auth }, async (req, reply) => {
    const user = req.user!;
    if (await isPlay(user)) return forbidden(reply);
    const body = RunBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const retryAfter = limit(user.id);
    if (retryAfter) return reply.code(429).header('retry-after', retryAfter).send({ error: 'rate_limited' });
    const run = await runner.start(user, body.data.petId, body.data.text);
    return { runId: run.id };
  });

  app.get('/agent/runs/:id', { preHandler: auth }, async (req, reply) => {
    const run = await ownedRun(req.user!, (req.params as { id: string }).id);
    if (!run) return reply.code(404).send({ error: 'run_not_found' });
    return { id: run.id, petId: run.petId, text: run.text, status: run.status, steps: run.steps, createdAt: run.createdAt };
  });

  app.get('/agent/runs/:id/events', { preHandler: auth }, async (req, reply) => {
    const run = await ownedRun(req.user!, (req.params as { id: string }).id);
    if (!run) return reply.code(404).send({ error: 'run_not_found' });
    await streamRun(req, reply, hub, ctx.store, run.id, TERMINAL_STATUSES.includes(run.status));
  });

  app.post('/agent/runs/:id/approve', { preHandler: auth }, async (req, reply) => {
    const user = req.user!;
    const run = await ownedRun(user, (req.params as { id: string }).id);
    if (!run) return reply.code(404).send({ error: 'run_not_found' });
    if (await isPlay(user)) return forbidden(reply);
    const body = ApproveBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const { actionId, edited } = body.data;

    const approval = await ctx.store.getApproval(actionId);
    if (!approval || approval.runId !== run.id || approval.userId !== user.id) return reply.code(404).send({ error: 'approval_not_found' });
    const hashOk = hashesEqual(body.data.contentHash, approval.contentHash);

    // Idempotent: repeating a successful approve is a no-op, never a second execution.
    if (approval.status === 'approved') {
      return hashOk ? { ok: true, status: 'already_approved' } : reply.code(409).send({ error: 'content_hash_mismatch' });
    }
    if (approval.status !== 'pending') return reply.code(409).send({ error: 'approval_not_pending', status: approval.status });
    if (Date.now() > Date.parse(approval.expiresAt)) {
      if (await ctx.store.transitionApproval(actionId, 'pending', 'expired')) runner.gate.resolve(run.id, { decision: 'expired' });
      return reply.code(410).send({ error: 'approval_expired' });
    }
    if (!hashOk) return reply.code(409).send({ error: 'content_hash_mismatch' });
    if (runner.gate.pendingAction(run.id) !== actionId) return reply.code(409).send({ error: 'run_not_waiting' });

    if (edited) {
      const reissued = await reissueEdited(approval, edited);
      if ('error' in reissued) return reply.code(400).send(reissued);
      if (reissued.changed) {
        return reply.code(409).send({
          error: 'reapproval_required', actionId: reissued.next.actionId,
          contentHash: reissued.next.contentHash, preview: reissued.next.preview,
        });
      }
    }

    if (!(await ctx.store.transitionApproval(actionId, 'pending', 'approved'))) {
      return reply.code(409).send({ error: 'approval_not_pending' });
    }
    runner.gate.resolve(run.id, { decision: 'approved' });
    return { ok: true, status: 'approved' };
  });

  /** Edits replace the pending approval with a new one, so the user must approve the new content. */
  async function reissueEdited(old: Approval, edited: NonNullable<z.infer<typeof ApproveBody>['edited']>) {
    const def = TOOL_BY_NAME.get(old.tool);
    if (!def?.approval) return { error: 'edit_not_supported' as const };
    const parsed = def.input.safeParse({ ...old.payload, ...edited });
    if (!parsed.success) return { error: 'invalid_edit' as const, message: parsed.error.message };
    const payload = JSON.parse(JSON.stringify(parsed.data)) as Record<string, unknown>;
    if (canonicalJson(payload) === canonicalJson(old.payload)) return { changed: false as const };
    const spec = def.approval(parsed.data);
    if (!spec) return { error: 'edit_not_supported' as const };
    if (!(await ctx.store.transitionApproval(old.actionId, 'pending', 'superseded'))) return { error: 'approval_not_pending' as const };

    const actionId = newId('act');
    const next: Approval = {
      ...old, actionId, payload, kind: spec.kind, preview: spec.preview, status: 'pending',
      contentHash: contentHash(old.runId, actionId, old.tool, payload),
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ctx.config.approvalTtlMs).toISOString(),
    };
    await ctx.store.createApproval(next);
    runner.gate.setPendingAction(old.runId, actionId);
    await hub.emit(old.runId, { type: 'approval.required', actionId, kind: next.kind, preview: next.preview, contentHash: next.contentHash });
    return { changed: true as const, next };
  }

  // Cancel is allowed in both modes. While an approval is pending, cancel means "don't send":
  // the run ends with a sheepish result and no side effects (PRD B1.4).
  app.post('/agent/runs/:id/cancel', { preHandler: auth }, async (req, reply) => {
    const run = await ownedRun(req.user!, (req.params as { id: string }).id);
    if (!run) return reply.code(404).send({ error: 'run_not_found' });
    if (TERMINAL_STATUSES.includes(run.status)) return { ok: true, status: run.status };
    if (runner.gate.resolve(run.id, { decision: 'denied' })) return { ok: true, status: 'denied' };
    if (runner.abort(run.id)) return reply.code(202).send({ ok: true, status: 'cancelling' });
    // Not running in this process (e.g. after a restart): close it out directly.
    await ctx.store.updateRun(run.id, { status: 'cancelled' });
    await hub.emit(run.id, { type: 'run.cancelled' });
    return { ok: true, status: 'cancelled' };
  });
}
