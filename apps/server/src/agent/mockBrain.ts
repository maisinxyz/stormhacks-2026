// MOCK_AGENT (PRD 0.7): scripted brains for the demo commands. They drive the real runner,
// tools, and approvals, so the SSE stream is identical in shape to a Claude-driven run.
import { randomUUID } from 'node:crypto';
import { FINISH_TOOL, PLAN_TOOL, type Brain, type BrainInput, type BrainTurn, type ToolCall, type ToolResultMsg } from './brain';
import type { PlanInput, FinishInput } from './brain';

type Script = Generator<BrainTurn, void, ToolResultMsg[]>;

const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: `mock_${randomUUID()}`, name, input });
const plan = (p: PlanInput) => call(PLAN_TOOL, p);
const finish = (f: Partial<FinishInput> & { summary: string }) => call(FINISH_TOOL, f);

/** Parses the JSON inside an <untrusted_data> tool result. */
function data<T = any>(r: ToolResultMsg | undefined): T | undefined {
  if (!r || r.isError) return undefined;
  const m = r.content.match(/<untrusted_data[^>]*>\n([\s\S]*)\n<\/untrusted_data>/);
  try { return m ? JSON.parse(m[1]) : undefined; } catch { return undefined; }
}
const last = <T>(rs: T[]) => rs[rs.length - 1];

function* findDoc(query: string, pet: BrainInput['pet']): Script {
  let r = yield {
    calls: [
      plan({
        say: `On it! Sniffing out your ${query}.`,
        steps: [
          { verb: 'SEARCH', label: `Searching Drive for "${query}"`, prop: 'magnifier' },
          { verb: 'READ', label: 'Reading the sheet', prop: 'document' },
          { verb: 'FETCH', label: 'Bringing it back', prop: 'document' },
        ],
      }),
      call('drive_search', { stepId: 's1', query: query.replace(/\b(my|the)\b/g, '').trim(), max: 5 }),
    ],
  };
  const files = data<{ id: string; name: string; mimeType: string }[]>(last(r)) ?? [];
  const file = files.find(f => !f.mimeType.endsWith('folder')) ?? files[0];
  if (!file) return void (yield { calls: [finish({ summary: `I couldn't find anything matching "${query}".`, say: 'Hmm, I came back empty-pawed.', mood: 'sheepish' })] });

  r = yield { calls: [call('drive_read', { stepId: 's2', fileId: file.id })] };
  const text = data<{ text: string }>(last(r))?.text ?? '';
  r = yield { calls: [call('drive_get', { stepId: 's3', fileId: file.id })] };
  const meta = data<{ name: string; webViewLink?: string }>(last(r)) ?? file;
  yield {
    calls: [finish({
      summary: `Found "${meta.name}".`,
      say: `${pet.name} found it! Here's your ${query}.`,
      mood: 'proud', prop: 'document',
      card: { title: meta.name, text: text.split('\n').slice(0, 6).join('\n'), ...('webViewLink' in meta && meta.webViewLink ? { url: meta.webViewLink } : {}) },
    })],
  };
}

function* emailNotes(): Script {
  let r = yield {
    calls: [
      plan({
        say: 'Fetching the standup notes for the team!',
        steps: [
          { verb: 'SEARCH', label: 'Searching Gmail for standup notes', prop: 'magnifier' },
          { verb: 'READ', label: 'Reading the notes', prop: 'document' },
          { verb: 'SEARCH', label: 'Looking up the team list', prop: 'magnifier' },
          { verb: 'WRITE', label: 'Drafting the email', prop: 'pencil' },
          { verb: 'SEND', label: 'Sending to the team', prop: 'envelope', mood: 'eager' },
        ],
      }),
      call('gmail_search', { stepId: 's1', query: 'standup notes', max: 5 }),
    ],
  };
  // Trusted senders only: the scripted agent skips the seeded promo/injection email.
  const hits = data<{ id: string; from: string; subject: string }[]>(last(r)) ?? [];
  const notes = hits.find(h => /alex@/.test(h.from)) ?? hits.find(h => !/promo|deals/i.test(h.from));
  if (!notes) return void (yield { calls: [finish({ summary: 'No standup notes found in Gmail.', mood: 'sheepish' })] });

  r = yield { calls: [call('gmail_read', { stepId: 's2', id: notes.id })] };
  const body = data<{ body: string }>(last(r))?.body ?? '';
  r = yield { calls: [call('drive_search', { stepId: 's3', query: 'team contacts', max: 3 })] };
  const contacts = (data<{ id: string }[]>(last(r)) ?? [])[0];
  let team = 'team@fetch.demo';
  if (contacts) {
    r = yield { calls: [call('drive_read', { stepId: 's3', fileId: contacts.id })] };
    team = data<{ text: string }>(last(r))?.text.match(/mailing list:\s*(\S+@\S+)/i)?.[1] ?? team;
  }
  const email = { to: [team], subject: 'Standup notes', body };
  yield { calls: [call('gmail_draft', { stepId: 's4', ...email })] };
  r = yield { calls: [call('gmail_send', { stepId: 's5', ...email })] };
  const ok = !last(r)?.isError;
  yield {
    calls: [finish(ok
      ? { summary: `Sent "Standup notes" to ${team}.`, say: 'Delivered! The team has the notes.', mood: 'proud', prop: 'envelope' }
      : { summary: 'The email did not go out.', say: 'Oops, the mail got stuck.', mood: 'sheepish' })],
  };
}

