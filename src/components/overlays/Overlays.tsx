'use client'
/**
 * Mounts every overlay once (toasts, achievement bridge, event banners, the trending spark, the
 * easter-egg shows, the level-up banner, the guidance popover, the offline report and the modals)
 * and routes the window events the rest of the UI dispatches:
 *   `comfy:open-modal`  { detail: 'settings' | 'stats' | 'daily' | 'rebrand' | 'lounge' }
 *   `comfy:close-modals`
 *   `comfy:saved`       (from the S hotkey) → a "Saved" toast, or the cooldown line when the
 *                       write was refused because the last one was seconds ago
 *
 * This file is mounted on every route that keeps the store alive (the game shell, the Graph, the
 * Hub, the leaderboard), so anything that must work away from the workbench belongs here: the
 * level-up banner, the achievement bridge and the grand-tour egg all need to see other pages.
 * `help` is deliberately absent: the tutorial owns that id and mounts inside the game shell.
 */
import { useCallback, useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { AchievementToast } from '@/components/overlays/AchievementToast'
import { DailyModal } from '@/components/overlays/DailyModal'
import { EasterEggs } from '@/components/overlays/EasterEggs'
import { EventBanner } from '@/components/overlays/EventBanner'
import { GuidanceHost } from '@/components/guidance/GuidanceHost'
import { LevelUpBanner } from '@/components/overlays/LevelUpBanner'
import { CLOSE_MODALS_EVENT, OPEN_MODAL_EVENT } from '@/components/overlays/ModalBase'
import { RebrandModal } from '@/components/overlays/RebrandModal'
import { LoungeModal } from '@/components/overlays/LoungeModal'
import { SettingsModal } from '@/components/overlays/SettingsModal'
import { StatsModal } from '@/components/overlays/StatsModal'
import { ToastHost } from '@/components/overlays/ToastHost'
import { TrendingSpark } from '@/components/overlays/TrendingSpark'
import { toast } from '@/components/overlays/useToasts'
import { WelcomeBackModal } from '@/components/overlays/WelcomeBackModal'
import { useGrandTour } from '@/hooks/useEasterEggs'
import type { SavedDetail } from '@/hooks/useHotkeys'

export type ModalId = 'settings' | 'stats' | 'daily' | 'rebrand' | 'lounge'
const MODAL_IDS: ReadonlySet<string> = new Set<ModalId>(['settings', 'stats', 'daily', 'rebrand', 'lounge'])
const SAVED_EVENT = 'comfy:saved'

/** Dispatch helper for anything that wants to open a modal without importing the overlays. */
export function openModal(id: ModalId): void {
  window.dispatchEvent(new CustomEvent<ModalId>(OPEN_MODAL_EVENT, { detail: id }))
}

export function Overlays() {
  const [modal, setModal] = useState<ModalId | null>(null)
  const close = useCallback(() => setModal(null), [])
  const openDaily = useCallback(() => setModal('daily'), [])

  // The grand tour counts panels across routes, so it rides with the overlays rather than with the
  // workbench-only egg hook: opening the Graph unmounts the shell but never this.
  useGrandTour()

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail
      if (typeof id === 'string' && MODAL_IDS.has(id)) setModal(id as ModalId)
    }
    const onClose = () => setModal(null)
    const onSaved = (e: Event) => {
      const detail = (e as CustomEvent<SavedDetail | undefined>).detail
      if (detail && !detail.wrote) {
        toast(`Already saved · again in ${Math.max(1, Math.ceil(detail.waitMs / 1000))}s`, {
          title: 'Save',
          description: 'The game autosaves on its own. The key is for peace of mind, not for spamming.',
          icon: <Save className="text-smoke-600" />,
          tone: 'default',
          key: 'saved',
          durationMs: 2000,
        })
        return
      }
      toast('Saved', {
        title: 'Save',
        description: 'Progress lives in this browser · export a code in Settings to move it.',
        icon: <Save className="text-electric-400" />,
        tone: 'electric',
        key: 'saved',
        durationMs: 2500,
      })
    }
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
      <EasterEggs />
      <LevelUpBanner />
      <WelcomeBackModal />
      <DailyModal open={modal === 'daily'} onClose={close} onOpen={openDaily} />
      <RebrandModal open={modal === 'rebrand'} onClose={close} />
      <LoungeModal open={modal === 'lounge'} onClose={close} />
      <SettingsModal open={modal === 'settings'} onClose={close} />
      <StatsModal open={modal === 'stats'} onClose={close} />
      <ToastHost />
      <GuidanceHost />
    </>
  )
}
