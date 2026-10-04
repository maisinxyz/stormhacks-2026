// Composio-backed tools: the agent can search and run any app's tools (Gmail, Slack, GitHub, Notion, ...).
// apps.execute connects missing accounts automatically and holds anything not read-only for approval.
import { z } from 'zod';
import type { Verb } from '@fetch/contracts';
import type { ComposioToolInfo } from '../connectors/composio';
import { ConnectorError } from '../connectors/types';
import type { ApprovalSpec, ToolContext, ToolDef } from './tools';
import type { ApprovalKind } from './types';

const MAX_PREVIEW = 4000;

/** Best-effort animation verb from a Composio tool slug like SLACK_SEND_MESSAGE. */
export function verbForSlug(slug: string): Verb {
  const s = `_${slug.toUpperCase()}_`;
  const has = (...w: string[]) => w.some(x => s.includes(`_${x}`));
  if (has('SEND', 'POST', 'REPLY', 'FORWARD', 'PUBLISH', 'INVITE', 'SHARE')) return 'SEND';
  if (has('DELETE', 'REMOVE', 'TRASH', 'ARCHIVE', 'MOVE', 'RENAME', 'LABEL', 'ADD_LABEL', 'MERGE', 'ASSIGN')) return 'ORGANIZE';
  if (has('CREATE', 'UPDATE', 'DRAFT', 'WRITE', 'EDIT', 'INSERT', 'UPSERT', 'PATCH', 'SET', 'ADD', 'APPEND', 'COMMENT')) return 'WRITE';
  if (has('DOWNLOAD', 'EXPORT', 'FETCH')) return 'FETCH';
  if (has('SEARCH', 'FIND', 'QUERY', 'LIST')) return 'SEARCH';
  if (has('GET', 'READ', 'RETRIEVE', 'DESCRIBE', 'VIEW')) return 'READ';
  return 'WAIT';
}

/** Only tools Composio marks read-only skip approval; unknown means approval. */
export const isReadOnly = (info: ComposioToolInfo) => info.tags.includes('readOnlyHint') && !info.tags.includes('destructiveHint');

function kindFor(infos: ComposioToolInfo[], calls: Call[]): ApprovalKind {
  const slugs = infos.map(i => i.slug.toUpperCase());
  if (infos.some(i => i.tags.includes('destructiveHint')) || slugs.some(s => /_(DELETE|REMOVE|TRASH|DESTROY)/.test(s))) return 'delete';
  if (slugs.some(s => /(GMAIL|OUTLOOK|EMAIL|MAIL).*_(SEND|REPLY|FORWARD)|_SEND_EMAIL/.test(s))) return 'send_email';
  if (slugs.some(s => /_(SHARE|ADD_PERMISSION|ADD_COLLABORATOR|INVITE)/.test(s))) return 'share';
  if (slugs.some((s, i) => /CALENDAR.*_(CREATE|UPDATE|PATCH)/.test(s) && hasAttendees(calls[i]?.arguments))) return 'calendar_invite';
  return 'other';
}
const hasAttendees = (a: Record<string, unknown> | undefined) => Array.isArray(a?.attendees) && a.attendees.length > 0;

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? v.split(/[,;]\s*/).filter(Boolean) : Array.isArray(v) ? v.flatMap(strings) : [];
const firstString = (a: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) if (typeof a[k] === 'string' && a[k]) return a[k] as string;
  return undefined;
};

/** Preview built from the exact arguments that will run, so the card never relies on model prose. */
function previewFor(writes: { info: ComposioToolInfo; call: Call }[], all: number): ApprovalSpec['preview'] {
  const to = writes.flatMap(({ call: { arguments: a } }) =>
    strings(a.to ?? a.recipient_email ?? a.recipients ?? a.recipient ?? a.email ?? a.attendees ?? a.channel ?? a.channel_id));
  const single = writes.length === 1 ? writes[0].call.arguments : undefined;
  const body = writes.map(({ info, call }) => `${info.toolkitName} · ${info.name} (${info.slug})\n${JSON.stringify(call.arguments, null, 2)}`).join('\n\n');
  return {
    ...(to.length && { to: [...new Set(to)] }),
    ...(single && firstString(single, ['subject', 'title', 'name']) && { subject: firstString(single, ['subject', 'title', 'name']) }),
    body: body.length > MAX_PREVIEW ? `${body.slice(0, MAX_PREVIEW)}\n… (${body.length - MAX_PREVIEW} more characters)` : body,
    summary: `${writes.map(w => `${w.info.toolkitName}: ${w.info.name}`).join('; ')}${all > writes.length ? ` (plus ${all - writes.length} read-only step${all - writes.length > 1 ? 's' : ''})` : ''}.`,
  };
}

