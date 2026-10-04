import { useCallback, useState } from 'react'
import type { Mode, PetBundle } from './contracts'
import { defaultSettings, type ApprovalState, type NotificationItem, type RunState, type SettingsState } from './api'

export interface FetchState {
  pets: PetBundle[]
  activePetId: string | null
  mode: Mode
  runs: RunState[]
  approvals: ApprovalState[]
  notifications: NotificationItem[]
  settings: SettingsState
  voice: { listening: boolean; speaking: boolean; micAvailable: boolean }
}

export function useFetchStore() {
  const [state, setState] = useState<FetchState>({ pets: [], activePetId: null, mode: 'work', runs: [], approvals: [], notifications: [], settings: defaultSettings, voice: { listening: false, speaking: false, micAvailable: true } })
  const setMode = useCallback((mode: Mode) => setState((current) => ({ ...current, mode })), [])
  const addPet = useCallback((pet: PetBundle) => setState((current) => ({ ...current, pets: [...current.pets, pet], activePetId: pet.id })), [])
  const setPets = useCallback((pets: PetBundle[], activePetId: string | null) => setState((current) => ({ ...current, pets, activePetId })), [])
  const selectPet = useCallback((activePetId: string) => setState((current) => ({ ...current, activePetId })), [])
  const removePet = useCallback((id: string) => setState((current) => { const pets = current.pets.filter((pet) => pet.id !== id); return { ...current, pets, activePetId: current.activePetId === id ? pets[0]?.id ?? null : current.activePetId } }), [])
  const addRun = useCallback((run: RunState) => setState((current) => ({ ...current, runs: [run, ...current.runs].slice(0, 8) })), [])
  const updateRun = useCallback((id: string, patch: Partial<RunState>) => setState((current) => ({ ...current, runs: current.runs.map((run) => run.id === id ? { ...run, ...patch } : run) })), [])
  const addApproval = useCallback((approval: ApprovalState) => setState((current) => ({ ...current, approvals: [approval, ...current.approvals] })), [])
  const removeApproval = useCallback((actionId: string) => setState((current) => ({ ...current, approvals: current.approvals.filter((approval) => approval.actionId !== actionId) })), [])
  const setNotifications = useCallback((notifications: NotificationItem[]) => setState((current) => ({ ...current, notifications })), [])
  const updateSettings = useCallback((patch: Partial<SettingsState>) => setState((current) => ({ ...current, settings: { ...current.settings, ...patch } })), [])
  const setVoice = useCallback((patch: Partial<FetchState['voice']>) => setState((current) => ({ ...current, voice: { ...current.voice, ...patch } })), [])
  return { state, setMode, addPet, setPets, selectPet, removePet, addRun, updateRun, addApproval, removeApproval, setNotifications, updateSettings, setVoice }
}
