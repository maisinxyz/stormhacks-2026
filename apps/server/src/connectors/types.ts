// Connector surface shared by the real Google wrappers and MOCK_CONNECTORS.

export interface EmailSummary {
  id: string; threadId: string; from: string; to: string[]; subject: string; snippet: string; date: string; unread: boolean;
}
export interface Email extends EmailSummary { cc: string[]; body: string }
export interface OutgoingEmail { to: string[]; cc?: string[]; subject: string; body: string; threadId?: string }

export interface DriveFile {
  id: string; name: string; mimeType: string; modifiedTime: string; webViewLink?: string; parents?: string[];
}

export interface CalEvent {
  id: string; title: string; start: string; end: string; attendees: string[];
  location?: string; description?: string; htmlLink?: string;
}
export interface NewCalEvent { title: string; start: string; end: string; attendees?: string[]; location?: string; description?: string }

export interface Connectors {
  gmail: {
    search(query: string, max: number): Promise<EmailSummary[]>;
    read(id: string): Promise<Email>;
    draft(msg: OutgoingEmail): Promise<{ draftId: string }>;
    send(msg: OutgoingEmail): Promise<{ messageId: string }>;
    deleteDraft(draftId: string): Promise<void>;
    /** Unread inbox messages newer than `sinceMs` (epoch ms), newest first. */
    listUnread(sinceMs: number): Promise<EmailSummary[]>;
  };
  drive: {
    search(query: string, max: number): Promise<DriveFile[]>;
    get(id: string): Promise<DriveFile>;
    /** Plain-text content (Docs as text, Sheets as CSV). */
    read(id: string): Promise<{ file: DriveFile; text: string }>;
    rename(id: string, name: string): Promise<{ file: DriveFile; oldName: string }>;
    move(id: string, folderId: string): Promise<{ file: DriveFile; oldParents: string[] }>;
    trash(id: string): Promise<void>;
    share(id: string, email: string, role: 'reader' | 'commenter' | 'writer'): Promise<void>;
    createDoc(title: string, content: string): Promise<DriveFile>;
  };
  calendar: {
    list(opts: { from: string; to: string; query?: string }): Promise<CalEvent[]>;
    get(id: string): Promise<CalEvent>;
    create(ev: NewCalEvent): Promise<CalEvent>;
    update(id: string, patch: Partial<NewCalEvent>): Promise<CalEvent>;
  };
}

export class ConnectorError extends Error {
  constructor(public code: string, message: string, public retryable = false) { super(message); }
}

/** Strips CR/LF so model-supplied values cannot inject email headers. */
export const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
