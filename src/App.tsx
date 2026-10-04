import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { Bell, CalendarDays, ChevronDown, CircleHelp, FileText, Inbox, LayoutGrid, Mic, MoreHorizontal, PawPrint, Play, Plus, Search, Settings, Sparkles, Volume2, X } from 'lucide-react'
import type { LocalIntent, Mode, PetBundle, Species } from './contracts'
import { MockPetEngine } from './mockEngine'
import { getSpeechRecognition, speakWithBrowserTts, unlockMicrophone } from './voice'

const demoPet: PetBundle = {
  id: 'demo-parrot', name: 'Pip', species: 'bird', thumbnailUrl: '',
  personality: { eager: .8, sassy: .35, anxious: .2, chatty: .92 },
  stats: { energy: 82, happiness: 91, hunger: 24 }, createdAt: new Date().toISOString(),
}

const windows = [
  { id: 'inbox', title: 'Inbox', eyebrow: 'Communication', icon: Inbox, className: 'window-inbox' },
  { id: 'files', title: 'Files', eyebrow: 'Your workspace', icon: FileText, className: 'window-files' },
  { id: 'calendar', title: 'Calendar', eyebrow: 'Today · Tue 14', icon: CalendarDays, className: 'window-calendar' },
]

function App() {
  const [mode, setMode] = useState<Mode>('work')
  const [pet, setPet] = useState<PetBundle | null>(demoPet)
  const [activeWindow, setActiveWindow] = useState('inbox')
  const [toast, setToast] = useState('')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [awake, setAwake] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [micAvailable, setMicAvailable] = useState(true)
  const [command, setCommand] = useState('')
  const engine = useMemo(() => new MockPetEngine(), [])
  const mainCanvas = useRef<HTMLCanvasElement>(null)
  const peekCanvas = useRef<HTMLCanvasElement>(null)
  const recognition = useRef<ReturnType<typeof getSpeechRecognition>>(null)

  useEffect(() => {
    if (mainCanvas.current && peekCanvas.current) engine.mount(mainCanvas.current, peekCanvas.current)
    if (pet) engine.loadPet(pet)
  }, [engine, pet])

  const setDeskMode = (next: Mode) => {
    setMode(next); engine.setMode(next)
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
    setToast(`I heard: “${text}”`)
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

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><PawPrint size={18} /></span><span>fetch</span><span className="brand-dot" /></div>
      <div className="workspace-label">Your desk</div>
      <nav className="nav-list" aria-label="Primary navigation">
        <button className="nav-item active"><LayoutGrid size={17} /> Desk <span className="nav-hotkey">⌘1</span></button>
        <button className="nav-item"><Bell size={17} /> Notifications <span className="badge">3</span></button>
      </nav>
      <div className="sidebar-divider" />
      <div className="workspace-label">Pets</div>
      <button className="pet-switcher" onClick={() => setShowOnboarding(true)}>
        <span className="pet-avatar bird-avatar">✦</span><span className="pet-switcher-copy"><strong>{pet?.name ?? 'New pet'}</strong><small>{pet ? 'Parrot · online' : 'Create your first pet'}</small></span><ChevronDown size={15} />
      </button>
      <button className="add-pet" onClick={() => setShowOnboarding(true)}><Plus size={15} /> Add a pet</button>
      <div className="sidebar-bottom"><button className="nav-item"><Settings size={17} /> Settings</button><button className="nav-item"><CircleHelp size={17} /> Help center</button><div className="profile"><span className="profile-avatar">VO</span><span><strong>Vince Ong</strong><small>Personal workspace</small></span><MoreHorizontal size={16} /></div></div>
    </aside>

    <main className="desk" onClick={() => setActiveWindow('desk')}>
      <header className="topbar">
        <div className="breadcrumb"><span>Desk</span><span className="slash">/</span><span className="muted">Tuesday, October 14</span></div>
        <div className="top-actions"><span className="connection-pill"><span className="online-dot" /> All systems good</span><button className="icon-button" aria-label="Search"><Search size={18} /></button><button className="icon-button" aria-label="Notifications"><Bell size={18} /><span className="notification-dot" /></button></div>
      </header>
      <section className="desk-canvas" aria-label="Fetch Desk workspace">
        <div className="desk-heading"><div><span className="eyebrow">Good morning, Vince</span><h1>What should we fetch?</h1></div><div className="mode-switch" role="group" aria-label="Mode"><button className={mode === 'work' ? 'selected' : ''} onClick={(e) => { e.stopPropagation(); setDeskMode('work') }}>Work</button><button className={mode === 'play' ? 'selected play-selected' : ''} onClick={(e) => { e.stopPropagation(); setDeskMode('play') }}><Sparkles size={14} /> Play</button></div></div>
        <div className={`command-bar ${listening ? 'listening' : ''} ${speaking ? 'speaking' : ''}`} onClick={(e) => e.stopPropagation()}><button className="command-icon mic-button" onClick={listening ? stopListening : startListening} aria-label={listening ? 'Stop listening' : 'Start listening'}><Mic size={19} /></button><input value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendCommand()} placeholder={listening ? 'Listening…' : mode === 'work' ? 'Ask Pip to find, read, or organise something…' : 'Tell Pip what to play…'} aria-label="Command Pip" /><span className="command-hint">{listening ? 'Listening' : <>Hold <kbd>Space</kbd> to talk</>}</span><button className="command-submit" onClick={sendCommand} aria-label="Send command"><ChevronDown size={18} className="send-chevron" /></button></div>
        <div className="canvas-world">
          <div className="sun-wash" /><div className="world-note"><span className="note-pin" /> Pip is perched on your Desk <button aria-label="Dismiss note">×</button></div>
          {windows.map(({ id, title, eyebrow, icon: Icon, className }) => <DeskWindow key={id} id={id} title={title} eyebrow={eyebrow} Icon={Icon} className={className} active={activeWindow === id} onActivate={() => setActiveWindow(id)} mode={mode} />)}
          <div className="pet-stage" aria-label={`${pet?.name ?? 'Your pet'} is perched on the desk`}><div className="pet-shadow" /><div className="pet-glow" /><div className="pet-illustration">{pet?.species === 'bird' ? '✦' : '◒'}</div><div className="pet-bubble">{mode === 'work' ? 'Ready when you are.' : 'Play with me!'}</div><canvas ref={mainCanvas} className="engine-canvas" /><div className="pet-nameplate"><span className="status-dot" />{pet?.name ?? 'New pet'} <span>·</span> <span className="muted">{engine.getStatus()}</span></div></div>
          <div className="peek-dock"><div className="peek-header"><span><span className="peek-live" /> Peek</span><button aria-label="Close peek"><X size={14} /></button></div><canvas ref={peekCanvas} /><div className="peek-scene"><span className="peek-pet">✦</span><span className="peek-copy"><strong>Pip is on it</strong><small>Waiting for a new command</small></span></div></div>
        </div>
        <div className="desk-footer"><div className="tray treat-tray"><span className="tray-icon">✺</span><span><strong>Treat tray</strong><small>Drag to Pip</small></span><span className="treats">● ● ●</span></div><div className="tray toy-tray"><span className="tray-icon">◉</span><span><strong>Toy box</strong><small>Make playtime</small></span><span className="toys">◌ ◇</span></div><div className="desk-tip"><Sparkles size={14} /> Try “find my budget sheet”</div></div>
      </section>
    </main>
    {toast && <div className="toast"><span className="toast-check">✓</span>{toast}</div>}
    {!awake && <button className="wake-button" onClick={async () => { const available = await unlockMicrophone(); setMicAvailable(available); setAwake(true); setToast(available ? 'Audio unlocked · Pip is listening' : 'Audio unlocked · mic permission is still needed') }}><Volume2 size={17} /> Wake up Pip</button>}
    {showOnboarding && <Onboarding onClose={() => setShowOnboarding(false)} onCreate={(newPet) => { setPet(newPet); setShowOnboarding(false); setToast(`${newPet.name} is ready to meet you`) }} />}
  </div>
}

