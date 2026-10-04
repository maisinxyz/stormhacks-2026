import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { Bell, CalendarDays, CircleHelp, Clock3, FileText, Inbox, LayoutGrid, Mail, Mic, MoreHorizontal, PawPrint, Search, Send, Settings, Sparkles, Sun, Feather, Trash2, Volume2, X } from './icons'
import { AmbientWorld, Companion, DeskSuggestions, HoldToApprove, Mascot, PawSkeleton, PawTrail, PeekScene, TreatTray, Waveform, useCondensedHeader } from './DeskLife'
import { DeskWindow, type DeskRect } from './DeskWindow'
import { MagneticButton, MotionProvider, Reveal, useDialogFocus, usePlatforms, useRipples } from './motion'
import type { LocalIntent, Mode, PetBundle, RunEvent } from './contracts'
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
const initialWindowRects: Record<string, DeskRect> = {
  inbox: { id: 'inbox', x: 32, y: 106, w: 282, h: 278, kind: 'window' },
  files: { id: 'files', x: 68, y: 398, w: 295, h: 214, kind: 'window' },
  calendar: { id: 'calendar', x: 0, y: 140, w: 270, h: 272, kind: 'window' },
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
  const [showHelp, setShowHelp] = useState(false)
  const [noteVisible, setNoteVisible] = useState(true)
  const [petReaction, setPetReaction] = useState(0)
  const [petLine, setPetLine] = useState('Ready when you are.')
  const root = useRef<HTMLDivElement>(null)
  const commandInput = useRef<HTMLInputElement>(null)
  const prefersCalm = useReducedMotion()
  const calm = !!prefersCalm || appState.settings.reduceMotion
  const condensed = useCondensedHeader()
  const [windowRects, setWindowRects] = useState(initialWindowRects)
  const [windowOrder, setWindowOrder] = useState(['inbox', 'files', 'calendar'])
  const api = useMemo(() => new FetchApiClient(), [])
  const engine = useMemo(() => new DeskEngine(), [])
  const mainCanvas = useRef<HTMLCanvasElement>(null)
  const peekCanvas = useRef<HTMLCanvasElement>(null)
  const recognition = useRef<ReturnType<typeof getSpeechRecognition>>(null)
  usePlatforms(engine, mainCanvas)
  useRipples(root, calm)
  useDialogFocus(appState.approvals[0]?.actionId || (showOnboarding ? 'onboarding' : showRunLog ? 'log' : showNotifications ? 'notifications' : showSettings ? 'settings' : showHelp ? 'help' : ''))
  const feedPet = () => { engine.doIntent('trick'); setPetReaction(value => value + 1); setPetLine('For me? You shouldn’t have. ♡'); setToast(`${pet?.name ?? 'Your pet'} got a treat`) }
  const chooseSuggestion = (text: string) => { setCommand(text); commandInput.current?.focus({ preventScroll: true }); commandInput.current?.scrollIntoView({ behavior: calm ? 'instant' : 'smooth', block: 'center' }) }

  const openPlay = () => {
    if (playLoading) return
    const activeRun = appState.runs.find(run => run.status === 'running' || run.status === 'approval')
    if (activeRun) { setToast('Pip will finish the current errand before switching modes'); return }
    setDeskMode('play')
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

  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 5000); return () => window.clearTimeout(timer) }, [toast])
  useEffect(() => { if (petLine === 'Ready when you are.') return; const timer = window.setTimeout(() => setPetLine('Ready when you are.'), 6500); return () => window.clearTimeout(timer) }, [petLine])

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
    setPetLine(text)
    if (!appState.settings.voiceEnabled) return
    stopListening()
    setSpeaking(true)
    speakWithBrowserTts(text, (amplitude) => engine.setSpeaking(amplitude), () => setSpeaking(false))
  }

  const handleCommand = (text: string) => {
    const local = runLocalCommand(text)
    if (local === 'mode:work' || local === 'mode:play') { setDeskMode(local === 'mode:work' ? 'work' : 'play'); return }
    if (local === 'feed') { feedPet(); return }
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
    if (event.type === 'run.error') { engine.pushToolEvent(event); setPetLine('A little ruffled. Let’s try again.'); updateRun(runId, { status: 'error', summary: event.message, events: [event] }); setToast(event.message) }
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
    const down = (event: KeyboardEvent) => { if (event.code === 'Space' && !event.repeat && !(event.target as HTMLElement).closest('input, textarea, button, select, [contenteditable], [role="dialog"]')) { event.preventDefault(); startListening() } }
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') stopListening() }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  })
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setShowRunLog(false); setShowNotifications(false); setShowSettings(false); setShowOnboarding(false); setShowHelp(false) } }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  return <MotionProvider reduced={calm}><div ref={root} className={`app-shell mode-${mode} theme-${appState.settings.theme} ${calm ? 'reduce-motion' : ''}`}>
    <a className="skip-link" href="#command-input">Skip to command bar</a><div className="theme-wash" aria-hidden="true"/>
    <motion.aside className="sidebar" initial={calm ? false : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .3 }}>
      <a className="brand" href="#" aria-label="Fetch Desk"><span className="brand-mark"><PawPrint size={25}/></span><span>fetch<span className="brand-period">.</span></span></a>
      <div className="workspace-label">Your little workspace</div>
      <nav className="nav-list" aria-label="Primary navigation"><button className="nav-item active" aria-label="Desk" aria-current="page" onClick={() => window.scrollTo({ top: 0, behavior: calm ? 'instant' : 'smooth' })}><LayoutGrid size={20}/><span>Desk</span><span className="nav-hotkey">01</span></button><button className="nav-item" aria-label="Notifications" onClick={openNotifications}><Bell size={20}/><span>Notifications</span><span className="badge" key={appState.notifications.length}>{appState.notifications.filter(item => item.unread).length || 3}</span></button></nav>
      <div className="sidebar-divider"/><div className="workspace-label">The good company</div>
      <PetSwitcher pets={appState.pets} activePet={pet} sync={petSync} onCreate={() => setShowOnboarding(true)}/>
      <div className="sidebar-postcard" aria-hidden="true"><Feather size={27}/><span>A little help.<br/>A lot of heart.</span><div className="postcard-doodle">♡</div></div>
      <div className="sidebar-bottom"><button className="nav-item" aria-label="Settings" onClick={() => setShowSettings(true)}><Settings size={20}/><span>Settings</span></button><button className="nav-item" aria-label="Help center" onClick={() => setShowHelp(true)}><CircleHelp size={20}/><span>Help center</span><span className="nav-hotkey">↗</span></button><div className="profile"><span className="profile-avatar">VO</span><span><strong>Vince Ong</strong><small>Personal workspace</small></span><MoreHorizontal size={18}/></div></div>
    </motion.aside>
    <main className="desk" onClick={() => setActiveWindow('desk')}>
      <header className={`topbar ${condensed ? 'condensed' : ''}`}><div className="header-glass" aria-hidden="true"/><div className="breadcrumb"><LayoutGrid size={16}/><span>Desk</span><span className="slash">/</span><span className="muted">Tuesday, October 14</span></div><PawTrail/><div className="top-actions"><ServerPill status={petSync.status} mockGen={petSync.mockGen}/><span className="connection-pill"><span className="online-dot"/>All systems good</span><button className="icon-button" aria-label="Search" onClick={() => commandInput.current?.focus()}><Search size={20}/></button><button className="icon-button" aria-label="Notifications" onClick={openNotifications}><Bell size={20}/><span className="notification-dot"/></button></div></header>
      <section className="desk-canvas" aria-label="Fetch Desk workspace">
        <div className="desk-heading"><div className="hero-copy"><Reveal delay={.08}><span className="eyebrow"><Sun size={18}/>Good morning, Vince<span className="greeting-line"/></span></Reveal><h1 aria-label="What should we fetch?"><motion.span aria-hidden="true" initial={calm ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .36, delay: .16 }}>What should we <em>fetch?</em></motion.span></h1><Reveal delay={.28}><p>Your day, a little lighter. Your companion, right here.</p></Reveal></div><div className="mode-switch" role="group" aria-label="Mode"><motion.span className="mode-pill" animate={{ x: mode === 'work' ? 0 : '100%' }} transition={{ type: 'spring', duration: .36, bounce: .12 }}/><button aria-pressed={mode === 'work'} className={mode === 'work' ? 'selected' : ''} onClick={e => { e.stopPropagation(); setDeskMode('work') }}><span className="mode-work-dot"/>Work</button><button aria-pressed={mode === 'play'} className={mode === 'play' ? 'selected play-selected' : ''} onClick={e => { e.stopPropagation(); openPlay() }}><Sparkles size={15}/>Play</button></div></div>
        {mode === 'play' && <div className="connectors-banner"><Sparkles size={16}/><span><strong>Play mode</strong> · Gmail, Drive, and Calendar are taking a nap.</span><button onClick={() => setDeskMode('work')}>Return to Work</button></div>}
        <Reveal delay={.38}><div className={`command-bar ${listening ? 'listening' : ''} ${speaking ? 'speaking' : ''}`} onClick={e => e.stopPropagation()}><span className="command-focus-ring" aria-hidden="true"/><button className="command-icon mic-button" onClick={listening ? stopListening : startListening} aria-label={listening ? 'Stop listening' : 'Start listening'}><Mic size={23}/></button><input ref={commandInput} id="command-input" value={command} onChange={e => setCommand(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendCommand()} placeholder={listening ? 'All ears. What’s on your mind?' : mode === 'work' ? 'Ask Pip to find, read, or organise something…' : 'Tell Pip what to play…'} aria-label="Command Pip"/><Waveform active={speaking || listening}/><span className="command-hint">{listening ? 'Listening…' : <>Hold <kbd>Space</kbd> to talk</>}</span><MagneticButton className="command-submit" onClick={sendCommand} aria-label="Send command"><Send size={21}/></MagneticButton></div></Reveal>
        <Reveal delay={.44}><div className="quick-prompts"><span>A little nudge</span>{['Find my budget sheet', 'What’s on my calendar?', 'Email the standup notes'].map(text => <button key={text} onClick={() => chooseSuggestion(text)}>{text}<span aria-hidden="true">↗</span></button>)}</div></Reveal>
        <div className="canvas-world"><AmbientWorld/><div className="world-label"><span className="status-dot"/>Your Desk<span className="world-label-rule"/><span>Room to do good things.</span></div>{noteVisible && <div className="world-note"><Feather size={15}/><span>Pip is perched on your Desk</span><button aria-label="Dismiss note" onClick={() => setNoteVisible(false)}><X size={13}/></button></div>}
          {windows.map(({ id, title, eyebrow, icon: Icon, className }) => <DeskWindow key={id} id={id} title={title} eyebrow={eyebrow} Icon={Icon} className={className} rect={windowRects[id]} zIndex={windowOrder.indexOf(id) + 2} active={activeWindow === id} onActivate={() => { setActiveWindow(id); setWindowOrder(order => [...order.filter(item => item !== id), id]) }} onRectChange={rect => setWindowRects(current => ({ ...current, [id]: { ...current[id], ...rect } }))} mode={mode}/>)}
          <canvas ref={mainCanvas} className="desk-engine-canvas" aria-hidden="true"/>
          <Companion name={pet?.name ?? 'New pet'} species={pet?.species ?? 'bird'} line={mode === 'play' ? 'Time to ruffle some feathers!' : petLine} subtitles={appState.settings.subtitles} reaction={petReaction} speaking={speaking} canvas={mainCanvas} status={engine.getStatus()}/>
          <div className="habitat-caption" aria-hidden="true"><span>small companion,</span><span>big possibilities.</span><svg viewBox="0 0 80 35"><path d="M4 8q36 36 66 1m-12 0 12-1-1 12" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></div>
          <button className="peek-dock" onClick={e => { e.stopPropagation(); setShowRunLog(true) }}><div className="peek-header"><span><span className="peek-live"/>Peek</span><span className="peek-open-label">Open log ↗</span></div><canvas ref={peekCanvas}/><PeekScene run={appState.runs[0]}/></button><div className="world-coordinate" aria-hidden="true"><PawPrint size={12}/>A good place to land.</div>
        </div>
        <Reveal><div className="desk-footer"><TreatTray onFeed={feedPet} onToy={() => { engine.doIntent('fetch_ball'); setPetReaction(v => v + 1); setPetLine('You had me at playtime.'); setToast('Pip is ready to play fetch') }}/><button className="desk-tip" onClick={() => chooseSuggestion('find my budget sheet')}><Sparkles size={16}/>Try “find my budget sheet”<span>↗</span></button>{!awake && <button className="wake-button" onClick={async () => { const available = await unlockMicrophone(); setMicAvailable(available); setAwake(true); setToast(available ? 'Audio unlocked · Pip is listening' : 'Audio unlocked · mic permission is still needed') }}><Volume2 size={17} /> Wake up Pip</button>}</div></Reveal>
        <DeskSuggestions onChoose={chooseSuggestion}/>
      </section>
    </main>
    <AnimatePresence>{toast && <motion.div key={toast} className="toast" role="status" initial={{ opacity: 0, y: calm ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: calm ? 0 : 8 }}><span className="toast-check"><PawPrint size={14}/></span>{toast}</motion.div>}</AnimatePresence>
    {showOnboarding && <CreatePetFlow engine={engine} serverStatus={petSync.status} onCreated={petSync.created} onFinished={(newPet) => { setShowOnboarding(false); setToast(`${newPet.name} is ready to meet you`); window.setTimeout(() => setToast(''), 3200) }} onClose={() => setShowOnboarding(false)} />}
    {appState.approvals[0] && <ApprovalCard approval={appState.approvals[0]} onApprove={async () => { const approval = appState.approvals[0]; await api.approve(approval.runId, approval.actionId, approval.contentHash); removeApproval(approval.actionId); engine.setApprovalPending(false); updateRun(approval.runId, { status: 'complete', summary: 'Approved and sent.', events: [{ type: 'run.result', summary: 'Approved and sent.', mood: 'proud' }] }); setToast('Approved · Pip sent it') }} onCancel={async () => { const approval = appState.approvals[0]; await api.cancel(approval.runId); removeApproval(approval.actionId); engine.setApprovalPending(false); updateRun(approval.runId, { status: 'cancelled' }); setToast('Cancelled · nothing was sent') }} />}
    {showRunLog && !appState.approvals[0] && <RunLogPanel runs={appState.runs} onClose={() => setShowRunLog(false)} onCancel={async (runId) => { await api.cancel(runId); updateRun(runId, { status: 'cancelled' }); setToast('Errand cancelled') }} />}
    {showNotifications && <NotificationsPanel notifications={appState.notifications} onClose={() => setShowNotifications(false)} />}
    {showSettings && <SettingsPanel settings={appState.settings} onChange={updateSettings} onClose={() => setShowSettings(false)} />}
    {showHelp && <div className="panel-layer"><aside className="side-panel" role="dialog" aria-modal="true" aria-label="Help center"><PanelHeader icon={<CircleHelp size={17}/>} eyebrow="A little guidance" title="Help center" onClose={() => setShowHelp(false)}/><div className="help-content"><Mascot small/><h2>Good things to know.</h2><p>Type a request and press Enter. Hold Space outside a control to talk, or use the microphone button.</p><p>Move cards by their titles. With a title focused, use arrow keys to move it; hold Shift for bigger steps. The resize handle works with arrow keys too.</p><p>Give Pip a treat with a tap, or drag one onto your companion. Peek opens the run log. Outgoing messages always need your approval.</p><p>Prefer a quieter Desk? Turn on Reduce motion in Settings.</p></div></aside></div>}
    {playLoading && <div className="play-loading" role="status" aria-live="polite"><div className="play-loading-card"><div className="loader-dog" aria-hidden="true"><Mascot/></div><p className="loader-kicker">Pip is getting ready</p><h2>Opening play room</h2><div className="loader-track"><span className="loader-progress" /><span className="loader-walker" aria-hidden="true">🐕</span></div><small>Setting out the toys and making space to roam</small></div></div>}
  </div></MotionProvider>
}

