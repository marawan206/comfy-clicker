'use client'
/**
 * Toast bus. `toast()` can be called from anywhere (event handlers, the FX layer, hotkeys);
 * `<ToastHost>` renders the first TOAST_MAX_VISIBLE entries and owns each visible toast's
 * auto-dismiss timer (so a toast's clock starts when it is actually shown, and pauses on hover).
 * The rest wait in order and slide in as earlier ones dismiss.
 */
import { useSyncExternalStore, type ReactNode } from 'react'

export const TOAST_MAX_VISIBLE = 4
export const TOAST_DURATION_MS = 5_000

export type ToastTone = 'default' | 'electric' | 'credits' | 'sapphire' | 'danger' | 'mask'

export interface ToastOptions {
  /** Uppercase kicker above the message, e.g. "Achievement". */
  title?: string
  /** Secondary line under the message (text or inline nodes such as a credits amount). */
  description?: ReactNode
  /** Icon-well content: an `<Art>` tile or a lucide icon. */
  icon?: ReactNode
  tone?: ToastTone
  /** Auto-dismiss delay once visible; defaults to TOAST_DURATION_MS. */
  durationMs?: number
  /** Dedupe key: a new toast with the same key replaces the earlier one instead of stacking. */
  key?: string
}

export interface Toast {
  id: number
  message: string
  title?: string
  description?: ReactNode
  icon?: ReactNode
  tone: ToastTone
  durationMs: number
  key?: string
  createdAt: number
}

type Listener = () => void

let nextId = 1
let toasts: Toast[] = []
const listeners = new Set<Listener>()
const EMPTY: Toast[] = []

function emit(): void {
  for (const l of listeners) l()
}

/** Queue a toast. Returns its id so a caller can dismiss it early. */
export function toast(message: string, opts: ToastOptions = {}): number {
  const item: Toast = {
    id: nextId++,
    message,
    tone: opts.tone ?? 'default',
    durationMs: opts.durationMs ?? TOAST_DURATION_MS,
    createdAt: Date.now(),
  }
  if (opts.title !== undefined) item.title = opts.title
  if (opts.description !== undefined) item.description = opts.description
  if (opts.icon !== undefined) item.icon = opts.icon
  if (opts.key !== undefined) item.key = opts.key
  toasts = opts.key ? [...toasts.filter((t) => t.key !== opts.key), item] : [...toasts, item]
  emit()
  return item.id
}

export function dismissToast(id: number): void {
  const before = toasts.length
  toasts = toasts.filter((t) => t.id !== id)
  if (toasts.length !== before) emit()
}

export function clearToasts(): void {
  if (toasts.length === 0) return
  toasts = []
  emit()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): Toast[] => toasts
const getServerSnapshot = (): Toast[] => EMPTY

/** Every queued toast, oldest first; the host shows the first TOAST_MAX_VISIBLE. */
export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
