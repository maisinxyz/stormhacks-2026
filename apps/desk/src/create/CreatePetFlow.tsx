// PRD 2.3: species -> photo / camera + name -> real generatePet with live stages -> desk.
// Drawing removed (F2 polish pass). Only photo and camera capture are supported.
// Errors are designed (PRD 2.10): gen_quota shows the wait + retry; a flat sprite fallback is announced with Retry in 3D.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, ImagePlus, RotateCcw, Sparkles, Upload, X } from 'lucide-react'
import type { PetBundle } from '../contracts'
import type { DeskEngine, GenerateProgress } from '../engine/deskEngine'
import type { ServerStatus } from '../pets/usePetSync'
import { CameraCapture } from './CameraCapture'
import { KNOWN_DOGS, knownDog, type KnownDog } from '@fetch/web/src/engine/sdf/known'
import './create.css'
import { errorCopy, fallbackReason, stageCopy, stageLabel, stagePlan, type StageId } from './genCopy'

type Species = 'dog' | 'cat'
type Source = 'upload' | 'camera'
type Step = 'species' | 'input' | 'generating' | 'fallback' | 'error'

const SPECIES: { id: Species; label: string; glyph: string; blurb: string; defaultName: string }[] = [
  { id: 'dog', label: 'Dog', glyph: '◕ᴥ◕', blurb: 'Eager & loyal', defaultName: 'Biscuit' },
  { id: 'cat', label: 'Cat', glyph: '◡ᴗ◡', blurb: 'Sassy & capable', defaultName: 'Miso' },
]

interface Props {
  engine: DeskEngine
  serverStatus: ServerStatus
  /** Persist + activate the new pet (PATCH /session); `replaces` is an older flat version to delete. */
  onCreated: (pet: PetBundle, replaces?: string) => Promise<void>
  onFinished: (pet: PetBundle) => void
  onClose: () => void
}

async function createSamplePhoto(species: Species): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 400
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(200, 200, 30, 200, 200, 240)
  if (species === 'cat') {
    gradient.addColorStop(0, '#fde2e4')
    gradient.addColorStop(1, '#ffcad4')
  } else {
    gradient.addColorStop(0, '#e2ece9')
    gradient.addColorStop(1, '#bee1e6')
  }
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 400, 400)
  ctx.font = '100px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(species === 'cat' ? '🐱' : '🐶', 200, 180)
  ctx.font = '600 24px sans-serif'
  ctx.fillStyle = '#2b2d42'
  ctx.fillText(species === 'cat' ? 'Sample Cat' : 'Sample Dog', 200, 290)
  return new Promise(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
}