function ApprovalCard({ approval, onApprove, onCancel }: { approval: ApprovalState; onApprove: () => void; onCancel: () => void }) {
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onCancel() } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onApprove, onCancel])
  return <div className="approval-layer"><section className="approval-card" role="dialog" aria-modal="true" aria-labelledby="approval-title"><div className="approval-kicker"><span className="approval-icon"><Send size={17} /></span><span>Human approval needed</span><button className="panel-close" onClick={onCancel} aria-label="Cancel approval"><X size={17} /></button></div><h2 id="approval-title">Send this for me?</h2><p className="approval-summary">{approval.preview.summary}</p><div className="approval-preview"><div><small>To</small><strong>{approval.preview.to?.join(', ')}</strong></div><div><small>Subject</small><strong>{approval.preview.subject}</strong></div><div><small>Message</small><p>{approval.preview.body}</p></div></div><HoldToApprove onApprove={onApprove}/><div className="approval-actions"><button className="secondary-action" onClick={onCancel}>Cancel</button><button className="approve-action" onClick={onApprove}><span className="bone-mark">✦</span> Approve & send</button></div><small className="approval-footnote">Pip can only send the exact preview shown above.</small></section></div>
}

function RunLogPanel({ runs, onClose, onCancel }: { runs: RunState[]; onClose: () => void; onCancel: (runId: string) => void }) {
  return <div className="panel-layer"><aside className="side-panel run-panel" role="dialog" aria-labelledby="run-log-title"><PanelHeader icon={<Clock3 size={17} />} eyebrow="Live activity" title="Run log" onClose={onClose} />{runs.length === 0 ? <EmptyPanel title="No errands yet" text="Ask Pip to find, read, or organise something from the command bar." /> : <div className="run-list">{runs.map((run) => <article className="run-item" key={run.id}><div className="run-item-top"><span className={`run-status ${run.status}`} /> <strong>{run.text}</strong><span className="run-time">{run.status === 'running' ? 'Now' : run.status}</span></div><div className="run-steps">{run.steps.length ? run.steps.map((step) => <div className="run-step" key={step.id}><span className="step-check">{run.status === 'running' ? '·' : '✓'}</span><span>{step.label}</span><small>{step.verb}</small></div>) : <PawSkeleton/>}</div>{run.summary && <p className="run-summary">{run.summary}</p>}{(run.status === 'running' || run.status === 'approval') && <button className="cancel-run" onClick={() => onCancel(run.id)}>Cancel errand</button>}</article>)}</div>}<div className="queue-tray"><Sparkles size={15} /><span><strong>Queue tray</strong><small>{runs.filter((run) => run.status === 'queued').length ? `${runs.filter((run) => run.status === 'queued').length} next up` : 'Ready for the next command'}</small></span></div></aside></div>
}

