import { useEffect, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion, useInView, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { Ball, Bone, FileText, Leaf, PawPrint, Sparkles } from './icons'
import { MagneticButton, Reveal, spring, useCalm } from './motion'
import type { RunState } from './api'
import type { Species } from './contracts'

export function Mascot({ sleepy = false, small = false, species = 'dog', eyesX, tilt }: { sleepy?: boolean; small?: boolean; species?: Species; eyesX?: MotionValue<number>; tilt?: MotionValue<number> }) {
  const isCat = species === 'cat'
  return <svg className={`mascot ${sleepy ? 'sleepy' : ''} ${small ? 'small' : ''}`} viewBox="0 0 240 270" fill="none" aria-hidden="true">
    <ellipse cx="120" cy="254" rx="66" ry="9" fill="#18383C" opacity=".12" />
    
    {isCat ? (
      <>
        <g className="mascot-tail">
          <path d="m154 196 c18 2 30 -14 26 -38 c-3 -19 -14 -24 -11 -33 c3 -6 10 -4 9 4 c-2 13 7 17 5 31 c-3 24 -17 39 -35 37 Z" fill="#D99464" stroke="#18383C" strokeWidth="2.4" strokeLinejoin="round"/>
        </g>
        <path d="M78 142 c-4 44 8 74 42 75 c34 1 48-30 42-75 c-3-30-81-30-84 0Z" fill="#E6A87C" stroke="#18383C" strokeWidth="2.5" strokeLinejoin="round"/>
        <path d="M104 152 c-6 30 5 54 16 54 c11 0 22-24 16-54 Z" fill="#FFF5E8"/>
        <ellipse cx="98" cy="221" rx="12" ry="9" fill="#FCE5CE" stroke="#18383C" strokeWidth="2.2"/>
        <ellipse cx="142" cy="221" rx="12" ry="9" fill="#FCE5CE" stroke="#18383C" strokeWidth="2.2"/>
      </>
    ) : (
      <>
        <g className="mascot-tail">
          <path d="m158 192 q24 -6 30 -30 q3 -11 -8 -9 q-11 2 -22 30" fill="#C48F50" stroke="#18383C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
        <path d="M74 138 c-5 46 10 77 46 78 c36 1 51-31 46-78 c-4-32-87-32-92 0Z" fill="#D9A86C" stroke="#18383C" strokeWidth="2.5" strokeLinejoin="round"/>
        <path d="M98 148 c-7 32 6 56 22 56 c16 0 29-24 22-56 Z" fill="#FFF5E3"/>
        <ellipse cx="96" cy="222" rx="14" ry="10" fill="#E8BD8A" stroke="#18383C" strokeWidth="2.5"/>
        <ellipse cx="144" cy="222" rx="14" ry="10" fill="#E8BD8A" stroke="#18383C" strokeWidth="2.5"/>
        <path d="m91 226 v3 m5 -3 v3 m43 -3 v3 m5 -3 v3" stroke="#18383C" strokeWidth="2" strokeLinecap="round"/>
      </>
    )}

    <motion.g style={{ rotate: tilt, transformOrigin: '120px 105px' }}>
      {isCat ? (
        <>
          <path d="M72 98 L62 48 L100 76 Z" fill="#D99464" stroke="#18383C" strokeWidth="2.5" strokeLinejoin="round"/>
          <path d="M73 90 L68 58 L93 78 Z" fill="#F5C4B5"/>
          <path d="M168 98 L178 48 L140 76 Z" fill="#D99464" stroke="#18383C" strokeWidth="2.5" strokeLinejoin="round"/>
          <path d="M167 90 L172 58 L147 78 Z" fill="#F5C4B5"/>
          <ellipse cx="120" cy="110" rx="52" ry="44" fill="#E8A375" stroke="#18383C" strokeWidth="2.5"/>
          <path d="M120 72 v11 m-9 -8 l4 7 m15 -7 l-4 7" stroke="#B86C38" strokeWidth="2.2" strokeLinecap="round"/>
          <ellipse cx="120" cy="125" rx="20" ry="13" fill="#FFF4E6" stroke="#18383C" strokeWidth="1.8"/>
          <path d="M116 119 h8 l-4 5 Z" fill="#EB8686" stroke="#18383C" strokeWidth="1.2" strokeLinejoin="round"/>
          <path d="M120 124 q-5 5 -10 1 m10 -1 q5 5 10 1" stroke="#18383C" strokeWidth="2" strokeLinecap="round"/>
          <path d="M72 120 h22 m-22 6 h24 M168 120 h-22 m22 6 h-24" stroke="#18383C" strokeWidth="1.6" strokeLinecap="round"/>
          <ellipse cx="88" cy="124" rx="7" ry="4" fill="#E99D78" opacity=".5"/>
          <ellipse cx="152" cy="124" rx="7" ry="4" fill="#E99D78" opacity=".5"/>
          {sleepy ? (
            <g stroke="#18383C" strokeWidth="2.8" strokeLinecap="round">
              <path d="M94 103 q8 7 15 -1 M131 103 q8 7 15 -1"/>
            </g>
          ) : (
            <motion.g className="mascot-eyes" style={{ x: eyesX }}>
              <ellipse cx="102" cy="103" rx="7" ry="9" fill="#18383C"/>
              <ellipse cx="138" cy="103" rx="7" ry="9" fill="#18383C"/>
              <ellipse cx="102" cy="103" rx="5" ry="7.5" fill="#84B85C"/>
              <ellipse cx="138" cy="103" rx="5" ry="7.5" fill="#84B85C"/>
              <ellipse cx="102" cy="103" rx="2.2" ry="6.5" fill="#18383C"/>
              <ellipse cx="138" cy="103" rx="2.2" ry="6.5" fill="#18383C"/>
              <circle cx="100" cy="100" r="2" fill="white"/>
              <circle cx="136" cy="100" r="2" fill="white"/>
            </motion.g>
          )}
        </>
      ) : (
        <>
          <path d="M70 80 C48 75 40 120 60 142 C70 152 80 135 76 115 Z" fill="#B87D42" stroke="#18383C" strokeWidth="2.5" strokeLinejoin="round"/>
          <path d="M170 80 C192 75 200 120 180 142 C170 152 160 135 164 115 Z" fill="#B87D42" stroke="#18383C" strokeWidth="2.5" strokeLinejoin="round"/>
          <ellipse cx="120" cy="108" rx="54" ry="47" fill="#E2B47D" stroke="#18383C" strokeWidth="2.5"/>
          <path d="M113 62 q7 28 0 47 h14 q-7 -19 0 -47 Z" fill="#FFF7EA"/>
          <ellipse cx="120" cy="124" rx="26" ry="19" fill="#FFF6E8" stroke="#18383C" strokeWidth="2"/>
          <ellipse cx="120" cy="116" rx="9" ry="7" fill="#18383C"/>
          <ellipse cx="118" cy="114" rx="2.5" ry="1.8" fill="white"/>
          <path d="M120 123 v5 m-8 -2 q8 8 8 0 q0 8 8 0" stroke="#18383C" strokeWidth="2.2" strokeLinecap="round"/>
          <ellipse cx="82" cy="120" rx="9" ry="5" fill="#E99D78" opacity=".55"/>
          <ellipse cx="158" cy="120" rx="9" ry="5" fill="#E99D78" opacity=".55"/>
          <path d="m92 84 10 -2 m36 0 10 2" stroke="#A86E38" strokeWidth="3" strokeLinecap="round"/>
          {sleepy ? (
            <g stroke="#18383C" strokeWidth="3" strokeLinecap="round">
              <path d="M92 98 q8 8 16 -1 M132 98 q8 8 16 -1"/>
            </g>
          ) : (
            <motion.g className="mascot-eyes" style={{ x: eyesX }}>
              <ellipse cx="100" cy="98" rx="6.5" ry="9" fill="#18383C"/>
              <ellipse cx="140" cy="98" rx="6.5" ry="9" fill="#18383C"/>
              <circle cx="102" cy="95" r="2.2" fill="white"/>
              <circle cx="142" cy="95" r="2.2" fill="white"/>
            </motion.g>
          )}
        </>
      )}
    </motion.g>
  </svg>
}

export function AmbientWorld() {
  const calm = useCalm(), { scrollY } = useScroll()
  const sun = useTransform(scrollY, [0, 1200], [0, -90]), hill = useTransform(scrollY, [0, 1200], [0, -28]), sparkle = useTransform(scrollY, [0, 1200], [0, 90])
  const ref = useRef<HTMLDivElement>(null), visible = useInView(ref)
  return <div ref={ref} className={`ambient-world ${visible ? 'in-view' : ''}`} aria-hidden="true">
    <motion.div className="habitat-sun" style={{ y: calm ? 0 : sun }}><span/><span/><span/></motion.div>
    <motion.div className="habitat-hills" style={{ y: calm ? 0 : hill }}><i/><i/></motion.div>
    <motion.div className="habitat-sparkle" style={{ y: calm ? 0 : sparkle }}><Sparkles size={38}/></motion.div>
    <div className="habitat-leaves"><Leaf size={68}/><Leaf size={49}/><Leaf size={31}/></div>
    {[0, 1, 2, 3, 4, 5].map(i => <span key={i} className="habitat-dust" style={{ left: `${26 + i * 11}%`, top: `${17 + (i % 3) * 24}%`, animationDelay: `${i * -.8}s` }}>·</span>)}
    <div className="habitat-grain"/>
  </div>
}

export function PawTrail() {
  const { scrollYProgress } = useScroll()
  return <div className="paw-trail" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map(i => <TrailPaw key={i} index={i} progress={scrollYProgress}/>)}</div>
}
export function CardPeeker({ species = 'dog' }: { species?: Species }) {
  const calm = useCalm(), { scrollY } = useScroll()
  const peek = useTransform(scrollY, [0, 180, 360, 600], [48, 48, 0, 25])
  return <div className="card-peeker" aria-hidden="true"><motion.div style={{ y: calm ? 18 : peek }}><Mascot small species={species}/></motion.div></div>
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

    <div className="pet-perch pet-mat" aria-hidden="true"/>
    <div className="pet-nameplate"><span className="status-dot"/><strong>{name}</strong><span>·</span><span>{status}</span><PawPrint size={13}/></div>
  </div>
}

