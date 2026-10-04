// Tool registry with verb tagging (PRD B1.3) and approval classes (PRD B1.4).
// Every connector tool runs through the runner, which owns events, retries, and approval gating.
import { z } from 'zod';
import type { Verb } from '@fetch/contracts';
import type { Connectors } from '../connectors/types';
import type { ApprovalKind, ApprovalPreview } from './types';

export interface ToolContext {
  connectors: Connectors;
  progress(note: string, itemsRead?: number): void;
}
export interface ToolOutput { data: unknown; undo?: Record<string, unknown> }
export interface ApprovalSpec { kind: ApprovalKind; preview: ApprovalPreview }

/** read = auto; reversible = auto + undo log; outbound = blocked until approved; meta = no connector. */
export type Policy = 'read' | 'reversible' | 'outbound' | 'meta';

export interface ToolDef<I = any> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  verb: (input: I) => Verb;
  label: (input: I) => string;
  policy: Policy;
  /** Non-null means the call is held for human approval; the stored input is what executes. */
  approval?: (input: I) => ApprovalSpec | null;
  run(input: I, t: ToolContext): Promise<ToolOutput>;
}

const verb = (v: Verb) => () => v;
const emails = z.array(z.string().email()).min(1).max(50);
const clip = (s: string, n = 40) => s.length > n ? `${s.slice(0, n - 1)}…` : s;
const max = z.number().int().min(1).max(25).default(10);

function tool<I>(def: ToolDef<I>): ToolDef<I> { return def; }

const OutgoingEmail = z.object({
  to: emails, cc: z.array(z.string().email()).max(50).optional(),
  subject: z.string().max(300), body: z.string().max(20_000), threadId: z.string().optional(),
});
const CalFields = z.object({
  title: z.string().max(300), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }),
  attendees: z.array(z.string().email()).max(100).optional(), location: z.string().max(300).optional(),
  description: z.string().max(5000).optional(),
});
const inviteApproval = (title: string, attendees: string[] | undefined, start?: string): ApprovalSpec | null =>
  attendees?.length ? {
    kind: 'calendar_invite',
    preview: { to: attendees, subject: title, summary: `Send a calendar invite for "${title}"${start ? ` at ${start}` : ''} to ${attendees.length} people.` },
  } : null;

