"use client"
import { ReactNode, useEffect } from 'react'
import { ACTIVE_USER_HANDLE_STORAGE_KEY, normalizeHandle } from '@/lib/user-scope'

type HandleScopeProps = { handle: string; children: ReactNode }

export function HandleScope({ handle, children }: HandleScopeProps) {
  useEffect(() => {
    const normalized = normalizeHandle(handle)
    if (typeof window === 'undefined') return
    if (normalized) {
      window.localStorage.setItem(ACTIVE_USER_HANDLE_STORAGE_KEY, normalized)
    } else {
      window.localStorage.removeItem(ACTIVE_USER_HANDLE_STORAGE_KEY)
    }
  }, [handle])

  return <>{children}</>
}
