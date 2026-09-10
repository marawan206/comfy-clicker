'use client'
/**
 * Mounts every overlay once (toasts, achievement bridge, event banners, the trending spark, the
 * offline report and the four modals) and routes the window events the rest of the UI dispatches:
 *   `comfy:open-modal`  { detail: 'settings' | 'stats' | 'daily' | 'rebrand' }
 *   `comfy:close-modals`
 *   `comfy:saved`       (from the S hotkey) → a "Saved" toast
 */
import { useCallback, useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { AchievementToast } from '@/components/overlays/AchievementToast'
import { DailyModal } from '@/components/overlays/DailyModal'
import { EventBanner } from '@/components/overlays/EventBanner'
import { CLOSE_MODALS_EVENT, OPEN_MODAL_EVENT } from '@/components/overlays/ModalBase'
import { RebrandModal } from '@/components/overlays/RebrandModal'
import { SettingsModal } from '@/components/overlays/SettingsModal'
import { StatsModal } from '@/components/overlays/StatsModal'
import { ToastHost } from '@/components/overlays/ToastHost'
import { TrendingSpark } from '@/components/overlays/TrendingSpark'
import { toast } from '@/components/overlays/useToasts'
import { WelcomeBackModal } from '@/components/overlays/WelcomeBackModal'

export type ModalId = 'settings' | 'stats' | 'daily' | 'rebrand'
const MODAL_IDS: ReadonlySet<string> = new Set<ModalId>(['settings', 'stats', 'daily', 'rebrand'])
const SAVED_EVENT = 'comfy:saved'

/** Dispatch helper for anything that wants to open a modal without importing the overlays. */
export function openModal(id: ModalId): void {
  window.dispatchEvent(new CustomEvent<ModalId>(OPEN_MODAL_EVENT, { detail: id }))
}

export function Overlays() {
  const [modal, setModal] = useState<ModalId | null>(null)
  const close = useCallback(() => setModal(null), [])
  const openDaily = useCallback(() => setModal('daily'), [])

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail
      if (typeof id === 'string' && MODAL_IDS.has(id)) setModal(id as ModalId)
    }
    const onClose = () => setModal(null)
    const onSaved = () =>
      toast('Saved', {
        title: 'Save',
        description: 'Progress lives in this browser · export a code in Settings to move it.',
        icon: <Save className="text-electric-400" />,
        tone: 'electric',
        key: 'saved',
        durationMs: 2500,
      })
    window.addEventListener(OPEN_MODAL_EVENT, onOpen)
    window.addEventListener(CLOSE_MODALS_EVENT, onClose)
    window.addEventListener(SAVED_EVENT, onSaved)
    return () => {
      window.removeEventListener(OPEN_MODAL_EVENT, onOpen)
      window.removeEventListener(CLOSE_MODALS_EVENT, onClose)
      window.removeEventListener(SAVED_EVENT, onSaved)
    }
  }, [])

  return (
    <>
      <AchievementToast />
      <EventBanner />
      <TrendingSpark />
      <WelcomeBackModal />
      <DailyModal open={modal === 'daily'} onClose={close} onOpen={openDaily} />
      <RebrandModal open={modal === 'rebrand'} onClose={close} />
      <SettingsModal open={modal === 'settings'} onClose={close} />
      <StatsModal open={modal === 'stats'} onClose={close} />
      <ToastHost />
    </>
  )
}
