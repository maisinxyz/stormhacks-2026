// MOCK_CONNECTORS (PRD 0.7): an in-memory Gmail/Drive/Calendar over the seeded workspace.
// One workspace per user so mutations (sent mail, renames) stay isolated.
import { randomUUID } from 'node:crypto';
import { seedEmails, seedEvents, seedFiles, DEMO_EMAIL, type SeedFile } from './seed';
import { ConnectorError, type CalEvent, type Connectors, type Email, type OutgoingEmail } from './types';

const matches = (query: string, ...fields: string[]) => {
  const hay = fields.join(' ').toLowerCase();
  const terms = query.toLowerCase().replace(/\b(is:unread|in:inbox|from:|subject:)/g, ' ').split(/\s+/).filter(Boolean);
  return terms.length === 0 || terms.some(t => hay.includes(t));
};
const summary = ({ body: _b, cc: _c, ...s }: Email) => s;
const file = ({ text: _t, ...f }: SeedFile) => f;

export class MockWorkspace implements Connectors {
  emails = seedEmails();
  files = seedFiles();
  events = seedEvents();
  sent: (OutgoingEmail & { messageId: string; at: string })[] = [];
  drafts = new Map<string, OutgoingEmail>();
  shares: { id: string; email: string; role: string }[] = [];

  private findFile(id: string) {
    const f = this.files.find(f => f.id === id);
    if (!f) throw new ConnectorError('not_found', `No Drive file with id ${id}`);
    return f;
  }
  private findEvent(id: string) {
    const e = this.events.find(e => e.id === id);
    if (!e) throw new ConnectorError('not_found', `No calendar event with id ${id}`);
    return e;
  }

  gmail: Connectors['gmail'] = {
    search: async (query, max) => this.emails
      .filter(m => matches(query, m.subject, m.from, m.snippet, m.body))
      .slice(0, max).map(summary),
    read: async (id) => {
      const m = this.emails.find(m => m.id === id);
      if (!m) throw new ConnectorError('not_found', `No email with id ${id}`);
      m.unread = false;
      return structuredClone(m);
    },
    draft: async (msg) => { const draftId = `draft-${randomUUID()}`; this.drafts.set(draftId, msg); return { draftId }; },
    deleteDraft: async (draftId) => { this.drafts.delete(draftId); },
    send: async (msg) => {
      const messageId = `sent-${randomUUID()}`;
      this.sent.push({ ...structuredClone(msg), messageId, at: new Date().toISOString() });
      return { messageId };
    },
    listUnread: async (sinceMs) => this.emails
      .filter(m => m.unread && Date.parse(m.date) > sinceMs)
      .sort((a, b) => b.date.localeCompare(a.date)).map(summary),
  };

  drive: Connectors['drive'] = {
    search: async (query, max) => this.files
      .filter(f => matches(query, f.name, f.text)).slice(0, max).map(file),
    get: async (id) => file(this.findFile(id)),
    read: async (id) => { const f = this.findFile(id); return { file: file(f), text: f.text }; },
    rename: async (id, name) => { const f = this.findFile(id); const oldName = f.name; f.name = name; return { file: file(f), oldName }; },
    move: async (id, folderId) => {
      const f = this.findFile(id); this.findFile(folderId);
      const oldParents = f.parents ?? []; f.parents = [folderId];
      return { file: file(f), oldParents };
    },
    trash: async (id) => { this.findFile(id); this.files = this.files.filter(f => f.id !== id); },
    share: async (id, email, role) => { this.findFile(id); this.shares.push({ id, email, role }); },
    createDoc: async (title, content) => {
      const f: SeedFile = {
        id: `file-${randomUUID()}`, name: title, mimeType: 'application/vnd.google-apps.document',
        modifiedTime: new Date().toISOString(), parents: ['root'], text: content,
      };
      f.webViewLink = `https://docs.google.com/document/d/${f.id}`;
      this.files.push(f);
      return file(f);
    },
  };

  calendar: Connectors['calendar'] = {
    list: async ({ from, to, query }) => this.events
      .filter(e => e.start >= from && e.start <= to && (!query || matches(query, e.title, e.description ?? '')))
      .sort((a, b) => a.start.localeCompare(b.start)).map(e => structuredClone(e)),
    get: async (id) => structuredClone(this.findEvent(id)),
    create: async (ev) => {
      const e: CalEvent = { id: `evt-${randomUUID()}`, attendees: [], ...structuredClone(ev) };
      this.events.push(e);
      return structuredClone(e);
    },
    update: async (id, patch) => { const e = this.findEvent(id); Object.assign(e, structuredClone(patch)); return structuredClone(e); },
  };
}

const workspaces = new Map<string, MockWorkspace>();
export function mockWorkspace(userId: string) {
  let ws = workspaces.get(userId);
  if (!ws) { ws = new MockWorkspace(); workspaces.set(userId, ws); }
  return ws;
}
export const MOCK_USER_EMAIL = DEMO_EMAIL;
