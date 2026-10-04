import { useEffect, useRef, useState } from 'react'
import { Camera, RotateCcw } from 'lucide-react'

/** getUserMedia snapshot -> JPEG Blob. Stops the camera on unmount or once a shot is taken. */
export function CameraCapture({ onCapture }: { onCapture: (image: Blob) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [state, setState] = useState<'starting' | 'live' | 'denied' | 'unsupported'>('starting')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return }
    setState('starting')
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
        stream.current = s
        if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}) }
        setState('live')
      })
      .catch(() => { if (!cancelled) setState('denied') })
    return () => { cancelled = true; stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null }
  }, [attempt])

  const snap = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    c.toBlob((blob) => { if (blob) { stream.current?.getTracks().forEach((t) => t.stop()); onCapture(blob) } }, 'image/jpeg', 0.92)
  }

  if (state === 'unsupported') return <div className="cp-drop cp-note"><strong>This browser can't open a camera</strong><small>Upload a photo instead.</small></div>
  if (state === 'denied') return <div className="cp-drop cp-note"><strong>We couldn't open your camera</strong><small>Allow camera access in the address bar, or upload a photo instead.</small><button className="cp-ghost" onClick={() => setAttempt((a) => a + 1)}><RotateCcw size={14} /> Try again</button></div>
  return <div className="cp-camera">
    <video ref={video} playsInline muted aria-label="Camera preview" />
    {state === 'starting' && <span className="cp-camera-wait">Opening camera…</span>}
    <button className="cp-shutter" onClick={snap} disabled={state !== 'live'}><Camera size={16} /> Take photo</button>
  </div>
}
