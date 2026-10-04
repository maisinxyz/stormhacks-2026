import { useEffect, useRef, useState } from 'react'
import { Camera, RotateCcw } from 'lucide-react'

type Problem = 'blocked' | 'none' | 'busy' | 'unsupported' | 'other'

/** Why the camera did not open, in words the person can act on. */
const why: Record<Problem, [string, string]> = {
  blocked: ['Camera access is blocked', 'Click the camera icon in the address bar, choose Allow, then press Try again.'],
  none: ['No camera found', 'Plug in or turn on a camera, then press Try again. Or upload a photo instead.'],
  busy: ['Another app or tab is using the camera', 'Close it (for example the Play camera view in another tab), then press Try again.'],
  unsupported: ['This browser cannot open a camera', 'Use Chrome, Edge or Safari, or upload a photo instead.'],
  other: ['We could not open your camera', 'Press Try again, or upload a photo instead.'],
}
const problemOf = (err: unknown): Problem => {
  const name = (err as DOMException | undefined)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'none'
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy'
  return 'other'
}

/** getUserMedia snapshot -> JPEG Blob. Stops the camera on unmount or once a shot is taken. */
export function CameraCapture({ onCapture }: { onCapture: (image: Blob) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [state, setState] = useState<'starting' | 'live' | Problem>('starting')
  const [ready, setReady] = useState(false) // the first real frame has arrived: a shot taken before that would be empty
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return }
    setState('starting'); setReady(false)
    // Phones: the back camera suits a pet photo. Computers: any camera, no constraints that a webcam could refuse.
    const phone = matchMedia('(pointer: coarse)').matches
    const first: MediaStreamConstraints = { video: phone ? { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } : { width: { ideal: 1280 } }, audio: false }
    navigator.mediaDevices.getUserMedia(first)
      .catch((err) => { // a constraint the device refuses: try again with none at all (permission errors are not retried)
        if (problemOf(err) === 'none' || (err as DOMException)?.name === 'OverconstrainedError') return navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        throw err
      })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
        stream.current = s
        const v = video.current
        if (v) { v.srcObject = s; void v.play().catch(() => {}) }
        setState('live')
      })
      .catch((err) => { console.warn('camera did not open', err); if (!cancelled) setState(problemOf(err)) })
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

  if (state !== 'starting' && state !== 'live') {
    const [title, hint] = why[state]
    return <div className="cp-drop cp-note"><strong>{title}</strong><small>{hint}</small><button className="cp-ghost" onClick={() => setAttempt((a) => a + 1)}><RotateCcw size={14} /> Try again</button></div>
  }
  return <div className="cp-camera">
    <video ref={video} playsInline muted aria-label="Camera preview" onPlaying={() => setReady(true)} onLoadedData={() => setReady(true)} />
    {!ready && <span className="cp-camera-wait">{state === 'starting' ? 'Opening camera… allow access if your browser asks' : 'Getting the picture…'}</span>}
    <button className="cp-shutter" onClick={snap} disabled={!ready}><Camera size={16} /> Take photo</button>
  </div>
}