function DeskWindow({ id, title, eyebrow, Icon, className, active, onActivate, mode }: { id: string; title: string; eyebrow: string; Icon: typeof Inbox; className: string; active: boolean; onActivate: () => void; mode: Mode }) {
  return <article className={`desk-window ${className} ${active ? 'active' : ''} ${mode === 'play' ? 'dimmed' : ''}`} onClick={(e) => { e.stopPropagation(); onActivate() }}><div className="window-top"><div className="window-title"><span className="window-icon"><Icon size={16} /></span><span><small>{eyebrow}</small><strong>{title}</strong></span></div><button className="window-menu" aria-label={`${title} menu`}><MoreHorizontal size={17} /></button></div>{id === 'inbox' && <div className="window-body inbox-body"><div className="mail-row unread"><span className="mail-avatar blue">AM</span><span><strong>Alex Morgan</strong><small>Standup notes · 9:42 AM</small></span><span className="mail-dot" /></div><div className="mail-row"><span className="mail-avatar peach">JT</span><span><strong>Jamie Tan</strong><small>Re: launch checklist</small></span></div><div className="mail-row"><span className="mail-avatar lilac">NS</span><span><strong>Notion</strong><small>Your weekly digest</small></span></div><div className="window-link">Open inbox <span>↗</span></div></div>}{id === 'files' && <div className="window-body file-body"><div className="file-hero"><FileText size={18} /><span><strong>Budget · Q4 2025</strong><small>Updated 12 minutes ago</small></span><span className="file-chip">XLSX</span></div><div className="file-line" /><div className="file-small"><span>My Drive</span><span>24 items <ChevronDown size={13} /></span></div><div className="window-link">Open files <span>↗</span></div></div>}{id === 'calendar' && <div className="window-body calendar-body"><div className="calendar-event"><span className="event-time">10:30</span><span className="event-line" /><span><strong>Product sync</strong><small>Google Meet · 30 min</small></span></div><div className="calendar-event next"><span className="event-time">14:00</span><span className="event-line" /><span><strong>Focus time</strong><small>Deep work block</small></span></div><div className="window-link">Open calendar <span>↗</span></div></div>}</article>
}

