import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { Bell, CalendarDays, Check, ChevronDown, CircleHelp, Clock3, ExternalLink, FileText, Inbox, LayoutGrid, Mail, Mic, MoreHorizontal, PawPrint, Plus, Search, Send, Settings, Sparkles, SlidersHorizontal, Trash2, Volume2, X } from 'lucide-react'
import type { LocalIntent, Mode, PetBundle, PlatformRect, RunEvent } from './contracts'
import { DeskEngine } from './engine/deskEngine'
import { CreatePetFlow } from './create/CreatePetFlow'
import { PetSwitcher, ServerPill } from './pets/PetSwitcher'
import { usePetSync } from './pets/usePetSync'
import { getSpeechRecognition, speakWithBrowserTts, unlockMicrophone } from './voice'
import { FetchApiClient, type ApprovalState, type NotificationItem, type RunState, type SettingsState } from './api'
import { useFetchStore } from './store'

const demoPet: PetBundle = {
  id: 'demo-parrot', name: 'Pip', species: 'bird', thumbnailUrl: '',
  splatUrl: '', rigUrl: '', weightsUrl: '',
  personality: { eager: .8, sassy: .35, anxious: .2, chatty: .92 },
  stats: { energy: 82, happiness: 91, hunger: 24 }, createdAt: new Date().toISOString(),
}

const windows = [
  { id: 'inbox', title: 'Inbox', eyebrow: 'Communication', icon: Inbox, className: 'window-inbox' },
  { id: 'files', title: 'Files', eyebrow: 'Your workspace', icon: FileText, className: 'window-files' },
  { id: 'calendar', title: 'Calendar', eyebrow: 'Today · Tue 14', icon: CalendarDays, className: 'window-calendar' },
]
type DeskRect = PlatformRect & { zIndex?: number }
const initialWindowRects: Record<string, DeskRect> = {
  inbox: { id: 'inbox', x: 50, y: 89, w: 265, h: 215, kind: 'window' },
  files: { id: 'files', x: 72, y: 328, w: 294, h: 190, kind: 'window' },
  calendar: { id: 'calendar', x: 0, y: 100, w: 263, h: 170, kind: 'window' },
}

