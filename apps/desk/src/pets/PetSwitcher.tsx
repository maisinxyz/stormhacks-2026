import { useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { PetBundle } from '../contracts'
import '../create/create.css'
import type { PetSync, ServerStatus } from './usePetSync'

const speciesLabel: Record<string, string> = { dog: 'Dog', cat: 'Cat' }
const glyph: Record<string, string> = { dog: '◕ᴥ◕', cat: '◡ᴗ◡' }

export function PetAvatar({ pet, size = 32 }: { pet: PetBundle | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (pet?.thumbnailUrl && !broken) return <img className="pet-avatar pet-thumb" src={pet.thumbnailUrl} alt="" width={size} height={size} onError={() => setBroken(true)} />
  return <span className={`pet-avatar ${pet?.species ?? 'dog'}-avatar`} style={{ fontSize: size > 30 ? 13 : 10 }} aria-hidden="true">{pet ? (glyph[pet.species] ?? '🐾') : '🐾'}</span>
}

export function PetSwitcher({ pets, activePet, sync, onCreate }: { pets: PetBundle[]; activePet: PetBundle | null; sync: PetSync; onCreate: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState('')
  const online = sync.status === 'online'

  const remove = async (pet: PetBundle) => {
    setError('')
    const next = pet.id === activePet?.id ? pets.find((item) => item.id !== pet.id)?.id ?? null : undefined
    try { await sync.remove(pet.id, next); setConfirming(null) } catch { setError(`Couldn't delete ${pet.name}. Is the server running?`) }
  }

  return <div className="pet-switch">
    <button className="pet-switcher" onClick={() => (pets.length ? setOpen(!open) : onCreate())} aria-expanded={open} aria-haspopup="listbox">
      <PetAvatar pet={activePet} />
      <span className="pet-switcher-copy"><strong>{activePet?.name ?? 'No pet yet'}</strong><small>{activePet ? `${speciesLabel[activePet.species]} · ${online ? 'online' : 'demo'}` : online ? 'Create your first pet' : 'Start the server to create pets'}</small></span>
      <ChevronDown size={15} className={open ? 'chevron-open' : ''} />
    </button>
    {open && <ul className="pet-list" role="listbox" aria-label="Your pets">
      {pets.map((pet) => <li key={pet.id} className={pet.id === activePet?.id ? 'current' : ''}>
        {confirming === pet.id
          ? <div className="pet-confirm" role="alertdialog" aria-label={`Delete ${pet.name}?`}><span>Delete {pet.name} for good?</span><button className="pet-confirm-yes" onClick={() => void remove(pet)}>Delete</button><button onClick={() => setConfirming(null)} autoFocus>Keep</button></div>
          : <>
            <button className="pet-row" role="option" aria-selected={pet.id === activePet?.id} onClick={() => { sync.select(pet.id); setOpen(false) }}><PetAvatar pet={pet} size={26} /><span><strong>{pet.name}</strong><small>{speciesLabel[pet.species]}</small></span></button>
            {online && <button className="pet-delete" aria-label={`Delete ${pet.name}`} onClick={() => setConfirming(pet.id)}><Trash2 size={13} /></button>}
          </>}
      </li>)}
      {error && <li className="pet-list-error" role="alert">{error}</li>}
    </ul>}
    <button className="add-pet" onClick={onCreate}><Plus size={15} /> Add a pet</button>
  </div>
}

export function ServerPill({ status, mockGen }: { status: ServerStatus; mockGen: boolean }) {
  if (status === 'checking') return null
  if (status === 'offline') return <span className="demo-pill" title="Run `pnpm dev` in apps/server to create and save pets"><span className="demo-dot" /> Server offline · demo mode</span>
  return mockGen ? <span className="demo-pill" title="The server is running with MOCK_GEN=1"><span className="demo-dot" /> Mock 3D</span> : null
}
