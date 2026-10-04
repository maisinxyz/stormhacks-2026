// Real Gmail / Drive / Calendar connectors over the Google REST APIs.
import type { OAuth2Client } from 'google-auth-library';
import { ConnectorError, oneLine, type CalEvent, type Connectors, type DriveFile, type EmailSummary, type OutgoingEmail } from './types';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary';
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,webViewLink,parents';
const MAX_TEXT = 20_000;

type Json = Record<string, any>;

function wrapError(err: unknown): never {
  const status = (err as { response?: { status?: number }; status?: number }).response?.status
    ?? (err as { status?: number }).status;
  const message = (err as Error).message ?? 'Google API error';
  if (status === 404) throw new ConnectorError('not_found', message);
  if (status === 401 || status === 403) throw new ConnectorError('auth_required', message);
  const retryable = status === undefined || status === 429 || status >= 500;
  throw new ConnectorError(retryable ? 'upstream_unavailable' : 'upstream_error', message, retryable);
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const encodeHeader = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;

function rfc822(msg: OutgoingEmail): string {
  const lines = [
    `To: ${msg.to.map(oneLine).join(', ')}`,
    ...(msg.cc?.length ? [`Cc: ${msg.cc.map(oneLine).join(', ')}`] : []),
    `Subject: ${encodeHeader(oneLine(msg.subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(msg.body, 'utf8').toString('base64'),
  ];
  return b64url(lines.join('\r\n'));
}

const header = (m: Json, name: string): string =>
  m.payload?.headers?.find((h: Json) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
const splitAddrs = (s: string) => s ? s.split(',').map(a => a.trim()).filter(Boolean) : [];

function toSummary(m: Json): EmailSummary {
  return {
    id: m.id, threadId: m.threadId, from: header(m, 'From'), to: splitAddrs(header(m, 'To')),
    subject: header(m, 'Subject'), snippet: m.snippet ?? '',
    date: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    unread: (m.labelIds ?? []).includes('UNREAD'),
  };
}

function bodyText(part: Json): string {
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const p of part.parts ?? []) { const t = bodyText(p); if (t) return t; }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8').replace(/<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

const toEvent = (e: Json): CalEvent => ({
  id: e.id, title: e.summary ?? '(no title)', start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date,
  attendees: (e.attendees ?? []).map((a: Json) => a.email), location: e.location, description: e.description, htmlLink: e.htmlLink,
});
const eventBody = (ev: Partial<{ title: string; start: string; end: string; attendees: string[]; location: string; description: string }>) => ({
  ...(ev.title !== undefined && { summary: ev.title }),
  ...(ev.start !== undefined && { start: { dateTime: ev.start } }),
  ...(ev.end !== undefined && { end: { dateTime: ev.end } }),
  ...(ev.attendees !== undefined && { attendees: ev.attendees.map(email => ({ email })) }),
  ...(ev.location !== undefined && { location: ev.location }),
  ...(ev.description !== undefined && { description: ev.description }),
});

const escapeQ = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const truncate = (s: string) => s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n[truncated: ${s.length - MAX_TEXT} more characters]` : s;

export function googleConnectors(client: OAuth2Client): Connectors {
  async function call<T = Json>(opts: { url: string; method?: string; params?: Json; data?: unknown; headers?: Json; responseType?: 'text' | 'json' }): Promise<T> {
    try { return (await client.request<T>(opts as never)).data; } catch (err) { wrapError(err); }
  }
  const getFile = (id: string) => call<DriveFile>({ url: `${DRIVE}/files/${id}`, params: { fields: FILE_FIELDS } });

  return {
    gmail: {
      async search(query, max) {
        const list = await call({ url: `${GMAIL}/messages`, params: { q: query, maxResults: max } });
        const ids: string[] = (list.messages ?? []).map((m: Json) => m.id);
        const msgs = await Promise.all(ids.map(id => call({ url: `${GMAIL}/messages/${id}`, params: { format: 'metadata', metadataHeaders: ['From', 'To', 'Subject'] } })));
        return msgs.map(toSummary);
      },
      async read(id) {
        const m = await call({ url: `${GMAIL}/messages/${id}`, params: { format: 'full' } });
        return { ...toSummary(m), cc: splitAddrs(header(m, 'Cc')), body: truncate(bodyText(m.payload ?? {})) };
      },
      async draft(msg) {
        const d = await call({ url: `${GMAIL}/drafts`, method: 'POST', data: { message: { raw: rfc822(msg), threadId: msg.threadId } } });
        return { draftId: d.id };
      },
      async deleteDraft(draftId) { await call({ url: `${GMAIL}/drafts/${draftId}`, method: 'DELETE' }); },
      async send(msg) {
        const m = await call({ url: `${GMAIL}/messages/send`, method: 'POST', data: { raw: rfc822(msg), threadId: msg.threadId } });
        return { messageId: m.id };
      },
      async listUnread(sinceMs) {
        return this.search(`is:unread in:inbox after:${Math.floor(sinceMs / 1000)}`, 10);
      },
    },

    drive: {
      async search(query, max) {
        const q = `(name contains '${escapeQ(query)}' or fullText contains '${escapeQ(query)}') and trashed = false`;
        const r = await call({ url: `${DRIVE}/files`, params: { q, pageSize: max, fields: `files(${FILE_FIELDS})`, orderBy: 'modifiedTime desc' } });
        return r.files ?? [];
      },
      get: getFile,
      async read(id) {
        const file = await getFile(id);
        const exportAs = file.mimeType === 'application/vnd.google-apps.spreadsheet' ? 'text/csv'
          : file.mimeType.startsWith('application/vnd.google-apps.') ? 'text/plain' : undefined;
        if (!exportAs && !/^text\/|json|csv/.test(file.mimeType)) {
          return { file, text: `[binary file of type ${file.mimeType}; open ${file.webViewLink ?? 'in Drive'}]` };
        }
        const text = exportAs
          ? await call<string>({ url: `${DRIVE}/files/${id}/export`, params: { mimeType: exportAs }, responseType: 'text' })
          : await call<string>({ url: `${DRIVE}/files/${id}`, params: { alt: 'media' }, responseType: 'text' });
        return { file, text: truncate(String(text)) };
      },
      async rename(id, name) {
        const before = await getFile(id);
        const file = await call<DriveFile>({ url: `${DRIVE}/files/${id}`, method: 'PATCH', params: { fields: FILE_FIELDS }, data: { name } });
        return { file, oldName: before.name };
      },
      async move(id, folderId) {
        const before = await getFile(id);
        const oldParents = before.parents ?? [];
        const file = await call<DriveFile>({
          url: `${DRIVE}/files/${id}`, method: 'PATCH',
          params: { addParents: folderId, removeParents: oldParents.join(','), fields: FILE_FIELDS }, data: {},
        });
        return { file, oldParents };
      },
      async trash(id) { await call({ url: `${DRIVE}/files/${id}`, method: 'PATCH', data: { trashed: true } }); },
      async share(id, email, role) {
        await call({ url: `${DRIVE}/files/${id}/permissions`, method: 'POST', params: { sendNotificationEmail: true }, data: { type: 'user', role, emailAddress: email } });
      },
      async createDoc(title, content) {
        const boundary = `fetch-${Date.now()}`;
        const body = [
          `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '',
          JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.document' }),
          `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', '', content, `--${boundary}--`,
        ].join('\r\n');
        return call<DriveFile>({
          url: `${UPLOAD}/files`, method: 'POST', params: { uploadType: 'multipart', fields: FILE_FIELDS },
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, data: body,
        });
      },
    },

    calendar: {
      async list({ from, to, query }) {
        const r = await call({ url: `${CAL}/events`, params: { timeMin: from, timeMax: to, q: query, singleEvents: true, orderBy: 'startTime', maxResults: 25 } });
        return (r.items ?? []).map(toEvent);
      },
      async get(id) { return toEvent(await call({ url: `${CAL}/events/${id}` })); },
      async create(ev) {
        const sendUpdates = ev.attendees?.length ? 'all' : 'none';
        return toEvent(await call({ url: `${CAL}/events`, method: 'POST', params: { sendUpdates }, data: eventBody(ev) }));
      },
      async update(id, patch) {
        const sendUpdates = patch.attendees?.length ? 'all' : 'none';
        return toEvent(await call({ url: `${CAL}/events/${id}`, method: 'PATCH', params: { sendUpdates }, data: eventBody(patch) }));
      },
    },
  };
}