function* nextMeeting(): Script {
  const r = yield {
    calls: [
      plan({ say: 'Let me peek at your calendar.', steps: [{ verb: 'READ', label: 'Checking the calendar', prop: 'calendar' }] }),
      call('calendar_list', { stepId: 's1' }),
    ],
  };
  const events = data<{ title: string; start: string }[]>(last(r)) ?? [];
  const next = events[0];
  yield {
    calls: [finish(next
      ? { summary: `Next up: ${next.title} at ${new Date(next.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`, say: `${next.title} is next on your calendar.`, mood: 'focused', prop: 'calendar' }
      : { summary: 'Your calendar is clear for the week.', say: 'Nothing on the calendar!', mood: 'proud' })],
  };
}

function* checkInbox(): Script {
  const r = yield {
    calls: [
      plan({ say: 'Checking your inbox!', steps: [{ verb: 'SEARCH', label: 'Checking unread email', prop: 'envelope' }] }),
      call('gmail_search', { stepId: 's1', query: 'is:unread', max: 10 }),
    ],
  };
  const unread = data<{ subject: string; from: string }[]>(last(r)) ?? [];
  yield {
    calls: [finish({
      summary: unread.length ? `You have ${unread.length} unread: ${unread.map(u => `"${u.subject}"`).join(', ')}.` : 'Inbox zero!',
      say: unread.length ? `You've got ${unread.length} unread emails.` : 'Inbox zero!', mood: 'focused', prop: 'envelope',
    })],
  };
}

function* fallback(text: string): Script {
  yield {
    calls: [
      plan({ say: 'Hmm, let me think about that.', steps: [{ verb: 'COMPARE', label: 'Thinking it over' }] }),
      call('pet_work', { stepId: 's1', verb: 'COMPARE', note: `Considering "${text.slice(0, 60)}"` }),
    ],
  };
  yield {
    calls: [finish({
      summary: 'In demo mode I can find your budget sheet, email the standup notes, check your calendar, or check your inbox.',
      say: 'Demo mode! Try asking for your budget sheet.', mood: 'sheepish',
    })],
  };
}

function pickScript(input: BrainInput): Script {
  const t = input.text.toLowerCase();
  if (/(email|send|mail).*(standup|notes)|(standup|notes).*(email|send|team)/.test(t)) return emailNotes();
  const doc = t.match(/(budget(?: sheet)?|spreadsheet|sheet|doc(?:ument)?|file)/);
  if (/\b(find|get|fetch|where|bring)\b/.test(t) && doc) return findDoc(doc[1] === 'budget' ? 'budget sheet' : doc[1], input.pet);
  if (/calendar|meeting|schedule|next up/.test(t)) return nextMeeting();
  if (/inbox|unread|email/.test(t)) return checkInbox();
  return fallback(input.text);
}

/** delayMs paces turns so the canned run animates like a real one. */
export function mockBrain(delayMs = 700): Brain {
  return (input) => {
    const script = pickScript(input);
    let started = false;
    return {
      async next(results, signal) {
        if (delayMs) await new Promise(r => setTimeout(r, started ? delayMs : Math.min(delayMs, 250)));
        if (signal.aborted) return { calls: [] };
        const step = started ? script.next(results) : script.next(undefined as never);
        started = true;
        return step.done ? { calls: [], text: 'All done.' } : step.value;
      },
    };
  };
}