export function TreatTray({ petName = 'your pet', onFeed, onToy }: { petName?: string; onFeed: () => void; onToy: () => void }) {
  const calm = useCalm()
  return <><div className="tray treat-tray"><span className="tray-icon"><Bone/></span><span><strong>Treat tray</strong><small>Drag to your pet, or tap</small></span><div className="treats">{[0, 1, 2].map(i => <motion.button key={i} className="treat-piece" aria-label={`Give ${petName} treat ${i + 1}`} drag={!calm} dragSnapToOrigin dragElastic={.12} style={{ zIndex: 30 }} whileDrag={{ scale: 1.15 }} onClick={onFeed} onDragEnd={(_event, info) => { const r = document.querySelector('[data-pet-drop]')?.getBoundingClientRect(); if (r && info.point.x >= r.left && info.point.x <= r.right && info.point.y - window.scrollY >= r.top && info.point.y - window.scrollY <= r.bottom) onFeed() }}><Bone size={23}/></motion.button>)}</div></div><div className="tray toy-tray"><span className="tray-icon"><Ball/></span><span><strong>Toy box</strong><small>A little joy break</small></span><motion.button className="toy-piece" aria-label={`Play fetch with ${petName}`} onClick={onToy} whileHover={calm ? undefined : { y: [0, -7, 0] }} transition={{ duration: .36 }}><Ball size={27}/></motion.button></div></>
}

