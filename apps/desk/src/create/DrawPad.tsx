import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { Brush, Eraser, RotateCcw, Trash2 } from 'lucide-react'

const PAPER = '#ffffff'
const W = 640, H = 400

/** In-app drawing pad (PRD 2.3): brush, color, eraser, undo, clear. Reports a PNG Blob after every stroke (null when blank). */
export function DrawPad({ onChange }: { onChange: (image: Blob | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const history = useRef<ImageData[]>([])
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush')
  const [color, setColor] = useState('#3b2a1e')
  const [size, setSize] = useState(8)
  const [, setVersion] = useState(0)

  const ctx = () => canvas.current?.getContext('2d') ?? null
  const fill = () => { const c = ctx(); if (c) { c.fillStyle = PAPER; c.fillRect(0, 0, W, H) } }
  useEffect(fill, [])

  const emit = () => {
    const blank = history.current.length === 0
    if (blank) { onChange(null); return }
    canvas.current?.toBlob((blob) => onChange(blob), 'image/png')
  }
  const snapshot = () => { const c = ctx(); if (c) { history.current = [...history.current.slice(-19), c.getImageData(0, 0, W, H)]; setVersion((v) => v + 1) } }
  const point = (event: PointerEvent<HTMLCanvasElement>) => { const r = canvas.current!.getBoundingClientRect(); return { x: (event.clientX - r.left) * W / r.width, y: (event.clientY - r.top) * H / r.height } }

  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    const c = ctx(); if (!c) return
    snapshot(); drawing.current = true
    canvas.current!.setPointerCapture(event.pointerId)
    const p = point(event)
    c.strokeStyle = tool === 'eraser' ? PAPER : color
    c.lineWidth = tool === 'eraser' ? size * 3 : size
    c.lineCap = 'round'; c.lineJoin = 'round'
    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + 0.01, p.y); c.stroke()
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => { if (!drawing.current) return; const c = ctx(); if (c) { const p = point(event); c.lineTo(p.x, p.y); c.stroke() } }
  const up = () => { if (!drawing.current) return; drawing.current = false; emit() }
  const undo = () => { const prev = history.current.pop(); const c = ctx(); if (prev && c) { c.putImageData(prev, 0, 0); setVersion((v) => v + 1); emit() } }
  const clear = () => { fill(); history.current = []; setVersion((v) => v + 1); onChange(null) }

  return <div className="cp-draw">
    <div className="cp-draw-tools" role="toolbar" aria-label="Drawing tools">
      <button className={tool === 'brush' ? 'on' : ''} onClick={() => setTool('brush')} aria-pressed={tool === 'brush'}><Brush size={14} /> Brush</button>
      <button className={tool === 'eraser' ? 'on' : ''} onClick={() => setTool('eraser')} aria-pressed={tool === 'eraser'}><Eraser size={14} /> Eraser</button>
      <label className="cp-color" title="Brush color"><input type="color" value={color} onChange={(e) => { setColor(e.target.value); setTool('brush') }} aria-label="Brush color" /></label>
      <input type="range" min={2} max={28} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Brush size" />
      <span className="cp-spacer" />
      <button onClick={undo} disabled={!history.current.length} aria-label="Undo"><RotateCcw size={14} /></button>
      <button onClick={clear} disabled={!history.current.length} aria-label="Clear drawing"><Trash2 size={14} /></button>
    </div>
    <canvas ref={canvas} width={W} height={H} className="cp-draw-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Drawing pad: draw your pet" />
    <small>Draw the whole animal, side-on if you can. Rough is perfect.</small>
  </div>
}