function Onboarding({ onClose, onCreate }: { onClose: () => void; onCreate: (pet: PetBundle) => void }) {
  const [step, setStep] = useState(1); const [species, setSpecies] = useState<Species>('bird'); const [name, setName] = useState(''); const [inputMode, setInputMode] = useState<'upload' | 'draw'>('draw'); const [progress, setProgress] = useState(0)
  const speciesList: { id: Species; label: string; emoji: string; blurb: string }[] = [{ id: 'dog', label: 'Dog', emoji: '◕ᴥ◕', blurb: 'Eager & loyal' }, { id: 'cat', label: 'Cat', emoji: '◡ᴗ◡', blurb: 'Sassy & capable' }, { id: 'rodent', label: 'Rodent', emoji: '•ᴥ•', blurb: 'Anxious & thorough' }, { id: 'bird', label: 'Bird', emoji: '✦', blurb: 'Chatty & curious' }]
  const create = () => { const pet: PetBundle = { id: `pet-${Date.now()}`, name: name || 'Pip', species, thumbnailUrl: '', personality: { eager: .8, sassy: .35, anxious: .2, chatty: .8 }, stats: { energy: 100, happiness: 80, hunger: 15 }, createdAt: new Date().toISOString() }; onCreate(pet) }
  return <div className="modal-backdrop"><section className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><button className="modal-close" onClick={onClose} aria-label="Close onboarding"><X /></button>{step < 4 ? <><div className="modal-kicker">A new companion</div><h2 id="onboarding-title">Let’s make your pet.</h2><p className="modal-intro">A little image, a little personality, and a lot of character.</p><div className="progress-steps"><span className="done">01</span><i /><span className={step >= 2 ? 'done' : ''}>02</span><i /><span className={step >= 3 ? 'done' : ''}>03</span></div>{step === 1 && <><div className="species-grid">{speciesList.map((item) => <button key={item.id} className={`species-card ${species === item.id ? 'chosen' : ''}`} onClick={() => setSpecies(item.id)}><span className={`species-glyph ${item.id}`}>{item.emoji}</span><strong>{item.label}</strong><small>{item.blurb}</small></button>)}</div><button className="primary-button" onClick={() => setStep(2)}>Choose {speciesList.find((item) => item.id === species)?.label} <span>→</span></button></>}{step === 2 && <><div className="input-tabs"><button className={inputMode === 'draw' ? 'active' : ''} onClick={() => setInputMode('draw')}>Draw a pet</button><button className={inputMode === 'upload' ? 'active' : ''} onClick={() => setInputMode('upload')}>Upload a photo</button></div>{inputMode === 'draw' ? <DrawPad /> : <label className="upload-zone"><span>↑</span><strong>Drop a photo here</strong><small>or choose a file from your computer</small><input type="file" accept="image/*" capture="user" /></label>}<div className="name-field"><label htmlFor="pet-name">What should we call them?</label><input id="pet-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pip, Miso, Orbit" /></div><div className="modal-actions"><button className="text-button" onClick={() => setStep(1)}>Back</button><button className="primary-button compact" onClick={() => setStep(3)}>Continue <span>→</span></button></div></>}{step === 3 && <><div className="personality-intro"><span className="preview-glyph">{species === 'bird' ? '✦' : speciesList.find((item) => item.id === species)?.emoji}</span><div><strong>{name || 'Pip'} is taking shape</strong><small>Set the dials, or keep their natural spark.</small></div></div><div className="slider-list"><label><span>Eager</span><input type="range" defaultValue="80" /><span>80</span></label><label><span>Sassy</span><input type="range" defaultValue="35" /><span>35</span></label><label><span>Anxious</span><input type="range" defaultValue="20" /><span>20</span></label><label><span>Chatty</span><input type="range" defaultValue="90" /><span>90</span></label></div><div className="modal-actions"><button className="text-button" onClick={() => setStep(2)}>Back</button><button className="primary-button compact" onClick={() => { setStep(4); let i = 0; const timer = window.setInterval(() => { i += 20; setProgress(i); if (i >= 100) { window.clearInterval(timer); create() } }, 180) }}>Create {name || 'Pip'} <Sparkles size={16} /></button></div></>}</> : <div className="creating-state"><div className="creation-glyph">✦</div><div className="modal-kicker">Building {name || 'Pip'}</div><h2>Turning a spark into a companion.</h2><p>Segmenting the drawing · fitting their little rig · finding their voice</p><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><small>{progress < 40 ? 'Cleaning up the reference…' : progress < 80 ? 'Teaching them how to move…' : 'Almost time to say hello…'}</small></div>}</section></div>
}