export function PeekScene({ run, petName = 'Your pet', species = 'dog', hasPet = true }: { run?: RunState; petName?: string; species?: Species; hasPet?: boolean }) {
  const working = run?.status === 'running' || run?.status === 'queued', success = run?.status === 'complete'
  const papers = Math.min(5, run?.events.filter(e => e.type === 'tool.end').length ?? 0)
  return <div className={`peek-scene ${working ? 'working' : ''} ${success ? 'succeeded' : ''} ${run?.status === 'error' ? 'sheepish' : ''}`}><div className="peek-vignette" aria-hidden="true"><div className="peek-mascot">{hasPet ? <Mascot small species={species} sleepy={!run || run.status === 'error'}/> : <div className="peek-symbol-disc"><PawPrint size={26}/></div>}</div><div className="paper-pile">{Array.from({ length: papers || 1 }, (_, i) => <motion.i key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: -i * 5, rotate: i % 2 ? 5 : -4 }} transition={{ duration: .24 }}/>)}</div><span className="dust-puff"/><span className="dust-puff second"/></div><span className="peek-copy"><strong>{hasPet ? (working ? `${petName} is on it` : success ? 'Fetched with love.' : run?.status === 'error' ? 'A little ruffled.' : run?.status === 'approval' ? 'A paw of approval?' : 'Run log is ready') : 'No companion yet'}</strong><small>{hasPet ? (working ? 'A little busywork, off your plate.' : run?.status === 'error' ? 'Open the log. We\u2019ll untangle it.' : 'Click to see recent errands') : 'Add a pet to start running errands'}</small></span></div>
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
  return <section className="desk-suggestions" aria-labelledby="suggestion-title"><Reveal><div className="section-caption"><PawPrint size={21}/><span>Big help. Little companion.</span><span className="caption-line"/></div><div className="suggestion-heading"><h2 id="suggestion-title">More headspace.<br/><em>Less busywork.</em></h2><p>A few things your pet can take off your plate.<br/>You bring the idea. We&rsquo;ll bring it back.</p></div></Reveal><div className="suggestion-grid">{[
    { icon: FileText, title: 'Find that one file.', text: 'A quick search across your Drive, right here.', prompt: 'find my budget sheet', kind: 'sage' },
    { icon: Bone, title: 'Bring everyone up to speed.', text: 'Notes drafted and ready for your sign-off.', prompt: 'email the standup notes to my team', kind: 'peach' },
    { icon: Leaf, title: 'Make room for focus.', text: 'A clear look at what the rest of your day holds.', prompt: 'show my calendar for today', kind: 'lavender' }
  ].map((item, i) => <Reveal key={item.title} delay={i * .07}><MagneticButton className={`suggestion-card ${item.kind}`} onClick={() => onChoose(item.prompt)}><span className="suggestion-icon"><item.icon size={32}/></span><strong>{item.title}</strong><span>{item.text}</span><span className="suggestion-arrow">↗</span></MagneticButton></Reveal>)}</div><Reveal><div className="end-note"><PawPrint size={17}/><span>A good day starts with a little company.</span><span>Made for your kind of work.</span></div></Reveal></section>
}

export function useCondensedHeader() {
  const { scrollY } = useScroll(), [condensed, setCondensed] = useState(false)
  useMotionValueEvent(scrollY, 'change', value => setCondensed(value > 40))
  return condensed
}
