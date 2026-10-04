import { useEffect, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion, useInView, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { Ball, Bone, Feather, Leaf, PawPrint, Sparkles } from './icons'
import { MagneticButton, Reveal, spring, useCalm } from './motion'
import type { RunState } from './api'
import type { Species } from './contracts'

export function Mascot({ sleepy = false, small = false, species = 'bird', eyesX, tilt }: { sleepy?: boolean; small?: boolean; species?: Species; eyesX?: MotionValue<number>; tilt?: MotionValue<number> }) {
  return <svg className={`mascot ${sleepy ? 'sleepy' : ''} ${small ? 'small' : ''}`} viewBox="0 0 240 270" fill="none" aria-hidden="true">
    <ellipse cx="119" cy="254" rx="66" ry="9" fill="#18383C" opacity=".12" />
    <g className="mascot-tail pip-tail"><path d="m119 178 17 62c2 13-9 16-14 5l-25-50" fill="#628C7B"/><path d="m110 183-4 67c-1 13-12 12-14 0l-3-60" fill="#A8BB65"/></g>
    <path d="M65 149c-9 41 6 73 50 76 46 3 66-29 52-74l-19-42Z" fill="#BED875" />
    <path d="M84 157c-11 42 3 63 31 64 29 1 44-20 34-53" fill="#E4EBA5"/>
    <path className="mascot-wing pip-wing" d="M68 134c-28 8-35 53-14 76 11 11 17-9 22-21 12-27 26-43 7-53" fill="#537A68" stroke="#18383C" strokeWidth="2.5" strokeLinejoin="round"/>
    <path className="mascot-wing pip-wing" d="M164 137c21 10 31 49 16 66-9 9-20-16-24-27" fill="#91AB57" stroke="#18383C" strokeWidth="2.5"/>
    <path d="m94 219-3 15m0-2-13 5m14-5 8 5m32-16 2 13m-1-2-10 6m11-6 12 4" stroke="#BA7750" strokeWidth="5" strokeLinecap="round"/>
    <motion.g style={{ rotate: tilt, transformOrigin: '120px 105px' }}>
      {species === 'bird' ? <><path d="M100 62C66 39 96 14 108 46c-2-39 32-43 22-1 28-25 37-5 11 19" fill="#B8D475" stroke="#18383C" strokeWidth="2.5" strokeLinecap="round"/><path d="M61 105c-5-69 115-75 117-2 2 53-28 76-62 71-33-4-52-29-55-69Z" fill="#D9EA9C" stroke="#18383C" strokeWidth="2.5"/></> : <><path d="m63 96-17-62 47 30m56-1 45-29-17 65" fill="#B7A080" stroke="#18383C" strokeWidth="3"/><ellipse cx="119" cy="112" rx="61" ry="59" fill="#E7CCA3" stroke="#18383C" strokeWidth="2.5"/></>}
      <ellipse cx="95" cy="112" rx="26" ry="31" fill="#FFFBE8"/><ellipse cx="148" cy="108" rx="23" ry="29" fill="#FFFBE8"/>
      {sleepy ? <g stroke="#18383C" strokeWidth="3" strokeLinecap="round"><path d="M88 111q8 9 16-1M139 108q8 8 15-1"/></g> : <motion.g className="mascot-eyes pip-eyes" style={{ x: eyesX }}><ellipse cx="99" cy="110" rx="6" ry="9" fill="#18383C"/><ellipse cx="149" cy="107" rx="6" ry="9" fill="#18383C"/><circle cx="101" cy="107" r="2" fill="white"/><circle cx="151" cy="104" r="2" fill="white"/></motion.g>}
      <ellipse cx="85" cy="132" rx="12" ry="6" fill="#E99D78" opacity=".7"/><ellipse cx="159" cy="128" rx="10" ry="5" fill="#E99D78" opacity=".7"/>
      {species === 'bird' ? <><path d="M118 118c18-12 36 2 18 15l-11 14-2-15-10-5Z" fill="#EB9B55" stroke="#18383C" strokeWidth="2.5"/><path d="m123 132 12 1" stroke="#18383C" strokeWidth="2"/></> : <><path d="M114 123h17l-8 9Z" fill="#18383C"/><path d="M123 132q-10 12-16 0m16 0q10 12 16 0" stroke="#18383C" strokeWidth="2"/></>}
      <path d="m85 83 11-3m43-1 11 2" stroke="#18383C" strokeWidth="3" strokeLinecap="round"/>
    </motion.g>
  </svg>
}

export function AmbientWorld() {
  const calm = useCalm(), { scrollY } = useScroll()
  const sun = useTransform(scrollY, [0, 1200], [0, -90]), hill = useTransform(scrollY, [0, 1200], [0, -28]), feather = useTransform(scrollY, [0, 1200], [0, 100])
  const ref = useRef<HTMLDivElement>(null), visible = useInView(ref)
  return <div ref={ref} className={`ambient-world ${visible ? 'in-view' : ''}`} aria-hidden="true">
    <motion.div className="habitat-sun" style={{ y: calm ? 0 : sun }}><span/><span/><span/></motion.div>
    <motion.div className="habitat-hills" style={{ y: calm ? 0 : hill }}><i/><i/></motion.div>
    <motion.div className="habitat-feather" style={{ y: calm ? 0 : feather, rotate: calm ? -15 : feather }}><Feather size={43}/></motion.div>
    <div className="habitat-leaves"><Leaf size={68}/><Leaf size={49}/><Leaf size={31}/></div>
    {[0, 1, 2, 3, 4, 5].map(i => <span key={i} className="habitat-dust" style={{ left: `${26 + i * 11}%`, top: `${17 + (i % 3) * 24}%`, animationDelay: `${i * -.8}s` }}>·</span>)}
    <div className="habitat-grain"/>
  </div>
}

export function PawTrail() {
  const { scrollYProgress } = useScroll()
  return <div className="paw-trail" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map(i => <TrailPaw key={i} index={i} progress={scrollYProgress}/>)}</div>
}
export function CardPeeker() {
  const calm = useCalm(), { scrollY } = useScroll()
  const peek = useTransform(scrollY, [0, 180, 360, 600], [48, 48, 0, 25])
  return <div className="card-peeker" aria-hidden="true"><motion.div style={{ y: calm ? 18 : peek }}><Mascot small/></motion.div></div>
}
function TrailPaw({ index, progress }: { index: number; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [index / 7, (index + 1) / 7], [.15, 1])
  return <motion.span style={{ opacity, rotate: index % 2 ? 14 : -14 }}><PawPrint size={13}/></motion.span>
}