export function CreatePetFlow({ engine, serverStatus, onCreated, onFinished, onClose }: Props) {
  const [step, setStep] = useState<Step>('species')
  const [species, setSpecies] = useState<Species>('dog')
  const [source, setSource] = useState<Source>('upload')
  const [images, setImages] = useState<Partial<Record<Source, Blob | null>>>({})
  const [name, setName] = useState('')
  const [matched, setMatched] = useState<KnownDog | null>(null)
  const [progress, setProgress] = useState<GenerateProgress>({ stage: 'upload', pct: 0 })
  const [seen, setSeen] = useState<string[]>([])
  const [failure, setFailure] = useState<{ code: string; retryAfter?: number } | null>(null)
  const [flat, setFlat] = useState<{ pet: PetBundle; code?: string } | null>(null)
  const [samplePending, setSamplePending] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const running = useRef(false)
  const sampleTimer = useRef<number | null>(null)

  const image = images[source] ?? null
  const petName = name.trim() || SPECIES.find((s) => s.id === species)!.defaultName
  const preview = useMemo(() => (image ? URL.createObjectURL(image) : ''), [image])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
    if (sampleTimer.current) window.clearTimeout(sampleTimer.current)
  }, [preview])
  useEffect(() => { if (step !== 'generating') return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [step])

  const handleImagePicked = async (blob: Blob) => {
    setImages(prev => ({ ...prev, [source]: blob }))
    try {
      const known = await knownDog(blob)
      if (known) {
        setMatched(known)
        setSpecies(known.species)
        if (!name || name === 'Biscuit' || name === 'Miso') setName(known.name)
      } else {
        setMatched(null)
      }
    } catch (e) {
      console.warn('could not test known dog:', e)
      setMatched(null)
    }
  }

  const loadKnownSample = async (k: KnownDog) => {
    if (sampleTimer.current) window.clearTimeout(sampleTimer.current)
    try {
      const res = await fetch(k.photo)
      const blob = await res.blob()
      await handleImagePicked(blob)
      setSpecies(k.species)
      setName(k.name)
      setMatched(k)
      setSamplePending(true)
      sampleTimer.current = window.setTimeout(() => {
        setSamplePending(false)
        void run(undefined, { image: blob, species: k.species, name: k.name })
      }, 700)
    } catch {
      const blob = await createSamplePhoto(k.species)
      await handleImagePicked(blob)
      setSpecies(k.species)
      setName(k.name)
      setMatched(null)
      setSamplePending(true)
      sampleTimer.current = window.setTimeout(() => {
        setSamplePending(false)
        void run(undefined, { image: blob, species: k.species, name: k.name })
      }, 700)
    }
  }

  const run = async (replaces?: string, override: { image?: Blob; species?: Species; name?: string } = {}) => {
    const sourceImage = override.image ?? image
    const sourceSpecies = override.species ?? species
    const sourceName = override.name ?? petName
    if (!sourceImage || running.current) return
    running.current = true
    setStep('generating'); setFailure(null); setSeen([]); setProgress({ stage: 'upload', pct: 0 }); setStartedAt(Date.now()); setNow(Date.now())
    let fellBack: string | undefined
    try {
      const generated = await engine.generatePet({ kind: 'photo', image: sourceImage, species: sourceSpecies, name: sourceName }, (p) => {
        if (p.stage === 'fallback') fellBack = p.detail ?? 'gen_failed'
        setProgress(p)
        setSeen((list) => (list.includes(p.stage) ? list : [...list, p.stage]))
      })
      const pet = generated as PetBundle
      await onCreated(pet, replaces)
      if (fellBack) { setFlat({ pet, code: fellBack }); setStep('fallback') } else onFinished(pet)
    } catch (err) {
      const e = err as { code?: string; retryAfter?: number }
      setFailure({ code: err instanceof TypeError ? 'offline' : e.code ?? 'gen_failed', retryAfter: e.retryAfter })
      setStep('error')
    } finally { running.current = false }
  }

  // Known/sample pets are bundled in the client, so they can still be created when
  // the persistence service is unavailable. Custom photos still need the server.
  const offline = serverStatus === 'offline' && !matched
  const stepNo = step === 'species' ? 1 : step === 'input' ? 2 : 3

  return <div className="modal-backdrop"><section className="onboarding cp" role="dialog" aria-modal="true" aria-labelledby="cp-title">
    <button className="modal-close" onClick={onClose} aria-label={step === 'generating' ? 'Hide (creation keeps going)' : 'Close'}><X /></button>
    <div className="modal-kicker">A new companion</div>
    {step === 'species' && <>
      <h2 id="cp-title">Let's make your pet.</h2>
      <p className="modal-intro">A photo of your pet becomes a 3D companion that lives on your desk.</p>
      <Steps n={stepNo} />
      <div className="species-grid cp-species">{SPECIES.map((item) => <button key={item.id} className={`species-card ${species === item.id ? 'chosen' : ''}`} onClick={() => setSpecies(item.id)} aria-pressed={species === item.id}><span className={`species-glyph ${item.id}`}>{item.glyph}</span><strong>{item.label}</strong><small>{item.blurb}</small></button>)}</div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '14px', alignItems: 'center' }}>
        <button className="primary-button" style={{ flex: 1 }} onClick={() => setStep('input')}>Choose {species === 'dog' ? 'Dog' : 'Cat'} <span>→</span></button>
        <button type="button" className="text-button" onClick={onClose} style={{ padding: '0 12px' }}>Explore Desk</button>
      </div>
    </>}

    {step === 'input' && <>
      <h2 id="cp-title">Show us your {species}.</h2>
      <p className="modal-intro">Upload an image of your pet or pick a sample photo to create a 3D model.</p>
      <Steps n={stepNo} />
      <div className="input-tabs" role="tablist">
        <button role="tab" aria-selected={source === 'upload'} className={source === 'upload' ? 'active' : ''} onClick={() => setSource('upload')}><Upload size={13} /> Upload image</button>
        <button role="tab" aria-selected={source === 'camera'} className={source === 'camera' ? 'active' : ''} onClick={() => setSource('camera')}><Camera size={13} /> Take photo</button>
      </div>
      {source === 'upload' && (image ? <Picked url={preview} onReset={() => { setImages({ ...images, upload: null }); setMatched(null) }} /> : <UploadZone onPick={handleImagePicked} />)}
      {source === 'camera' && (image ? <Picked url={preview} onReset={() => { setImages({ ...images, camera: null }); setMatched(null) }} label="Retake" /> : <CameraCapture onCapture={handleImagePicked} />)}

      <div style={{ margin: '14px 0 10px' }}>
        <div style={{ fontSize: '11px', color: '#748380', marginBottom: '7px', fontWeight: 600 }}>Or choose a sample pet:</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {KNOWN_DOGS.slice(0, 6).map((k) => (
            <button key={k.id} type="button" disabled={samplePending} className="text-button" style={{ fontSize: '0.8rem', padding: '4px 9px', borderRadius: '6px', background: '#f0f3eb', border: '1px solid #dce2d8', color: '#384d46', cursor: samplePending ? 'wait' : 'pointer' }} onClick={() => void loadKnownSample(k)}>
              {k.species === 'dog' ? '🐶' : '🐱'} {k.name} ({k.species})
            </button>
          ))}
        </div>
        {samplePending && <div className="cp-sample-loading" role="status">Preparing the 3D companion…</div>}
      </div>

      <div className="name-field"><label htmlFor="pet-name">What should we call them?</label><input id="pet-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${matched?.name || SPECIES.find((s) => s.id === species)!.defaultName}`} /></div>
      {offline && <p className="cp-banner" role="status">Custom photo creation needs the Fetch service. Choose a sample pet to continue offline.</p>}
      <div className="modal-actions"><button className="text-button" onClick={() => setStep('species')}>Back</button><button type="button" className="text-button" onClick={onClose} style={{ marginLeft: 'auto', marginRight: '8px' }}>Explore Desk</button><button className="primary-button compact" disabled={!image || offline || samplePending} onClick={() => void run()}>Create {petName} <Sparkles size={16} /></button></div>
    </>}

    {step === 'generating' && <Generating preview={preview} name={petName} species={species} progress={progress} seen={seen} elapsed={Math.max(0, Math.round((now - startedAt) / 1000))} />}

    {step === 'fallback' && flat && <div className="cp-result">
      <Thumb url={flat.pet.thumbnailUrl || preview} />
      <div>
        <h2 id="cp-title">{flat.pet.name} is here, but flat for now.</h2>
        <p>{fallbackReason(flat.code)} We made a flat cutout instead, so {flat.pet.name} can still move around your desk.</p>
        <div className="cp-actions"><button className="primary-button compact" onClick={() => void run(flat.pet.id)}><RotateCcw size={15} /> Retry in 3D</button><button className="text-button" onClick={() => onFinished(flat.pet)}>Keep the flat {flat.pet.name}</button></div>
      </div>
    </div>}

    {step === 'error' && failure && <ErrorView failure={failure} preview={preview} onRetry={() => void run(flat?.pet.id)} onBack={() => setStep('input')} />}
  </section></div>
}