export const TOOLS: ToolDef[] = [
  tool({
    name: 'gmail.search', policy: 'read', verb: verb('SEARCH'),
    description: 'Search the user\'s Gmail. Accepts Gmail query syntax (e.g. "standup notes", "from:alex is:unread"). Returns message summaries.',
    input: z.object({ query: z.string().max(500), max }),
    label: i => `Searching Gmail for "${clip(i.query)}"`,
    async run(i, t) {
      const results = await t.connectors.gmail.search(i.query, i.max);
      t.progress(`Found ${results.length} emails`, results.length);
      return { data: results };
    },
  }),
  tool({
    name: 'gmail.read', policy: 'read', verb: verb('READ'),
    description: 'Read one email by id (from gmail.search).',
    input: z.object({ id: z.string() }),
    label: () => 'Reading an email',
    async run(i, t) { const m = await t.connectors.gmail.read(i.id); t.progress(`Read "${clip(m.subject)}"`, 1); return { data: m }; },
  }),
  tool({
    name: 'gmail.draft', policy: 'reversible', verb: verb('WRITE'),
    description: 'Create a Gmail draft (not sent). Use this to prepare an email before gmail.send.',
    input: OutgoingEmail,
    label: i => `Drafting "${clip(i.subject)}"`,
    async run(i, t) { const r = await t.connectors.gmail.draft(i); return { data: r, undo: { deleteDraft: r.draftId } }; },
  }),
  tool({
    name: 'gmail.send', policy: 'outbound', verb: verb('SEND'),
    description: 'Send an email. Always requires the user\'s approval; the user sees exactly these recipients, subject, and body.',
    input: OutgoingEmail,
    label: i => `Sending "${clip(i.subject)}"`,
    approval: i => ({
      kind: 'send_email',
      preview: {
        to: [...i.to, ...(i.cc ?? [])], subject: i.subject, body: i.body,
        summary: `Send "${i.subject}" to ${i.to.join(', ')}${i.cc?.length ? ` (cc ${i.cc.join(', ')})` : ''}.`,
      },
    }),
    async run(i, t) { return { data: await t.connectors.gmail.send(i) }; },
  }),

  tool({
    name: 'drive.search', policy: 'read', verb: verb('SEARCH'),
    description: 'Search Google Drive by file name and content. Returns file metadata with links.',
    input: z.object({ query: z.string().max(200), max }),
    label: i => `Searching Drive for "${clip(i.query)}"`,
    async run(i, t) {
      const files = await t.connectors.drive.search(i.query, i.max);
      t.progress(`Found ${files.length} files`, files.length);
      return { data: files };
    },
  }),
  tool({
    name: 'drive.read', policy: 'read', verb: verb('READ'),
    description: 'Read a Drive file\'s text content (Docs as text, Sheets as CSV).',
    input: z.object({ fileId: z.string() }),
    label: () => 'Reading a Drive file',
    async run(i, t) { const r = await t.connectors.drive.read(i.fileId); t.progress(`Read "${clip(r.file.name)}"`, 1); return { data: r }; },
  }),
  tool({
    name: 'drive.get', policy: 'read', verb: verb('FETCH'),
    description: 'Fetch a Drive file\'s metadata and link, e.g. to bring a document back to the user.',
    input: z.object({ fileId: z.string() }),
    label: () => 'Fetching the file',
    async run(i, t) { return { data: await t.connectors.drive.get(i.fileId) }; },
  }),
  tool({
    name: 'drive.rename', policy: 'reversible', verb: verb('ORGANIZE'),
    description: 'Rename a Drive file.',
    input: z.object({ fileId: z.string(), name: z.string().min(1).max(300) }),
    label: i => `Renaming to "${clip(i.name)}"`,
    async run(i, t) {
      const r = await t.connectors.drive.rename(i.fileId, i.name);
      return { data: r.file, undo: { rename: { fileId: i.fileId, name: r.oldName } } };
    },
  }),
  tool({
    name: 'drive.move', policy: 'reversible', verb: verb('ORGANIZE'),
    description: 'Move a Drive file into a folder (folderId from drive.search).',
    input: z.object({ fileId: z.string(), folderId: z.string() }),
    label: () => 'Moving a file',
    async run(i, t) {
      const r = await t.connectors.drive.move(i.fileId, i.folderId);
      return { data: r.file, undo: { move: { fileId: i.fileId, parents: r.oldParents } } };
    },
  }),
  tool({
    name: 'drive.trash', policy: 'outbound', verb: verb('ORGANIZE'),
    description: 'Move a Drive file to the trash. Always requires the user\'s approval.',
    input: z.object({ fileId: z.string(), fileName: z.string().max(300) }),
    label: i => `Deleting "${clip(i.fileName)}"`,
    approval: i => ({ kind: 'delete', preview: { summary: `Move "${i.fileName}" to the Drive trash.` } }),
    async run(i, t) { await t.connectors.drive.trash(i.fileId); return { data: { trashed: i.fileId } }; },
  }),
  tool({
    name: 'drive.share', policy: 'outbound', verb: verb('SEND'),
    description: 'Share a Drive file with someone. Always requires the user\'s approval.',
    input: z.object({ fileId: z.string(), fileName: z.string().max(300), email: z.string().email(), role: z.enum(['reader', 'commenter', 'writer']).default('reader') }),
    label: i => `Sharing "${clip(i.fileName)}"`,
    approval: i => ({ kind: 'share', preview: { to: [i.email], summary: `Give ${i.email} ${i.role} access to "${i.fileName}".` } }),
    async run(i, t) { await t.connectors.drive.share(i.fileId, i.email, i.role); return { data: { shared: i.fileId, with: i.email } }; },
  }),
  tool({
    name: 'doc.create', policy: 'reversible', verb: verb('WRITE'),
    description: 'Create a new Google Doc with plain-text content.',
    input: z.object({ title: z.string().min(1).max(300), content: z.string().max(50_000) }),
    label: i => `Writing "${clip(i.title)}"`,
    async run(i, t) { const f = await t.connectors.drive.createDoc(i.title, i.content); return { data: f, undo: { trash: f.id } }; },
  }),

  tool({
    name: 'calendar.list', policy: 'read', verb: verb('READ'),
    description: 'List calendar events in a time window (ISO 8601). Defaults to the next 7 days.',
    input: z.object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(), query: z.string().max(200).optional() }),
    label: () => 'Checking the calendar',
    async run(i, t) {
      const from = i.from ?? new Date().toISOString();
      const to = i.to ?? new Date(Date.parse(from) + 7 * 86_400_000).toISOString();
      const events = await t.connectors.calendar.list({ from, to, query: i.query });
      t.progress(`Found ${events.length} events`, events.length);
      return { data: events };
    },
  }),
  tool({
    name: 'calendar.create', policy: 'reversible',
    verb: i => i.attendees?.length ? 'SEND' : 'WRITE',
    description: 'Create a calendar event. If it has attendees, invites go out, so the user must approve first.',
    input: CalFields,
    label: i => `Scheduling "${clip(i.title)}"`,
    approval: i => inviteApproval(i.title, i.attendees, i.start),
    async run(i, t) { const e = await t.connectors.calendar.create(i); return { data: e }; },
  }),
  tool({
    name: 'calendar.update', policy: 'reversible',
    verb: i => i.attendees?.length ? 'SEND' : 'WRITE',
    description: 'Update a calendar event by id. Changing attendees sends invites, so the user must approve first.',
    input: CalFields.partial().extend({ eventId: z.string() }),
    label: i => i.title ? `Updating "${clip(i.title)}"` : 'Updating an event',
    approval: i => inviteApproval(i.title ?? 'an event', i.attendees, i.start),
    async run({ eventId, ...patch }, t) {
      const before = await t.connectors.calendar.get(eventId);
      const after = await t.connectors.calendar.update(eventId, patch);
      return { data: after, undo: { calendarRestore: before } };
    },
  }),

  tool({
    name: 'pet.work', policy: 'meta',
    verb: i => i.verb,
    description: 'Show a reasoning step that needs no connector, e.g. comparing items, calculating totals, negotiating times, '
      + 'or waiting. Put your conclusion in `note`; it is shown in the user\'s run log.',
    input: z.object({ verb: z.enum(['COMPARE', 'CALCULATE', 'NEGOTIATE', 'MONITOR', 'WAIT', 'ORGANIZE', 'WRITE', 'READ']), note: z.string().max(300) }),
    label: i => clip(i.note, 60),
    async run(i, t) { t.progress(i.note); return { data: { ok: true } }; },
  }),
];

export const TOOL_BY_NAME = new Map(TOOLS.map(t => [t.name, t]));
/** Anthropic tool names allow only [a-zA-Z0-9_-]. */
export const apiName = (name: string) => name.replace(/\./g, '_');
export const TOOL_BY_API_NAME = new Map(TOOLS.map(t => [apiName(t.name), t]));

export const PRESET_PROPS = ['envelope', 'document', 'folder', 'magnifier', 'keyboard', 'pencil', 'calendar', 'phone', 'coin', 'box'] as const;
export const DEFAULT_PROP: Partial<Record<Verb, (typeof PRESET_PROPS)[number]>> = {
  SEARCH: 'magnifier', FETCH: 'document', READ: 'document', WRITE: 'pencil', SEND: 'envelope',
  ORGANIZE: 'folder', CALCULATE: 'coin', COMPARE: 'document', NEGOTIATE: 'phone', MONITOR: 'calendar',
};
