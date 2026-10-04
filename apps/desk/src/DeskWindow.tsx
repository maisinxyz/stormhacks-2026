import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { animate, motion, useAnimationControls, useDragControls, useInView, useMotionValue, type PanInfo } from 'motion/react'
import { ChevronDown, ExternalLink, FileText, Inbox, MoreHorizontal } from './icons'
import { CardPeeker, Mascot } from './DeskLife'
import { platformsChanged, spring, useCalm } from './motion'
import type { Mode, PlatformRect } from './contracts'

export type DeskRect = PlatformRect & { zIndex?: number }
export function DeskWindow({ id, title, eyebrow, Icon, className, rect, zIndex, active, onActivate, onRectChange, mode }: { id: string; title: string; eyebrow: string; Icon: typeof Inbox; className: string; rect: DeskRect; zIndex: number; active: boolean; onActivate: () => void; onRectChange: (rect: Partial<DeskRect>) => void; mode: Mode }) {
  const calm = useCalm(), ref = useRef<HTMLElement>(null), visible = useInView(ref, { once: true, amount: .15 })
  const [worldWidth, setWorldWidth] = useState(900), [empty, setEmpty] = useState(false), [menu, setMenu] = useState(false), [dragging, setDragging] = useState(false)
  const controls = useAnimationControls(), dragControls = useDragControls(), x = useMotionValue(0), y = useMotionValue(0)
  const moved = useRef(false), pendingCommit = useRef(false), interacting = useRef(false), motionEpoch = useRef(0)
  const [settlement, setSettlement] = useState(0)
  const resize = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const narrow = worldWidth < 590
  const compact = !narrow && worldWidth < 780
  const width = Math.min(rect.w, worldWidth - 32)
  const defaultTop = narrow ? ({ inbox: 85, calendar: 385, files: 685 }[id] ?? rect.y) : compact ? (id === 'files' ? 400 : 85) : rect.y
  const left = narrow && !moved.current ? 16 : id === 'calendar' && !moved.current ? Math.max(16, worldWidth - width - 30) : Math.max(16, Math.min(rect.x, worldWidth - width - 16))
  const top = moved.current ? rect.y : defaultTop
  const markMoving = (moving: boolean) => {
    if (ref.current) ref.current.dataset.platformMoving = String(moving)
    platformsChanged()
  }
  const stopCardMotion = () => { motionEpoch.current++; controls.stop(); x.stop(); y.stop(); x.set(0); y.set(0); controls.set({ opacity: 1 }); interacting.current = false }
  useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => setWorldWidth(parent.clientWidth))
    observer.observe(parent); setWorldWidth(parent.clientWidth)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    if (calm) { controls.set({ opacity: 1, y: 0 }); markMoving(false); return }
    markMoving(true)
    const index = id === 'inbox' ? 0 : id === 'calendar' ? 1 : 2
    void controls.start({ opacity: 1, y: 0, transition: { ...spring.soft, delay: .12 + index * .08 } }).then(() => { if (cancelled || interacting.current) return; markMoving(false) })
    return () => { cancelled = true; controls.stop() }
  }, [visible, calm, controls])
  useLayoutEffect(() => {
    if (pendingCommit.current) { x.set(0); y.set(0); pendingCommit.current = false; markMoving(false) }
    else platformsChanged()
  }, [rect.x, rect.y, rect.w, rect.h, worldWidth, settlement, x, y])
  const dragEnd = async (_event: MouseEvent | TouchEvent | globalThis.PointerEvent, info: PanInfo) => {
    const epoch = motionEpoch.current
    const parent = ref.current!.parentElement!
    const nextX = Math.round(Math.max(16, Math.min(left + info.offset.x + (calm ? 0 : Math.max(-14, Math.min(14, info.velocity.x * .025))), worldWidth - width - 16)))
    const nextY = Math.round(Math.max(62, Math.min(top + info.offset.y + (calm ? 0 : Math.max(-14, Math.min(14, info.velocity.y * .025))), parent.clientHeight - rect.h - 16)))
    if (!calm) await Promise.all([animate(x, nextX - left, spring.soft), animate(y, nextY - top, spring.soft)])
    if (epoch !== motionEpoch.current) return
    moved.current = true; interacting.current = false; setDragging(false)
    pendingCommit.current = true
    onRectChange({ x: nextX, y: nextY }); setSettlement(v => v + 1)
  }
  const startResize = (event: PointerEvent<HTMLButtonElement>) => { event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); stopCardMotion(); interacting.current = true; markMoving(true); onActivate(); resize.current = { x: event.clientX, y: event.clientY, w: width, h: rect.h } }
  const moveResize = (event: PointerEvent<HTMLButtonElement>) => { if (!resize.current) return; const r = resize.current; onRectChange({ w: Math.max(230, Math.min(worldWidth - left - 16, r.w + event.clientX - r.x)), h: Math.max(160, Math.min(430, r.h + event.clientY - r.y)) }) }
  const endResize = () => { resize.current = null; interacting.current = false; markMoving(false) }
  const keyMove = (event: React.KeyboardEvent, sizing = false) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation(); stopCardMotion(); onActivate(); moved.current = true
    const delta = event.shiftKey ? 24 : 8
    const dx = event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0
    const dy = event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0
    markMoving(true); pendingCommit.current = true
    onRectChange(sizing ? { w: Math.max(230, Math.min(worldWidth - left - 16, width + dx)), h: Math.max(160, Math.min(430, rect.h + dy)) } : { x: Math.max(16, Math.min(worldWidth - width - 16, left + dx)), y: Math.max(62, Math.min(ref.current!.parentElement!.clientHeight - rect.h - 16, top + dy)) })
    setSettlement(v => v + 1)
  }
  return <motion.article ref={ref} data-platform-id={id} data-platform-moving={calm ? 'false' : 'true'} className={`desk-window ${className} ${active ? 'active' : ''} ${mode === 'play' ? 'dimmed' : ''} ${dragging ? 'dragging' : ''}`} style={{ left, top, width, height: rect.h, zIndex: dragging ? 20 : zIndex, x, y }} initial={calm ? false : { opacity: 0, y: -22 }} animate={controls} drag dragListener={false} dragControls={dragControls} dragMomentum={false} dragElastic={.08} onDragStart={() => { interacting.current = true; markMoving(true); setDragging(true); onActivate() }} onDragEnd={dragEnd} onClick={event => { event.stopPropagation(); onActivate() }}>
    {id === 'calendar' && <CardPeeker/>}<div className="window-paper" aria-hidden="true"/>
    <div className="window-top"><button className="window-drag-handle" aria-label={`Move ${title}. Use arrow keys to move, Shift for larger steps.`} onKeyDown={event => keyMove(event)} onPointerDown={event => { if (!event.isPrimary || event.button !== 0) return; stopCardMotion(); markMoving(false); dragControls.start(event) }}><span className="window-icon"><Icon size={19}/></span><span><small>{eyebrow}</small><strong>{title}</strong></span><span className="drag-grip" aria-hidden="true">⠿</span></button><button className="window-menu" aria-label={`${title} menu`} aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={19}/></button></div>
    {menu && <div className="window-popover"><button onClick={() => { setEmpty(!empty); setMenu(false) }}>{empty ? 'Show recent items' : 'Show quiet view'}</button></div>}
    {empty ? <div className="quiet-card"><Mascot sleepy small/><strong>{id === 'inbox' ? 'Inbox at peace.' : 'A little breathing room.'}</strong><span>{id === 'inbox' ? 'Not a peep. Enjoy the quiet.' : 'Your companion keeps watch.'}</span></div> : <>
    {id === 'inbox' && <div tabIndex={0} className="window-body inbox-body"><div className="quiet-card"><Mascot sleepy small/><strong>Connect your inbox.</strong><span>Link Gmail in Settings and your unread mail will appear here.</span></div></div>}
    {id === 'files' && <div tabIndex={0} className="window-body file-body"><div className="quiet-card"><Mascot sleepy small/><strong>Connect Drive.</strong><span>Link Google Drive and recent files will show up here.</span></div><div className="window-link">Open files <ExternalLink size={13}/></div></div>}
    {id === 'calendar' && <div tabIndex={0} className="window-body calendar-body"><div className="quiet-card"><Mascot sleepy small/><strong>Connect Calendar.</strong><span>Link Google Calendar to see your day at a glance.</span></div><div className="window-link">Open calendar <ExternalLink size={13}/></div></div>}
    </>}
    <button className="window-resize" aria-label={`Resize ${title}`} onKeyDown={event => keyMove(event, true)} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize}>⌟</button>
  </motion.article>
}