function Steps({ n }: { n: number }) {
  return <div className="progress-steps"><span className="done">01</span><i /><span className={n >= 2 ? 'done' : ''}>02</span><i /><span className={n >= 3 ? 'done' : ''}>03</span></div>
}

function UploadZone({ onPick }: { onPick: (blob: Blob) => void }) {
  const [over, setOver] = useState(false)
  const [error, setError] = useState('')
  const take = (file?: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError("That file isn\u2019t an image. Try a JPG, PNG or WebP."); return }
    if (file.size > 10 * 1024 * 1024) { setError('That photo is over 10 MB. Try a smaller one.'); return }
    setError(''); onPick(file)
  }
  return <label className={`upload-zone cp-drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]) }}>
    <span><ImagePlus size={18} /></span><strong>Drop an image here</strong><small>or choose a file · JPG, PNG or WebP — whole pet in view</small>
    {error && <em role="alert">{error}</em>}
    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => take(e.target.files?.[0])} aria-label="Upload a photo of your pet" />
  </label>
}

function Picked({ url, onReset, label = 'Choose another' }: { url: string; onReset: () => void; label?: string }) {
  return <div className="cp-picked"><img src={url} alt="Your pet picture" /><button className="cp-ghost" onClick={onReset}><RotateCcw size={14} /> {label}</button></div>
}

function Thumb({ url }: { url: string }) {
  return url ? <img className="cp-thumb" src={url} alt="" /> : <span className="cp-thumb" />
}

function Generating({ preview, name, species, progress, seen, elapsed }: { preview: string; name: string; species: Species; progress: GenerateProgress; seen: string[]; elapsed: number }) {
  const plan: StageId[] = stagePlan()
  if (seen.includes('fallback')) plan.splice(plan.indexOf('3d') + 1, 0, 'fallback')
  const current = progress.stage
  const pct = Math.round(Math.min(1, progress.pct) * 100)
  const index = plan.indexOf(current as StageId)
  return <div className="cp-gen" aria-live="polite">
    <div className="cp-gen-head">
      <Thumb url={preview} />
      <div>
        <div className="modal-kicker">Building {name}</div>
        <h2 id="cp-title">{stageCopy(current, { name, species })}</h2>
        <p>{current === '3d' ? `${elapsed}s so far · you can close this window, ${name} will show up on your desk.` : current === 'fallback' ? 'Hang tight, almost there.' : 'This usually takes about a minute.'}</p>
      </div>
    </div>
    <div className="progress-track cp-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Pet creation progress"><span style={{ width: `${pct}%` }} /></div>
    <div className="cp-pct">{pct}%</div>
    <ol className="cp-stages">{plan.map((stage, i) => {
      const state = i < index || (stage === '3d' && seen.includes('fallback')) ? 'done' : i === index ? 'now' : 'todo'
      return <li key={stage} className={`${state} ${stage === 'fallback' ? 'warn' : ''}`}>{state === 'done' ? <Check size={12} /> : <span className="cp-dot" />}{stageLabel(stage)}</li>
    })}</ol>
  </div>
}

function ErrorView({ failure, preview, onRetry, onBack }: { failure: { code: string; retryAfter?: number }; preview: string; onRetry: () => void; onBack: () => void }) {
  const copy = errorCopy(failure.code, failure.retryAfter)
  return <div className="cp-result cp-error" role="alert">
    <Thumb url={preview} />
    <div>
      <h2 id="cp-title">{copy.title}</h2>
      <p>{copy.body}</p>
      <div className="cp-actions"><button className="primary-button compact" onClick={onRetry}><RotateCcw size={15} /> Try again</button><button className="text-button" onClick={onBack}>Use a different image</button></div>
      <small className="cp-code">Error code: {failure.code}</small>
    </div>
  </div>
}
