import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { MotionConfig, motion, useMotionValue, useReducedMotion, useSpring, type HTMLMotionProps } from 'motion/react'
import type { PetEngine, PlatformRect } from './contracts'

export const timing = { quick: .16, normal: .24, reveal: .36, scene: .4 }
export const ease = { out: [.22, 1, .36, 1] as const, inOut: [.65, 0, .35, 1] as const }
export const spring = { soft: { type: 'spring' as const, duration: .38, bounce: .18 }, magnetic: { stiffness: 350, damping: 28, mass: .5 } }
const CalmContext = createContext(false)
export const useCalm = () => useContext(CalmContext)
export function MotionProvider({ reduced, children }: { reduced: boolean; children: ReactNode }) {
  const preference = useReducedMotion()
  const calm = reduced || !!preference
  return <CalmContext.Provider value={calm}><MotionConfig reducedMotion={calm ? 'always' : 'never'} transition={{ duration: timing.normal, ease: ease.out }}>{children}</MotionConfig></CalmContext.Provider>
}
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const calm = useCalm()
  return <motion.div className={className} initial={calm ? false : { opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .15 }} transition={{ duration: timing.reveal, delay: calm ? 0 : delay, ease: ease.out }}>{children}</motion.div>
}
export function MagneticButton({ children, className = '', ...props }: HTMLMotionProps<'button'>) {
  const calm = useCalm()
  const x = useMotionValue(0), y = useMotionValue(0)
  const sx = useSpring(x, spring.magnetic), sy = useSpring(y, spring.magnetic)
  return <motion.button {...props} className={`magnetic ${className}`} style={{ x: calm ? 0 : sx, y: calm ? 0 : sy }} whileTap={calm ? undefined : { scale: .96 }} onPointerMove={event => {
    if (calm || event.pointerType !== 'mouse') return
    const r = event.currentTarget.getBoundingClientRect()
    x.set((event.clientX - r.left - r.width / 2) * .08); y.set((event.clientY - r.top - r.height / 2) * .08)
  }} onPointerLeave={() => { x.set(0); y.set(0) }}>{children}</motion.button>
}

export const platformsChanged = () => window.dispatchEvent(new Event('fetch:platforms'))
/** Report actual viewport rectangles. Moving cards leave the platform set until settled. */
export function usePlatforms(engine: PetEngine, canvas?: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    let frame = 0, previous = '', disposed = false
    const measure = () => {
      frame = 0
      const platforms: PlatformRect[] = []
      const origin = canvas?.current?.getBoundingClientRect()
      document.querySelectorAll<HTMLElement>('[data-platform-id]').forEach(card => {
        if (card.dataset.platformMoving === 'true') return
        const r = card.getBoundingClientRect()
        platforms.push({ id: card.dataset.platformId!, x: r.x - (origin?.x ?? 0), y: r.y - (origin?.y ?? 0), w: r.width, h: r.height, kind: 'window' })
      })
      const next = JSON.stringify(platforms)
      if (next !== previous) { previous = next; engine.setPlatforms(platforms) }
    }
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(measure) }
    // Synchronous removal happens before a drag/entrance can move a platform.
    const changed = () => { if (frame) cancelAnimationFrame(frame); measure() }
    const observer = new ResizeObserver(schedule)
    document.querySelectorAll('[data-platform-id], .canvas-world, .desk').forEach(el => observer.observe(el))
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule)
    window.addEventListener('fetch:platforms', changed)
    void document.fonts.ready.then(schedule)
    measure()
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); window.removeEventListener('fetch:platforms', changed) }
  }, [engine, canvas])
}

/** Pointer ripple is a separate compositor layer; keyboard activation gets the normal press state. */
export function useRipples(root: React.RefObject<HTMLElement | null>, calm: boolean) {
  useEffect(() => {
    const el = root.current
    if (!el || calm) return
    const down = (event: globalThis.PointerEvent) => {
      const button = (event.target as HTMLElement).closest('button')
      if (!button || button.classList.contains('window-resize')) return
      const r = button.getBoundingClientRect(), ripple = document.createElement('span')
      ripple.className = 'click-ripple'; ripple.setAttribute('aria-hidden', 'true')
      ripple.style.left = `${event.clientX - r.left}px`; ripple.style.top = `${event.clientY - r.top}px`
      button.append(ripple); ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
    }
    el.addEventListener('pointerdown', down)
    return () => { el.removeEventListener('pointerdown', down); el.querySelectorAll('.click-ripple').forEach(r => r.remove()) }
  }, [root, calm])
}

export function useDialogFocus(open: boolean | string) {
  const previous = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!open) return
    previous.current = document.activeElement as HTMLElement
    const frame = requestAnimationFrame(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
      dialog?.querySelector<HTMLElement>('button, input, [tabindex="0"]')?.focus()
    })
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
      const nodes = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])].filter(el => el.getClientRects().length)
      if (!nodes.length) return
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', trap)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', trap); previous.current?.focus() }
  }, [open])
}
