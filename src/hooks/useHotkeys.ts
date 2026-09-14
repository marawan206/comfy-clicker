'use client'
/**
 * Global keyboard shortcuts:
 *   Space → one Generate click (never repeats while held; ignored inside inputs)
 *   S     → save now (`comfy:saved` event; Overlays shows the toast). Refused while the manual
 *             cooldown runs, so holding the key writes once rather than once a repeat.
 *   ?     → replay the tutorial (same event the header's `?` tile raises)
 *   Esc   → `comfy:close-modals` for every overlay
 */
import { useEffect } from 'react'
import { trustedInput } from '@/lib/input'
import { useGameStore } from '@/state/useGame'

export const CLOSE_MODALS_EVENT = 'comfy:close-modals'
export const SAVED_EVENT = 'comfy:saved'

/** What `comfy:saved` carries: whether the write happened, and the wait left when it did not. */
export interface SavedDetail {
  wrote: boolean
  waitMs: number
}

/** Same string `ModalBase` exports; declared here so the hook pulls in no component module. */
const OPEN_MODAL_EVENT = 'comfy:open-modal'

/** Buttons that opt into Space-as-Generate while focused (the hero logo and the Generate pill). */
export const GENERATE_HOTKEY_ATTR = 'data-generate-hotkey'

/** True when the key press belongs to a text field, select or editable region. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Space on a focused button or link is that control's own activation (a buy row, a tab); only
 * the hero controls hand it to Generate. Everything else on the page treats Space as a click.
 */
function ownsSpace(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.hasAttribute(GENERATE_HOTKEY_ATTR)) return false
  return target.closest('button, a, [role="button"], [role="tab"], [role="menuitem"], summary') !== null
}

export function useHotkeys(): void {
  const store = useGameStore()
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A script can dispatch a KeyboardEvent, and Space is a Generate click. The button drops
      // untrusted pointer events for the same reason; the keyboard path has to agree.
      if (!trustedInput(e)) return
      if (e.code === 'Escape') {
        window.dispatchEvent(new CustomEvent(CLOSE_MODALS_EVENT))
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditableTarget(e.target)) return
      if (e.code === 'Space') {
        if (ownsSpace(e.target)) return
        // Keep the page from scrolling and stop a focused hero button from firing a second click on keyup.
        e.preventDefault()
        if (e.repeat) return
        store.click()
        return
      }
      // Shift+/ on most layouts, and whatever else produces a question mark on the rest.
      if (e.key === '?' && !e.repeat) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent<string>(OPEN_MODAL_EVENT, { detail: 'help' }))
        return
      }
      if (e.code === 'KeyS' && !e.repeat) {
        e.preventDefault()
        const wrote = store.save()
        const detail: SavedDetail = { wrote, waitMs: wrote ? 0 : store.msUntilManualSave() }
        window.dispatchEvent(new CustomEvent<SavedDetail>(SAVED_EVENT, { detail }))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store])
}
