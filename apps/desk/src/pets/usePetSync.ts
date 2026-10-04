// Keeps the store's pets in sync with the server: GET /session + GET /pets on load, PATCH /session on switch.
// If the server is unreachable the desk stays in offline demo mode with the built-in demo pet.
import { useCallback, useEffect, useState } from 'react'
import type { PetBundle } from '../contracts'
import { deletePet, fetchSession, listPets, setActivePet } from './petApi'

export type ServerStatus = 'checking' | 'online' | 'offline'

interface PetStore {
  setPets: (pets: PetBundle[], activePetId: string | null) => void
  addPet: (pet: PetBundle) => void
  selectPet: (id: string) => void
  removePet: (id: string) => void
}

export function usePetSync(store: PetStore) {
  const { setPets, addPet, selectPet, removePet } = store
  const [status, setStatus] = useState<ServerStatus>('checking')
  const [mockGen, setMockGen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [session, { pets, mockGen }] = await Promise.all([fetchSession(), listPets()])
      const active = pets.find((pet) => pet.id === session.activePetId) ?? pets[pets.length - 1] ?? null
      setPets(pets, active?.id ?? null)
      setMockGen(mockGen)
      setStatus('online')
    } catch (err) {
      console.info('Fetch server unreachable, staying in offline demo mode:', err)
      setStatus('offline')
    }
  }, [setPets])

  useEffect(() => { void refresh() }, [refresh])

  const select = useCallback((id: string) => {
    selectPet(id)
    if (status === 'online') void setActivePet(id).catch((err) => console.warn('PATCH /session failed:', err))
  }, [selectPet, status])

  /** A freshly generated pet: add it, make it active on the server, optionally replace an older (flat) version. */
  const created = useCallback(async (pet: PetBundle, replaces?: string) => {
    addPet(pet)
    await setActivePet(pet.id).catch((err) => console.warn('PATCH /session failed:', err))
    if (replaces) { removePet(replaces); await deletePet(replaces).catch((err) => console.warn('could not delete replaced pet:', err)) }
  }, [addPet, removePet])

  /** DELETE /pets/:id; when the active pet goes, `nextActive` becomes active on the server too. */
  const remove = useCallback(async (id: string, nextActive?: string | null) => {
    await deletePet(id)
    removePet(id)
    if (nextActive !== undefined) await setActivePet(nextActive).catch((err) => console.warn('PATCH /session failed:', err))
  }, [removePet])

  return { status, mockGen, refresh, select, created, remove }
}

export type PetSync = ReturnType<typeof usePetSync>
