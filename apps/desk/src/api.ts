import type { ActionStep, Mode, RunEvent } from './contracts'

export interface ApprovalState {
  actionId: string
  runId: string
  kind: 'send_email' | 'delete' | 'share' | 'calendar_invite' | 'other'
  preview: { to?: string[]; subject?: string; body?: string; summary: string }
  contentHash: string
}

export interface RunState {
  id: string
  text: string
  status: 'queued' | 'running' | 'approval' | 'complete' | 'cancelled' | 'error'
  steps: ActionStep[]
  events: RunEvent[]
  startedAt: string
  summary?: string
}

export interface NotificationItem {
  id: string
  kind: 'email' | 'meeting'
  title: string
  detail: string
  time: string
  unread: boolean
}

export interface SettingsState {
  voiceEnabled: boolean
  volume: number
  inputMode: 'ptt' | 'hands-free'
  quality: 'high' | 'low'
  reduceMotion: boolean
  subtitles: boolean
  sketchyShader: boolean
  demoMode: boolean
}

export interface SessionState { userName: string; connected: { gmail: boolean; calendar: boolean; drive: boolean } }

export const defaultSettings: SettingsState = { voiceEnabled: true, volume: 75, inputMode: 'ptt', quality: 'high', reduceMotion: false, subtitles: true, sketchyShader: false, demoMode: true }

export class FetchApiClient {
  constructor(private readonly baseUrl = '') {}

  async setMode(mode: Mode) {
    try { await fetch(`${this.baseUrl}/mode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) }) } catch { /* mock mode stays local */ }
    return { mode }
  }

  async runAgent(petId: string, text: string, onEvent: (event: RunEvent) => void): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/agent/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ petId, text }) })
      if (response.ok) { const data = await response.json() as { runId: string }; this.subscribe(data.runId, onEvent); return data.runId }
    } catch { /* fall through to demo stream */ }
    const runId = `demo-run-${Date.now()}`
    const wantsApproval = /\b(send|email|share|delete|invite)\b/i.test(text)
    const steps: ActionStep[] = [{ id: `${runId}-1`, verb: /budget|sheet|file|find/i.test(text) ? 'SEARCH' : 'READ', mood: 'focused', label: /budget|sheet|file|find/i.test(text) ? 'Searching your workspace' : 'Reading the request', prop: { kind: 'preset', name: 'magnifier' } }]
    if (wantsApproval) steps.push({ id: `${runId}-2`, verb: 'SEND', mood: 'worried', label: 'Preparing a message', prop: { kind: 'preset', name: 'envelope' } })
    const preview = { to: ['team@fetch.test'], subject: 'Standup notes', body: 'Here are the latest standup notes from Fetch.', summary: 'Send the standup notes to your team.' }
    const events: Array<[number, RunEvent]> = [
      [80, { type: 'run.started', runId }],
      [250, { type: 'run.plan', steps }],
      [720, { type: 'run.say', text: wantsApproval ? 'I found the thread. One quick check before I send it.' : 'I’m on it — let me look through your workspace.' }],
      [1150, { type: 'tool.start', stepId: steps[0].id, tool: 'drive.search', label: steps[0].label }],
      [1700, { type: 'tool.progress', stepId: steps[0].id, note: 'Read 12 matching items', itemsRead: 12 }],
      [2200, { type: 'tool.end', stepId: steps[0].id, ok: true }],
    ]
    if (wantsApproval) events.push([2700, { type: 'approval.required', actionId: `${runId}-approval`, kind: 'send_email', preview, contentHash: 'demo-hash-standup' }])
    else events.push([2700, { type: 'run.result', summary: 'Found Budget · Q4 2025 in My Drive.', mood: 'proud', prop: { kind: 'preset', name: 'document' } }])
    for (const [delay, event] of events) window.setTimeout(() => onEvent(event), delay)
    return runId
  }

  private subscribe(runId: string, onEvent: (event: RunEvent) => void) {
    const source = new EventSource(`${this.baseUrl}/agent/runs/${runId}/events`)
    source.onmessage = (message) => { try { onEvent(JSON.parse(message.data) as RunEvent) } catch { /* ignore malformed event */ } }
    source.onerror = () => source.close()
  }

  async approve(runId: string, actionId: string, contentHash: string) { try { await fetch(`${this.baseUrl}/agent/runs/${runId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId, contentHash }) }) } catch { /* demo approval */ } }
  async cancel(runId: string) { try { await fetch(`${this.baseUrl}/agent/runs/${runId}/cancel`, { method: 'POST' }) } catch { /* demo cancel */ } }
  async getSession(): Promise<SessionState> { return { userName: 'Vince Ong', connected: { gmail: true, calendar: true, drive: true } } }
  async getNotifications(): Promise<NotificationItem[]> { return [{ id: 'notice-1', kind: 'email', title: 'New unread email', detail: 'Alex Morgan · Standup notes', time: '9:42 AM', unread: true }, { id: 'notice-2', kind: 'meeting', title: 'Upcoming meeting', detail: 'Product sync · in 18 min', time: '10:30 AM', unread: true }, { id: 'notice-3', kind: 'email', title: 'Your inbox is tidy', detail: 'No other urgent messages', time: 'Just now', unread: false }] }
}