function DrawPad() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush')
  const [color, setColor] = useState('#31596b')
  const [history, setHistory] = useState<ImageData[]>([])
  const drawing = useRef(false)
  useEffect(() => { const context = canvas.current?.getContext('2d'); if (context) { context.fillStyle = '#f0f4e9'; context.fillRect(0, 0, 520, 140) } }, [])
  const snapshot = () => { const context = canvas.current?.getContext('2d'); if (context && canvas.current) setHistory((items) => [...items.slice(-11), context.getImageData(0, 0, canvas.current!.width, canvas.current!.height)]) }
  const point = (event: PointerEvent<HTMLCanvasElement>) => { const target = canvas.current!; const rect = target.getBoundingClientRect(); return { x: (event.clientX - rect.left) * target.width / rect.width, y: (event.clientY - rect.top) * target.height / rect.height } }
  const down = (event: PointerEvent<HTMLCanvasElement>) => { snapshot(); drawing.current = true; canvas.current?.setPointerCapture(event.pointerId); const context = canvas.current?.getContext('2d'); if (context) { const p = point(event); context.beginPath(); context.moveTo(p.x, p.y); context.strokeStyle = tool === 'eraser' ? '#f0f4e9' : color; context.lineWidth = tool === 'eraser' ? 20 : 5; context.lineCap = 'round' } }
  const move = (event: PointerEvent<HTMLCanvasElement>) => { if (!drawing.current) return; const context = canvas.current?.getContext('2d'); if (context) { const p = point(event); context.lineTo(p.x, p.y); context.stroke() } }
  const clear = () => { const context = canvas.current?.getContext('2d'); if (context && canvas.current) { snapshot(); context.fillStyle = '#f0f4e9'; context.fillRect(0, 0, canvas.current.width, canvas.current.height) } }
  const undo = () => { const previous = history[history.length - 1]; if (!previous || !canvas.current) return; const context = canvas.current.getContext('2d')!; context.putImageData(previous, 0, 0); setHistory((items) => items.slice(0, -1)) }
  return <div className="draw-pad"><div className="draw-toolbar"><button className={tool === 'brush' ? 'tool-selected' : ''} onClick={() => setTool('brush')} aria-label="Brush">●</button><button className={tool === 'eraser' ? 'tool-selected' : ''} onClick={() => setTool('eraser')} aria-label="Eraser">○</button><input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Brush color" /><button onClick={undo} aria-label="Undo">↶</button><button onClick={clear} aria-label="Clear drawing">⌫</button></div><canvas ref={canvas} width={520} height={140} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drawing.current = false }} onPointerLeave={() => { drawing.current = false }} aria-label="Draw your pet" /><small>Draw your pet here · rough is perfect</small></div>
}

export default App