export function Companion({ name, species, line, subtitles, reaction, speaking, status }: { name: string; species: Species; line: string; subtitles: boolean; reaction: number; speaking: boolean; canvas: RefObject<HTMLCanvasElement | null>; status: string }) {
  const calm = useCalm(), ref = useRef<HTMLDivElement>(null), visible = useInView(ref)
  const eyes = useMotionValue(0), smoothEyes = useSpring(eyes, spring.magnetic)
  const { scrollY } = useScroll(), tilt = useTransform(scrollY, [0, 300, 650, 1000], [-5, 7, -4, 3])
  useEffect(() => {
    if (calm || !visible) return
    const move = (event: globalThis.PointerEvent) => {
      const r = ref.current?.getBoundingClientRect()
      if (r) eyes.set(Math.max(-3, Math.min(3, (event.clientX - r.x - r.width / 2) / 100)))
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => window.removeEventListener('pointermove', move)
  }, [calm, visible, eyes])
  return <div ref={ref} className={`pet-stage ${visible ? 'in-view' : ''} ${speaking ? 'is-speaking' : ''}`} aria-label={`${name} the pet`} data-pet-drop>
    <div className="pet-orbit" aria-hidden="true"><span/><Sparkles size={19}/><span/></div>
    <AnimatePresence mode="wait">{subtitles && <motion.div key={line} className="pet-bubble" style={{ x: "-50%" }} initial={calm ? false : { opacity: 0, y: 7, scale: .94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={spring.soft}>{line}<span className="bubble-heart" aria-hidden="true">♡</span></motion.div>}</AnimatePresence>
    <motion.div className="pet-illustration" key={reaction} initial={{ y: 0, rotate: 0 }} animate={reaction && !calm ? { y: [0, -18, 0], rotate: [0, -6, 5, 0] } : { y: 0 }} transition={{ duration: .4 }}><Mascot species={species} eyesX={calm ? undefined : smoothEyes} tilt={calm ? undefined : tilt}/></motion.div>
    {reaction > 0 && <div key={`crumbs-${reaction}`} className="crumbs" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map(i => <motion.i key={i} initial={{ opacity: 1, x: 0, y: 0 }} animate={{ opacity: 0, x: calm ? 0 : (i - 2.5) * 22, y: calm ? 0 : [0, -36 - (i % 2) * 12, 35] }} transition={{ duration: .4, delay: i * .015 }}/>)}</div>}

    <div className="pet-perch" aria-hidden="true"/>
    <div className="pet-nameplate"><span className="status-dot"/><strong>{name}</strong><span>·</span><span>{status}</span><Feather size={13}/></div>
  </div>
}

export function TreatTray({ onFeed, onToy }: { onFeed: () => void; onToy: () => void }) {
  const calm = useCalm()
  return <><div className="tray treat-tray"><span className="tray-icon"><Bone/></span><span><strong>Treat tray</strong><small>Drag to your pet, or tap</small></span><div className="treats">{[0, 1, 2].map(i => <motion.button key={i} className="treat-piece" aria-label={`Give your pet treat ${i + 1}`} drag={!calm} dragSnapToOrigin dragElastic={.12} style={{ zIndex: 30 }} whileDrag={{ scale: 1.15 }} onClick={onFeed} onDragEnd={(_event, info) => { const r = document.querySelector('[data-pet-drop]')?.getBoundingClientRect(); if (r && info.point.x >= r.left && info.point.x <= r.right && info.point.y - window.scrollY >= r.top && info.point.y - window.scrollY <= r.bottom) onFeed() }}><Bone size={23}/></motion.button>)}</div></div><div className="tray toy-tray"><span className="tray-icon"><Ball/></span><span><strong>Toy box</strong><small>A little joy break</small></span><motion.button className="toy-piece" aria-label="Play fetch" onClick={onToy} whileHover={calm ? undefined : { y: [0, -7, 0] }} transition={{ duration: .36 }}><Ball size={27}/></motion.button></div></>
}

export function PeekScene({ run, petName = 'Your pet' }: { run?: RunState; petName?: string }) {
  const working = run?.status === 'running' || run?.status === 'queued', success = run?.status === 'complete'
  const papers = Math.min(5, run?.events.filter(e => e.type === 'tool.end').length ?? 0)
  return <div className={`peek-scene ${working ? 'working' : ''} ${success ? 'succeeded' : ''} ${run?.status === 'error' ? 'sheepish' : ''}`}><div className="peek-vignette" aria-hidden="true"><div className="peek-mascot peek-bird"><Mascot small sleepy={!run || run.status === 'error'}/></div><div className="paper-pile">{Array.from({ length: papers || 1 }, (_, i) => <motion.i key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: -i * 5, rotate: i % 2 ? 5 : -4 }} transition={{ duration: .24 }}/>)}</div><span className="dust-puff"/><span className="dust-puff second"/></div><span className="peek-copy"><strong>{working ? `${petName} is on it` : success ? 'Fetched with love.' : run?.status === 'error' ? 'A little ruffled.' : run?.status === 'approval' ? 'A paw of approval?' : 'Run log is ready'}</strong><small>{working ? 'A little busywork, off your plate.' : run?.status === 'error' ? 'Open the log. We\u2019ll untangle it.' : 'Click to see recent errands'}</small></span></div>
}