const CallSchema = z.object({
  tool_slug: z.string().regex(/^[A-Z0-9_]{3,120}$/, 'tool_slug must be an exact Composio slug like SLACK_SEND_MESSAGE'),
  arguments: z.record(z.string(), z.unknown()).default({}),
});
type Call = z.infer<typeof CallSchema>;

const gateway = (t: ToolContext) => {
  if (!t.composio) throw new ConnectorError('not_configured', 'Composio is not configured');
  return t.composio;
};
const infosFor = (t: ToolContext, calls: Call[]) => Promise.all(calls.map(c => gateway(t).toolInfo(c.tool_slug)));

export const APP_TOOLS: ToolDef[] = [
  {
    name: 'apps.search', policy: 'read', connector: 'composio', verb: () => 'SEARCH',
    description: 'Find tools for any app (Gmail, Google Drive/Calendar/Sheets/Docs, Slack, GitHub, Notion, Linear, Jira, '
      + 'Outlook, HubSpot, and hundreds more). Describe the task in plain words. Returns matching tool slugs with their '
      + 'input schemas, guidance, and whether each app is connected. Call this before apps_execute to get exact slugs and arguments.',
    input: z.object({
      query: z.string().min(2).max(500).describe('What you want to do, e.g. "send a Slack message to a channel"'),
      toolkits: z.array(z.string().max(60)).max(10).optional().describe('Optional app slugs to restrict to, e.g. ["slack"]'),
    }),
    label: i => `Sniffing out the right tool${i.toolkits?.length ? ` in ${i.toolkits.join(', ')}` : ''}`,
    async run(i, t) {
      const res = await gateway(t).search(t.userId, i.query, i.toolkits);
      t.progress(`Found ${res.results.reduce((n, r) => n + r.primaryToolSlugs.length, 0)} candidate tools`);
      return { data: res };
    },
  },
  {
    name: 'apps.execute', policy: 'reversible', connector: 'composio',
    verb: (i: { tools: Call[] }) => i.tools.map(c => verbForSlug(c.tool_slug)).find(v => v !== 'SEARCH' && v !== 'READ') ?? verbForSlug(i.tools[0].tool_slug),
    description: 'Run one or more app tools by exact slug (from apps_search) with arguments matching their input schema. '
      + 'If an app is not connected yet, the user is asked to connect it and the call continues automatically once they do. '
      + 'Anything that is not read-only (sending, posting, creating, updating, deleting) is shown to the user for approval first, '
      + 'so pass the exact final content. Calls in one batch run in order.',
    input: z.object({
      tools: z.array(CallSchema).min(1).max(8),
      thought: z.string().max(300).optional().describe('One line on why these calls'),
    }),
    label: (i: { tools: Call[] }) => i.tools.map(c => c.tool_slug.toLowerCase().replace(/_/g, ' ')).join(', ').slice(0, 60),

    // Connect any app the calls need before anything else, so approval and execution never stall.
    async prepare(i, t) {
      const infos = await infosFor(t, i.tools);
      const toolkits = new Map(infos.map(x => [x.toolkit, x.toolkitName]));
      for (const [slug, name] of toolkits) {
        if (await gateway(t).isConnected(t.userId, slug)) continue;
        const req = await gateway(t).authorize(t.userId, slug);
        await t.awaitConnection({ slug, name }, req);
      }
      return i;
    },

    async approval(i, t) {
      const infos = await infosFor(t, i.tools);
      const writes = infos.map((info, k) => ({ info, call: i.tools[k] })).filter(w => !isReadOnly(w.info));
      if (!writes.length) return null;
      return { kind: kindFor(writes.map(w => w.info), writes.map(w => w.call)), preview: previewFor(writes, i.tools.length) };
    },

    async run(i, t) {
      const results: { index: number; tool_slug: string; successful: boolean; error?: string; data?: unknown }[] = [];
      for (const [k, call] of i.tools.entries()) {
        const res = await gateway(t).execute(t.userId, call.tool_slug, call.arguments);
        t.progress(`${res.successful ? 'Done' : 'Failed'}: ${call.tool_slug}`, 1);
        results.push({ index: k, tool_slug: call.tool_slug, successful: res.successful, ...(res.error ? { error: res.error } : { data: res.data }) });
      }
      if (results.every(r => !r.successful)) throw new ConnectorError('tool_failed', results.map(r => `${r.tool_slug}: ${r.error}`).join('; '));
      return { data: results };
    },
  },
];