function NotificationsPanel({ notifications, onClose }: { notifications: NotificationItem[]; onClose: () => void }) {
  return <div className="panel-layer"><aside className="side-panel notifications-panel" role="dialog" aria-labelledby="notifications-title"><PanelHeader icon={<Bell size={17} />} eyebrow="Work mode" title="Notifications" onClose={onClose} />{notifications.length === 0 ? <EmptyPanel title="Nothing new" text="Fetch will surface unread mail and upcoming meetings here." /> : <div className="notification-list">{notifications.map((item) => <article className={`notification-item ${item.unread ? 'unread' : ''}`} key={item.id}><span className={`notification-icon ${item.kind}`} >{item.kind === 'email' ? <Mail size={15} /> : <CalendarDays size={15} />}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{item.time}</time></article>)}</div>}<p className="panel-note">Pip reacts to work notifications on the Desk. Play mode keeps them quiet.</p></aside></div>
}

function SettingsPanel({ settings, onChange, onClose }: { settings: SettingsState; onChange: (patch: Partial<SettingsState>) => void; onClose: () => void }) {
  return <div className="panel-layer"><aside className="side-panel settings-panel" role="dialog" aria-labelledby="settings-title"><PanelHeader icon={<Settings size={17} />} eyebrow="Personalise Fetch" title="Settings" onClose={onClose} /><div className="settings-group"><h3>Voice</h3><SettingToggle label="Voice replies" description="Let Pip speak short updates" checked={settings.voiceEnabled} onChange={(checked) => onChange({ voiceEnabled: checked })} /><label className="setting-row"><span><strong>Volume</strong><small>Pet speech and sound effects</small></span><input type="range" aria-label="Volume" min="0" max="100" value={settings.volume} onChange={(event) => onChange({ volume: Number(event.target.value) })} /><b>{settings.volume}</b></label><div className="setting-row"><span><strong>Input mode</strong><small>How Fetch listens for commands</small></span><div className="segmented"><button className={settings.inputMode === 'ptt' ? 'selected' : ''} onClick={() => onChange({ inputMode: 'ptt' })}>Push to talk</button><button className={settings.inputMode === 'hands-free' ? 'selected' : ''} onClick={() => onChange({ inputMode: 'hands-free' })}>Hands-free</button></div></div></div><div className="settings-group"><h3>Desk & pet</h3><div className="setting-row"><span><strong>Visual quality</strong><small>Splats and animation detail</small></span><div className="segmented"><button className={settings.quality === 'high' ? 'selected' : ''} onClick={() => onChange({ quality: 'high' })}>High</button><button className={settings.quality === 'low' ? 'selected' : ''} onClick={() => onChange({ quality: 'low' })}>Low</button></div></div><div className="setting-row"><span><strong>Theme</strong><small>Choose the Desk atmosphere</small></span><div className="segmented"><button className={settings.theme === 'light' ? 'selected' : ''} onClick={() => onChange({ theme: 'light' })}>Light</button><button className={settings.theme === 'dark' ? 'selected' : ''} onClick={() => onChange({ theme: 'dark' })}>Dark</button></div></div><SettingToggle label="Subtitles" description="Show captions for pet speech" checked={settings.subtitles} onChange={(checked) => onChange({ subtitles: checked })} /><SettingToggle label="Reduce motion" description="Use calmer Desk transitions" checked={settings.reduceMotion} onChange={(checked) => onChange({ reduceMotion: checked })} /><SettingToggle label="Sketchy shader" description="Give drawings a paper-grain edge" checked={settings.sketchyShader} onChange={(checked) => onChange({ sketchyShader: checked })} /></div><div className="settings-group danger-group"><h3>Data</h3><button className="delete-data"><Trash2 size={15} /> Delete my data <span>↗</span></button><small>Demo mode is on · no real accounts or messages are connected.</small></div></aside></div>
}

function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-row"><span><strong>{label}</strong><small>{description}</small></span><button className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} aria-pressed={checked} aria-label={label}><span /></button></label>
}

function PanelHeader({ icon, eyebrow, title, onClose }: { icon: ReactNode; eyebrow: string; title: string; onClose: () => void }) {
  return <div className="panel-header"><span className="panel-icon">{icon}</span><span><small>{eyebrow}</small><strong id={title === 'Run log' ? 'run-log-title' : title === 'Notifications' ? 'notifications-title' : 'settings-title'}>{title}</strong></span><button className="panel-close" onClick={onClose} aria-label={`Close ${title}`}><X size={17} /></button></div>
}

function EmptyPanel({ title, text }: { title: string; text: string }) { return <div className="empty-panel"><Mascot sleepy small/><strong>{title}</strong><p>{text}</p></div> }

export default App
