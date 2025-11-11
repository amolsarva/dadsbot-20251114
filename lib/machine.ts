'use client'
import { create } from 'zustand'

type State =
  | 'idle'
  | 'calibrating'
  | 'recording'
  | 'thinking'
  | 'speakingPrep'
  | 'playing'
  | 'readyToContinue'
  | 'doneSuccess'

type Store = {
  state: State
  label: string
  disabled: boolean
  debugLog: string[]
  elapsedMs?: number
  primary: () => void
  setDisabled: (value: boolean) => void
  toDone: () => void
  pushLog: (message: string) => void
}

function computeLabel(state: State): string {
  switch (state) {
    case 'idle':
      return 'Start'
    case 'calibrating':
      return 'Calibrating'
    case 'recording':
      return 'Done'
    case 'thinking':
      return 'Cancel'
    case 'speakingPrep':
      return 'Continue'
    case 'playing':
      return 'Continue'
    case 'readyToContinue':
      return 'Continue'
    case 'doneSuccess':
      return 'Start Again'
    default:
      return 'Start'
  }
}

export const useInterviewMachine = create<Store>((set, get) => ({
  state: 'idle',
  label: 'Start',
  disabled: false,
  debugLog: ['Ready'],
  elapsedMs: 0,
  setDisabled: (value) => set({ disabled: value }),
  toDone: () => set({ state: 'doneSuccess', label: computeLabel('doneSuccess'), disabled: false }),
  pushLog: (message) => set((state) => ({ debugLog: [...state.debugLog, message] })),
  primary: () => {
    const { state, disabled } = get()
    if (disabled) return

    const push = (message: string) => set((current) => ({ debugLog: [...current.debugLog, message] }))

    if (state === 'idle') {
      set({ state: 'recording', label: computeLabel('recording') })
      push('Recording started')
      return
    }
    if (state === 'calibrating') {
      push('Skipping calibration → recording')
      set({ state: 'recording', label: computeLabel('recording') })
      return
    }
    if (state === 'recording') {
      set({ state: 'thinking', label: computeLabel('thinking'), disabled: true })
      push('Recording stopped → thinking')
      setTimeout(() => {
        set({ state: 'playing', label: computeLabel('playing'), disabled: false })
        push('Assistant reply ready → playing')
      }, 600)
      return
    }
    if (state === 'thinking') {
      set({ state: 'readyToContinue', label: computeLabel('readyToContinue'), disabled: false })
      push('Cancelled thinking')
      return
    }
    if (state === 'speakingPrep') {
      set({ state: 'readyToContinue', label: computeLabel('readyToContinue') })
      push('Skipped speaking → ready')
      return
    }
    if (state === 'playing') {
      set({ state: 'readyToContinue', label: computeLabel('readyToContinue') })
      push('Finished playing → ready')
      return
    }
    if (state === 'readyToContinue') {
      set({ state: 'recording', label: computeLabel('recording') })
      push('Continue → recording')
      return
    }
    if (state === 'doneSuccess') {
      set({ state: 'idle', label: computeLabel('idle') })
      push('Start again → idle')
    }
  },
}))