export function Waveform({ active }: { active: boolean }) {
  return <span className={`voice-wave ${active ? 'active' : ''}`} aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} style={{ animationDelay: `${i * -.13}s` }}/>)}</span>
}
export function PawSkeleton() { return <div className="paw-skeleton" role="status" aria-label="Making a plan"><PawPrint/><span/><span/><PawPrint/></div> }

export function HoldToApprove({ onApprove }: { onApprove: () => void }) {
  const [holding, setHolding] = useState(false), [progress, setProgress] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; setHolding(false); setProgress(0) }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!holding) return
    const start = performance.now(); let frame = 0
    const tick = () => { setProgress(Math.min(1, (performance.now() - start) / 1200)); frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame)
  }, [holding])
  const begin = () => { if (timer.current) return; setHolding(true); timer.current = setTimeout(() => { timer.current = undefined; setHolding(false); onApprove() }, 1200) }
  return <button className="hold-pet" aria-label="Hold to approve this exact preview. Hold Space for 1.2 seconds, or use Approve and send." onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); begin() }} onPointerUp={cancel} onPointerCancel={cancel} onLostPointerCapture={cancel} onPointerLeave={cancel} onBlur={cancel} onKeyDown={e => { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) begin() } }} onKeyUp={e => { if (e.code === 'Space') { e.preventDefault(); cancel() } }}><span className="hold-ring" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ transform: `rotate(${i * 30}deg) translateY(-30px)`, opacity: progress >= (i + 1) / 12 ? 1 : .15 }}/>)}</span><PawPrint size={25}/><span>{holding ? 'Keep holding\u2026' : 'Or hold a paw'}</span></button>
}

export function DeskSuggestions({ onChoose }: { onChoose: (text: string) => void }) {
  return <section className="desk-suggestions" aria-labelledby="suggestion-title"><Reveal><div className="section-caption"><Feather size={21}/><span>Big help. Little companion.</span><span className="caption-line"/></div><div className="suggestion-heading"><h2 id="suggestion-title">More headspace.<br/><em>Less busywork.</em></h2><p>A few things your pet can take off your plate.<br/>You bring the idea. We&rsquo;ll bring it back.</p></div></Reveal><div className="suggestion-grid">{[
    { icon: Feather, title: 'Find that one file.', text: 'A quick search across your Drive, right here.', prompt: 'find my budget sheet', kind: 'sage' },
    { icon: Bone, title: 'Bring everyone up to speed.', text: 'Notes drafted and ready for your sign-off.', prompt: 'email the standup notes to my team', kind: 'peach' },
    { icon: Leaf, title: 'Make room for focus.', text: 'A clear look at what the rest of your day holds.', prompt: 'show my calendar for today', kind: 'lavender' }
  ].map((item, i) => <Reveal key={item.title} delay={i * .07}><MagneticButton className={`suggestion-card ${item.kind}`} onClick={() => onChoose(item.prompt)}><span className="suggestion-icon"><item.icon size={32}/></span><strong>{item.title}</strong><span>{item.text}</span><span className="suggestion-arrow">↗</span></MagneticButton></Reveal>)}</div><Reveal><div className="end-note"><PawPrint size={17}/><span>A good day starts with a little company.</span><span>Made for your kind of work.</span></div></Reveal></section>
}

export function useCondensedHeader() {
  const { scrollY } = useScroll(), [condensed, setCondensed] = useState(false)
  useMotionValueEvent(scrollY, 'change', value => setCondensed(value > 40))
  return condensed
}