function App() {
  const store = useFetchStore(demoPet)
  const { state: appState, setMode, addRun, updateRun, addApproval, removeApproval, setNotifications, updateSettings, setVoice } = store
  const mode = appState.mode
  const petSync = usePetSync(store)
  const pet = appState.pets.find((item) => item.id === appState.activePetId) ?? null
  const [activeWindow, setActiveWindow] = useState('inbox')
  const [toast, setToast] = useState('')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [awake, setAwake] = useState(false)
  const listening = appState.voice.listening
  const speaking = appState.voice.speaking
  const [command, setCommand] = useState('')
  const [showRunLog, setShowRunLog] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [playLoading, setPlayLoading] = useState(false)
  const [windowRects, setWindowRects] = useState(initialWindowRects)
  const [windowOrder, setWindowOrder] = useState(['inbox', 'files', 'calendar'])
  const api = useMemo(() => new FetchApiClient(), [])
  const engine = useMemo(() => new DeskEngine(), [])
  const mainCanvas = useRef<HTMLCanvasElement>(null)
  const peekCanvas = useRef<HTMLCanvasElement>(null)
  const recognition = useRef<ReturnType<typeof getSpeechRecognition>>(null)

  const openPlay = () => {
    if (playLoading) return
    setPlayLoading(true)
    const petId = encodeURIComponent(pet?.id ?? 'dog')
    const configuredOrigin = (import.meta.env.VITE_PLAY_APP_URL as string | undefined)?.replace(/\/$/, '')
    const origin = configuredOrigin || (import.meta.env.DEV ? 'http://localhost:5174' : '')
    window.setTimeout(() => { location.href = `${origin}/camera.html?pet=${petId}` }, 1250)
  }

  const setListening = (value: boolean) => setVoice({ listening: value })
  const setSpeaking = (value: boolean) => setVoice({ speaking: value })
  const setMicAvailable = (value: boolean) => setVoice({ micAvailable: value })
  const openNotifications = () => { if (mode === 'play') { setToast('Notifications are off in Play mode'); return } setShowNotifications(true); void api.getNotifications().then(setNotifications) }

  useEffect(() => {
    if (mainCanvas.current && peekCanvas.current) engine.mount(mainCanvas.current, peekCanvas.current)
    if (pet) engine.loadPet(pet)
  }, [engine, pet])

  useEffect(() => {
    const worldWidth = document.querySelector('.canvas-world')?.clientWidth ?? 900
    const rects = Object.values(windowRects).map((rect) => ({ ...rect, x: rect.id === 'calendar' ? Math.max(20, worldWidth - rect.w - 40) : rect.x }))
    engine.setPlatforms(rects)
  }, [engine, windowRects])

  const setDeskMode = (next: Mode) => {
    const activeRun = appState.runs.find((run) => run.status === 'running' || run.status === 'approval')
    if (activeRun) { setToast('Pip will finish the current errand before switching modes'); return }
    setMode(next); engine.setMode(next); void api.setMode(next)
    setToast(next === 'work' ? 'Work mode on · your connectors are ready' : 'Play mode on · connectors are tucked away')
    window.setTimeout(() => setToast(''), 2800)
  }

  const runLocalCommand = (text: string): LocalIntent | 'mode:work' | 'mode:play' | 'feed' | null => {
    const normalized = text.toLowerCase().trim()
    const matches: [string, LocalIntent][] = [['roll over', 'roll_over'], ['play dead', 'play_dead'], ['fetch the ball', 'fetch_ball'], ['get the ball', 'fetch_ball'], ['wake up', 'wake'], ['sit', 'sit'], ['stay', 'stay'], ['come', 'come'], ['speak', 'speak'], ['spin', 'spin'], ['shake', 'shake'], ['dance', 'dance'], ['hide', 'hide'], ['sleep', 'sleep'], ['stop', 'stop']]
    if (normalized.includes('work mode')) return 'mode:work'
    if (normalized.includes('play time') || normalized.includes('play mode')) return 'mode:play'
    if (['treat', 'feed you', 'dinner'].some((phrase) => normalized.includes(phrase))) return 'feed'
    return matches.find(([phrase]) => normalized === phrase || normalized.includes(phrase))?.[1] ?? null
  }

  const speak = (text: string) => {
    setSpeaking(true)
    speakWithBrowserTts(text, (amplitude) => engine.setSpeaking(amplitude), () => setSpeaking(false))
  }

  const handleCommand = (text: string) => {
    const local = runLocalCommand(text)
    if (local === 'mode:work' || local === 'mode:play') { setDeskMode(local === 'mode:work' ? 'work' : 'play'); return }
    if (local === 'feed') { engine.doIntent('trick'); setToast(`${pet?.name ?? 'Your pet'} got a treat`); return }
    if (local) { engine.doIntent(local); setToast(`${pet?.name ?? 'Your pet'} will ${local.replace('_', ' ')}`); return }
    if (mode === 'play') { speak('It is playtime. Ask me to chase, fetch, or dance.'); setToast('Play mode keeps work errands tucked away'); return }
    void runAgent(text)
  }

  const handleRunEvent = (runId: string, event: RunEvent) => {
    if (event.type === 'run.started') updateRun(runId, { status: 'running', events: [event] })
    if (event.type === 'run.plan') { engine.runPlan(event.steps); updateRun(runId, { status: 'running', steps: event.steps, events: [event] }) }
    if (event.type === 'run.say') speak(event.text)
    if (event.type === 'tool.start' || event.type === 'tool.progress' || event.type === 'tool.retry' || event.type === 'tool.end') { engine.pushToolEvent(event); updateRun(runId, { events: [event] }) }
    if (event.type === 'approval.required') { engine.pushToolEvent(event); engine.setApprovalPending(true); addApproval({ ...event, runId }); updateRun(runId, { status: 'approval', events: [event] }); setToast('Pip is waiting for your approval') }
    if (event.type === 'run.result') { engine.pushToolEvent(event); updateRun(runId, { status: 'complete', summary: event.summary, events: [event] }); setToast(event.summary) }
    if (event.type === 'run.error') { engine.pushToolEvent(event); updateRun(runId, { status: 'error', summary: event.message, events: [event] }); setToast(event.message) }
    if (event.type === 'run.cancelled') { engine.pushToolEvent(event); updateRun(runId, { status: 'cancelled', events: [event] }) }
  }

  const runAgent = async (text: string) => {
    if (mode === 'play') { speak('It is playtime. Ask me to chase, fetch, or dance.'); setToast('Play mode keeps work errands tucked away'); return }
    let runId = ''
    runId = await api.runAgent(pet?.id ?? demoPet.id, text, (event) => handleRunEvent(runId || (event.type === 'run.started' ? event.runId : ''), event))
    addRun({ id: runId, text, status: 'queued', steps: [], events: [], startedAt: new Date().toISOString() })
    setShowRunLog(true)
  }

  const startListening = () => {
    if (speaking) return
    if (!recognition.current) recognition.current = getSpeechRecognition()
    if (!recognition.current) { setToast('Voice input needs Chrome — use the command bar instead'); return }
    recognition.current.onresult = (event) => { const transcript = event.results[0][0].transcript; setCommand(transcript); handleCommand(transcript) }
    recognition.current.onend = () => setListening(false)
    recognition.current.onerror = () => { setListening(false); setToast('I couldn’t catch that — try again or type it') }
    try { recognition.current.start(); setListening(true) } catch { setListening(false) }
  }

  const stopListening = () => { recognition.current?.stop(); setListening(false) }

  const sendCommand = () => {
    const trimmed = command.trim()
    if (!trimmed) return
    handleCommand(trimmed); setCommand('')
    window.setTimeout(() => setToast(''), 2200)
  }

  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.code === 'Space' && !event.repeat && document.activeElement?.tagName !== 'INPUT') { event.preventDefault(); startListening() } }
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') stopListening() }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  })
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setShowRunLog(false); setShowNotifications(false); setShowSettings(false); setShowOnboarding(false) } }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  return <div className={`app-shell theme-${appState.settings.theme} ${appState.settings.reduceMotion ? 'reduce-motion' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><PawPrint size={18} /></span><span>fetch</span><span className="brand-dot" /></div>
      <div className="workspace-label">Your desk</div>
      <nav className="nav-list" aria-label="Primary navigation">
        <button className="nav-item active"><LayoutGrid size={17} /> Desk <span className="nav-hotkey">⌘1</span></button>
        <button className="nav-item" onClick={openNotifications}><Bell size={17} /> Notifications <span className="badge">{appState.notifications.filter((item) => item.unread).length || 3}</span></button>
      </nav>
      <div className="sidebar-divider" />
      <div className="workspace-label">Pets</div>
      <PetSwitcher pets={appState.pets} activePet={pet} sync={petSync} onCreate={() => setShowOnboarding(true)} />
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setShowSettings(true)}><Settings size={17} /> Settings</button><button className="nav-item"><CircleHelp size={17} /> Help center</button><div className="profile"><span className="profile-avatar">VO</span><span><strong>Vince Ong</strong><small>Personal workspace</small></span><MoreHorizontal size={16} /></div></div>
    </aside>

    <main className="desk" onClick={() => setActiveWindow('desk')}>
      <header className="topbar">
        <div className="breadcrumb"><span>Desk</span><span className="slash">/</span><span className="muted">Tuesday, October 14</span></div>
        <div className="top-actions"><ServerPill status={petSync.status} mockGen={petSync.mockGen} /><span className="connection-pill"><span className="online-dot" /> All systems good</span><button className="icon-button" aria-label="Search"><Search size={18} /></button><button className="icon-button" aria-label="Notifications" onClick={openNotifications}><Bell size={18} /><span className="notification-dot" /></button></div>
      </header>
      <section className="desk-canvas" aria-label="Fetch Desk workspace">
        <div className="desk-heading"><div><span className="eyebrow">Good morning, Vince</span><h1>What should we fetch?</h1></div><div className="mode-switch" role="group" aria-label="Mode"><button className={mode === 'work' ? 'selected' : ''} onClick={(e) => { e.stopPropagation(); setDeskMode('work') }}>Work</button><button className={mode === 'play' ? 'selected play-selected' : ''} onClick={(e) => { e.stopPropagation(); openPlay() }}><Sparkles size={14} /> Play</button></div></div>
        {mode === 'play' && <div className="connectors-banner"><Sparkles size={14} /><span><strong>Play mode</strong> · Gmail, Drive, and Calendar are taking a nap.</span><button onClick={() => setDeskMode('work')}>Return to Work</button></div>}
        <div className={`command-bar ${listening ? 'listening' : ''} ${speaking ? 'speaking' : ''}`} onClick={(e) => e.stopPropagation()}><button className="command-icon mic-button" onClick={listening ? stopListening : startListening} aria-label={listening ? 'Stop listening' : 'Start listening'}><Mic size={19} /></button><input value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendCommand()} placeholder={listening ? 'Listening…' : mode === 'work' ? 'Ask Pip to find, read, or organise something…' : 'Tell Pip what to play…'} aria-label="Command Pip" /><span className="command-hint">{listening ? 'Listening' : <>Hold <kbd>Space</kbd> to talk</>}</span><button className="command-submit" onClick={sendCommand} aria-label="Send command"><ChevronDown size={18} className="send-chevron" /></button></div>
        <div className="canvas-world">
          <div className="sun-wash" /><div className="world-note"><span className="note-pin" /> Pip is perched on your Desk <button aria-label="Dismiss note">×</button></div>
          {windows.map(({ id, title, eyebrow, icon: Icon, className }) => <DeskWindow key={id} id={id} title={title} eyebrow={eyebrow} Icon={Icon} className={className} rect={windowRects[id]} zIndex={windowOrder.indexOf(id) + 2} active={activeWindow === id} onActivate={() => { setActiveWindow(id); setWindowOrder((order) => [...order.filter((item) => item !== id), id]) }} onRectChange={(rect) => setWindowRects((current) => ({ ...current, [id]: { ...current[id], ...rect } }))} mode={mode} />)}
          <div className="pet-stage" aria-label={`${pet?.name ?? 'Your pet'} is perched on the desk`}><div className="pet-shadow" /><div className="pet-glow" /><div className="pet-illustration">{pet?.species === 'bird' ? '✦' : '◒'}</div>{appState.settings.subtitles && <div className="pet-bubble">{mode === 'work' ? 'Ready when you are.' : 'Play with me!'}</div>}<div className="pet-nameplate"><span className="status-dot" />{pet?.name ?? 'New pet'} <span>·</span> <span className="muted">{engine.getStatus()}</span></div></div>
          <canvas ref={mainCanvas} className="desk-engine-canvas" aria-hidden="true" />
          <button className="peek-dock" onClick={(e) => { e.stopPropagation(); setShowRunLog(true) }}><div className="peek-header"><span><span className="peek-live" /> Peek</span><span className="peek-open-label">Open log ↗</span></div><canvas ref={peekCanvas} /><div className="peek-scene"><span className="peek-pet">✦</span><span className="peek-copy"><strong>{appState.runs[0]?.status === 'running' ? 'Pip is on it' : 'Run log is ready'}</strong><small>{appState.runs[0]?.status === 'running' ? 'Working in the background' : 'Click to see recent errands'}</small></span></div></button>
        </div>
        <div className="desk-footer"><div className="tray treat-tray"><span className="tray-icon">✺</span><span><strong>Treat tray</strong><small>Drag to Pip</small></span><span className="treats">● ● ●</span></div><div className="tray toy-tray"><span className="tray-icon">◉</span><span><strong>Toy box</strong><small>Make playtime</small></span><span className="toys">◌ ◇</span></div><div className="desk-tip"><Sparkles size={14} /> Try “find my budget sheet”</div></div>
      </section>
    </main>
    {toast && <div className="toast"><span className="toast-check">✓</span>{toast}</div>}
    {!awake && <button className="wake-button" onClick={async () => { const available = await unlockMicrophone(); setMicAvailable(available); setAwake(true); setToast(available ? 'Audio unlocked · Pip is listening' : 'Audio unlocked · mic permission is still needed') }}><Volume2 size={17} /> Wake up Pip</button>}
    {showOnboarding && <CreatePetFlow engine={engine} serverStatus={petSync.status} onCreated={petSync.created} onFinished={(newPet) => { setShowOnboarding(false); setToast(`${newPet.name} is ready to meet you`); window.setTimeout(() => setToast(''), 3200) }} onClose={() => setShowOnboarding(false)} />}
    {appState.approvals[0] && <ApprovalCard approval={appState.approvals[0]} onApprove={async () => { const approval = appState.approvals[0]; await api.approve(approval.runId, approval.actionId, approval.contentHash); removeApproval(approval.actionId); engine.setApprovalPending(false); updateRun(approval.runId, { status: 'complete', summary: 'Approved and sent.', events: [{ type: 'run.result', summary: 'Approved and sent.', mood: 'proud' }] }); setToast('Approved · Pip sent it') }} onCancel={async () => { const approval = appState.approvals[0]; await api.cancel(approval.runId); removeApproval(approval.actionId); engine.setApprovalPending(false); updateRun(approval.runId, { status: 'cancelled' }); setToast('Cancelled · nothing was sent') }} />}
    {showRunLog && <RunLogPanel runs={appState.runs} onClose={() => setShowRunLog(false)} onCancel={async (runId) => { await api.cancel(runId); updateRun(runId, { status: 'cancelled' }); setToast('Errand cancelled') }} />}
    {showNotifications && <NotificationsPanel notifications={appState.notifications} onClose={() => setShowNotifications(false)} />}
    {showSettings && <SettingsPanel settings={appState.settings} onChange={updateSettings} onClose={() => setShowSettings(false)} />}
    {playLoading && <div className="play-loading" role="status" aria-live="polite"><div className="play-loading-card"><div className="loader-dog" aria-hidden="true">🐕</div><p className="loader-kicker">Pip is getting ready</p><h2>Opening play room</h2><div className="loader-track"><span className="loader-progress" /><span className="loader-walker" aria-hidden="true">🐕</span></div><small>Setting out the toys and making space to roam</small></div></div>}
  </div>
}

function DeskWindow({ id, title, eyebrow, Icon, className, rect, zIndex, active, onActivate, onRectChange, mode }: { id: string; title: string; eyebrow: string; Icon: typeof Inbox; className: string; rect: DeskRect; zIndex: number; active: boolean; onActivate: () => void; onRectChange: (rect: Partial<DeskRect>) => void; mode: Mode }) {
  const dragStart = useRef<{ x: number; y: number; rect: DeskRect; resize: boolean } | null>(null)
  const beginPointer = (event: PointerEvent<HTMLElement>, resize = false) => { event.stopPropagation(); event.preventDefault(); onActivate(); dragStart.current = { x: event.clientX, y: event.clientY, rect, resize }; (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId) }
  const movePointer = (event: PointerEvent<HTMLElement>) => { const start = dragStart.current; if (!start) return; const dx = event.clientX - start.x; const dy = event.clientY - start.y; if (start.resize) onRectChange({ w: Math.max(220, start.rect.w + dx), h: Math.max(150, start.rect.h + dy) }); else onRectChange({ x: Math.max(8, start.rect.x + dx), y: Math.max(55, start.rect.y + dy) }) }
  const endPointer = () => { dragStart.current = null }
  return <article className={`desk-window ${className} ${active ? 'active' : ''} ${mode === 'play' ? 'dimmed' : ''}`} style={{ left: rect.id === 'calendar' ? undefined : rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex }} onClick={(e) => { e.stopPropagation(); onActivate() }} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer}><div className="window-top" onPointerDown={(e) => beginPointer(e)}><div className="window-title"><span className="window-icon"><Icon size={16} /></span><span><small>{eyebrow}</small><strong>{title}</strong></span></div><button className="window-menu" aria-label={`${title} menu`}><MoreHorizontal size={17} /></button></div>{id === 'inbox' && <div className="window-body inbox-body"><div className="mail-row unread"><span className="mail-avatar blue">AM</span><span><strong>Alex Morgan</strong><small>Standup notes · 9:42 AM</small></span><span className="mail-dot" /></div><div className="mail-row"><span className="mail-avatar peach">JT</span><span><strong>Jamie Tan</strong><small>Re: launch checklist</small></span></div><div className="mail-row"><span className="mail-avatar lilac">NS</span><span><strong>Notion</strong><small>Your weekly digest</small></span></div><div className="window-link">Open inbox <span>↗</span></div></div>}{id === 'files' && <div className="window-body file-body"><div className="file-hero"><FileText size={18} /><span><strong>Budget · Q4 2025</strong><small>Updated 12 minutes ago</small></span><span className="file-chip">XLSX</span></div><div className="file-line" /><div className="file-small"><span>My Drive</span><span>24 items <ChevronDown size={13} /></span></div><div className="window-link">Open files <span>↗</span></div></div>}{id === 'calendar' && <div className="window-body calendar-body"><div className="calendar-event"><span className="event-time">10:30</span><span className="event-line" /><span><strong>Product sync</strong><small>Google Meet · 30 min</small></span></div><div className="calendar-event next"><span className="event-time">14:00</span><span className="event-line" /><span><strong>Focus time</strong><small>Deep work block</small></span></div><div className="window-link">Open calendar <span>↗</span></div></div>}<button className="window-resize" aria-label={`Resize ${title}`} onPointerDown={(e) => beginPointer(e, true)} onPointerMove={movePointer} onPointerUp={endPointer}>⌟</button></article>
}

function ApprovalCard({ approval, onApprove, onCancel }: { approval: ApprovalState; onApprove: () => void; onCancel: () => void }) {
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Enter') onApprove(); if (event.key === 'Escape') onCancel() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onApprove, onCancel])
  return <div className="approval-layer"><section className="approval-card" role="dialog" aria-modal="true" aria-labelledby="approval-title"><div className="approval-kicker"><span className="approval-icon"><Send size={17} /></span><span>Human approval needed</span><button className="panel-close" onClick={onCancel} aria-label="Cancel approval"><X size={17} /></button></div><h2 id="approval-title">Send this for me?</h2><p className="approval-summary">{approval.preview.summary}</p><div className="approval-preview"><div><small>To</small><strong>{approval.preview.to?.join(', ')}</strong></div><div><small>Subject</small><strong>{approval.preview.subject}</strong></div><div><small>Message</small><p>{approval.preview.body}</p></div></div><div className="approval-actions"><button className="secondary-action" onClick={onCancel}>Cancel</button><button className="approve-action" onClick={onApprove}><span className="bone-mark">✦</span> Approve & send</button></div><small className="approval-footnote">Pip can only send the exact preview shown above.</small></section></div>
}

function RunLogPanel({ runs, onClose, onCancel }: { runs: RunState[]; onClose: () => void; onCancel: (runId: string) => void }) {
  return <div className="panel-layer"><aside className="side-panel run-panel" role="dialog" aria-labelledby="run-log-title"><PanelHeader icon={<Clock3 size={17} />} eyebrow="Live activity" title="Run log" onClose={onClose} />{runs.length === 0 ? <EmptyPanel title="No errands yet" text="Ask Pip to find, read, or organise something from the command bar." /> : <div className="run-list">{runs.map((run) => <article className="run-item" key={run.id}><div className="run-item-top"><span className={`run-status ${run.status}`} /> <strong>{run.text}</strong><span className="run-time">{run.status === 'running' ? 'Now' : run.status}</span></div><div className="run-steps">{run.steps.length ? run.steps.map((step) => <div className="run-step" key={step.id}><span className="step-check">{run.status === 'running' ? '·' : '✓'}</span><span>{step.label}</span><small>{step.verb}</small></div>) : <div className="run-step"><span className="step-check">·</span><span>Making a plan…</span></div>}</div>{run.summary && <p className="run-summary">{run.summary}</p>}{(run.status === 'running' || run.status === 'approval') && <button className="cancel-run" onClick={() => onCancel(run.id)}>Cancel errand</button>}</article>)}</div>}<div className="queue-tray"><Sparkles size={15} /><span><strong>Queue tray</strong><small>{runs.filter((run) => run.status === 'queued').length ? `${runs.filter((run) => run.status === 'queued').length} next up` : 'Ready for the next command'}</small></span></div></aside></div>
}

function NotificationsPanel({ notifications, onClose }: { notifications: NotificationItem[]; onClose: () => void }) {
  return <div className="panel-layer"><aside className="side-panel notifications-panel" role="dialog" aria-labelledby="notifications-title"><PanelHeader icon={<Bell size={17} />} eyebrow="Work mode" title="Notifications" onClose={onClose} />{notifications.length === 0 ? <EmptyPanel title="Nothing new" text="Fetch will surface unread mail and upcoming meetings here." /> : <div className="notification-list">{notifications.map((item) => <article className={`notification-item ${item.unread ? 'unread' : ''}`} key={item.id}><span className={`notification-icon ${item.kind}`} >{item.kind === 'email' ? <Mail size={15} /> : <CalendarDays size={15} />}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{item.time}</time></article>)}</div>}<p className="panel-note">Pip reacts to work notifications on the Desk. Play mode keeps them quiet.</p></aside></div>
}

function SettingsPanel({ settings, onChange, onClose }: { settings: SettingsState; onChange: (patch: Partial<SettingsState>) => void; onClose: () => void }) {
  return <div className="panel-layer"><aside className="side-panel settings-panel" role="dialog" aria-labelledby="settings-title"><PanelHeader icon={<Settings size={17} />} eyebrow="Personalise Fetch" title="Settings" onClose={onClose} /><div className="settings-group"><h3>Voice</h3><SettingToggle label="Voice replies" description="Let Pip speak short updates" checked={settings.voiceEnabled} onChange={(checked) => onChange({ voiceEnabled: checked })} /><label className="setting-row"><span><strong>Volume</strong><small>Pet speech and sound effects</small></span><input type="range" min="0" max="100" value={settings.volume} onChange={(event) => onChange({ volume: Number(event.target.value) })} /><b>{settings.volume}</b></label><div className="setting-row"><span><strong>Input mode</strong><small>How Fetch listens for commands</small></span><div className="segmented"><button className={settings.inputMode === 'ptt' ? 'selected' : ''} onClick={() => onChange({ inputMode: 'ptt' })}>Push to talk</button><button className={settings.inputMode === 'hands-free' ? 'selected' : ''} onClick={() => onChange({ inputMode: 'hands-free' })}>Hands-free</button></div></div></div><div className="settings-group"><h3>Desk & pet</h3><div className="setting-row"><span><strong>Visual quality</strong><small>Splats and animation detail</small></span><div className="segmented"><button className={settings.quality === 'high' ? 'selected' : ''} onClick={() => onChange({ quality: 'high' })}>High</button><button className={settings.quality === 'low' ? 'selected' : ''} onClick={() => onChange({ quality: 'low' })}>Low</button></div></div><div className="setting-row"><span><strong>Theme</strong><small>Choose the Desk atmosphere</small></span><div className="segmented"><button className={settings.theme === 'light' ? 'selected' : ''} onClick={() => onChange({ theme: 'light' })}>Light</button><button className={settings.theme === 'dark' ? 'selected' : ''} onClick={() => onChange({ theme: 'dark' })}>Dark</button></div></div><SettingToggle label="Subtitles" description="Show captions for pet speech" checked={settings.subtitles} onChange={(checked) => onChange({ subtitles: checked })} /><SettingToggle label="Reduce motion" description="Use calmer Desk transitions" checked={settings.reduceMotion} onChange={(checked) => onChange({ reduceMotion: checked })} /><SettingToggle label="Sketchy shader" description="Give drawings a paper-grain edge" checked={settings.sketchyShader} onChange={(checked) => onChange({ sketchyShader: checked })} /></div><div className="settings-group danger-group"><h3>Data</h3><button className="delete-data"><Trash2 size={15} /> Delete my data <span>↗</span></button><small>Demo mode is on · no real accounts or messages are connected.</small></div></aside></div>
}

function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-row"><span><strong>{label}</strong><small>{description}</small></span><button className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} aria-pressed={checked}><span /></button></label>
}

function PanelHeader({ icon, eyebrow, title, onClose }: { icon: ReactNode; eyebrow: string; title: string; onClose: () => void }) {
  return <div className="panel-header"><span className="panel-icon">{icon}</span><span><small>{eyebrow}</small><strong id={title === 'Run log' ? 'run-log-title' : title === 'Notifications' ? 'notifications-title' : 'settings-title'}>{title}</strong></span><button className="panel-close" onClick={onClose} aria-label={`Close ${title}`}><X size={17} /></button></div>
}

function EmptyPanel({ title, text }: { title: string; text: string }) { return <div className="empty-panel"><Sparkles size={22} /><strong>{title}</strong><p>{text}</p></div> }

export default App
