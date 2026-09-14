'use client'
/**
 * Toast bus. `toast()` can be called from anywhere (event handlers, the FX layer, hotkeys);
 * `<ToastHost>` renders the first TOAST_MAX_VISIBLE entries and owns each visible toast's
 * auto-dismiss timer (so a toast's clock starts when it is actually shown, and pauses on hover).
 * The rest wait in order and slide in as earlier ones dismiss.
 *
 * A toast raised with a `key` that is already on screen is **refreshed, not replaced**: same id,
 * same card, same place in the queue, new content and a fresh timer. Spamming the save key used to
 * animate a new card in for every press; now one card sits there and its clock is pushed out with
 * each press. `refreshedAt` is what the host watches to re-arm the timer.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import type { Cue } from '@/audio/sfxMap'

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
  /**
   * Sound played when the card appears. Omit for the tone's default cue; pass `false` for silence.
   * Every toast raised from an engine event must pass `false`, because the event already sounded
   * through `useSfx` and a double play is the difference between juice and noise.
   */
  sound?: Cue | false
  /** One inline action rendered under the description, e.g. "Post now" on a week rollover. */
  action?: { label: string; onClick: () => void }
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
  sound?: Cue | false
  action?: { label: string; onClick: () => void }
  createdAt: number
  /** Bumped every time a same-key toast refreshes this one; the host re-arms its timer on it. */
  refreshedAt: number
}

type Listener = () => void

let nextId = 1
let toasts: Toast[] = []
const listeners = new Set<Listener>()
const EMPTY: Toast[] = []

function emit(): void {
  for (const l of listeners) l()
}

/**
 * Queue a toast, or refresh the one already holding this `key`. Returns its id so a caller can
 * dismiss it early; a refreshed toast keeps the id it already had.
 */
export function toast(message: string, opts: ToastOptions = {}): number {
  const now = Date.now()
  const existing = opts.key ? toasts.find((t) => t.key === opts.key) : undefined
  const item: Toast = {
    id: existing?.id ?? nextId++,
    message,
    tone: opts.tone ?? 'default',
    durationMs: opts.durationMs ?? TOAST_DURATION_MS,
    createdAt: existing?.createdAt ?? now,
    refreshedAt: now,
  }
  if (opts.title !== undefined) item.title = opts.title
  if (opts.description !== undefined) item.description = opts.description
  if (opts.icon !== undefined) item.icon = opts.icon
  if (opts.key !== undefined) item.key = opts.key
  if (opts.sound !== undefined) item.sound = opts.sound
  if (opts.action !== undefined) item.action = opts.action
  // A refresh keeps its place in the queue: a toast that has been on screen for four seconds must
  // not jump to the back of the line and outlive everything raised after it.
  toasts = existing ? toasts.map((t) => (t.id === existing.id ? item : t)) : [...toasts, item]
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

/** The queue as it stands, oldest first. Read by the hook, and by tests that have no React. */
export function getToasts(): Toast[] {
  return toasts
}

const getSnapshot = getToasts
const getServerSnapshot = (): Toast[] => EMPTY

/** Every queued toast, oldest first; the host shows the first TOAST_MAX_VISIBLE. */
export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
