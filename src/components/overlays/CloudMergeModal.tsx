'use client'
/**
 * "Two saves, one account." Shown when a sign-in finds a cloud save that is not the one this
 * device wrote: a side-by-side of lifetime credits, income, followers, season and last write,
 * the higher lifetime-credits run preselected. Answering resolves the `CloudMergeRequest`
 * that `src/state/persistence.ts` raised on `comfy:cloud-merge`.
 */
import { useEffect, useState } from 'react'
import { CloudDownload, HardDrive, Cloud, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { ModalBase, ModalButton, SectionLabel } from '@/components/overlays/ModalBase'
import { toast } from '@/components/overlays/useToasts'
import { formatCompactDate, formatCps, formatDuration, formatNum } from '@/game/format'
import { CLOUD_MERGE_EVENT, getPendingMerge, subscribeCloudSync, type CloudMergeRequest, type MergeChoice, type SaveSummary } from '@/state/persistence'

export function CloudMergeModal() {
  const [request, setRequest] = useState<CloudMergeRequest | null>(() => (typeof window === 'undefined' ? null : getPendingMerge()))
  const [choice, setChoice] = useState<MergeChoice>('local')

  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<CloudMergeRequest>).detail
      setRequest(detail)
      setChoice(detail.suggested)
    }
    // A request raised before this modal mounted (route change mid sign-in) is still pending.
    const sync = () => {
      const pending = getPendingMerge()
      setRequest((cur) => (pending === cur ? cur : pending))
      if (pending) setChoice(pending.suggested)
    }
    window.addEventListener(CLOUD_MERGE_EVENT, onEvent)
    const unsub = subscribeCloudSync(sync)
    sync()
    return () => {
      window.removeEventListener(CLOUD_MERGE_EVENT, onEvent)
      unsub()
    }
  }, [])

  const confirm = (picked: MergeChoice) => {
    if (!request) return
    request.choose(picked)
    setRequest(null)
    toast(picked === 'cloud' ? 'Cloud save loaded' : 'This device wins', {
      title: 'Cloud save',
      description:
        picked === 'cloud'
          ? 'The rig from your other machine is now here. Offline income since it last ticked is on the way.'
          : 'The cloud row has been overwritten with this run. The other device will ask on its next sign-in.',
      icon: picked === 'cloud' ? <CloudDownload className="text-electric-400" /> : <HardDrive className="text-electric-400" />,
      tone: 'electric',
      key: 'cloud-merge',
    })
  }

  return (
    <ModalBase
      open={request !== null}
      // Esc / backdrop pick the preselected side rather than leaving the account half-synced.
      onClose={() => confirm(request?.suggested ?? 'local')}
      dismissible={false}
      title="Two saves, one account"
      icon={<Cloud size={16} />}
      stripe="sapphire"
      size="lg"
      footer={
        request ? (
          <>
            <span className="mr-auto text-xs text-smoke-600">The side you do not pick is overwritten. Export a code first if that hurts.</span>
            <ModalButton tone={choice === 'cloud' ? 'sapphire' : 'primary'} size="lg" onClick={() => confirm(choice)} data-autofocus>
              <Check size={16} />
              {choice === 'cloud' ? 'Load the cloud save' : 'Keep this device'}
            </ModalButton>
          </>
        ) : null
      }
    >
      {request ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-smoke-600">
            This browser has a run and your account has another. Pick the one that keeps going; we preselected the one with more
            lifetime credits, which is usually the one you meant.
          </p>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Which save to keep">
            <SaveCard summary={request.local} selected={choice === 'local'} suggested={request.suggested === 'local'} onSelect={() => setChoice('local')} />
            <SaveCard summary={request.cloud} selected={choice === 'cloud'} suggested={request.suggested === 'cloud'} onSelect={() => setChoice('cloud')} />
          </div>
        </div>
      ) : null}
    </ModalBase>
  )
}

function SaveCard({ summary, selected, suggested, onSelect }: { summary: SaveSummary; selected: boolean; suggested: boolean; onSelect: () => void }) {
  const cloud = summary.source === 'cloud'
  const Icon = cloud ? Cloud : HardDrive
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-3 rounded-xl border-2 border-l-4 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
        cloud ? 'border-l-sapphire-700' : 'border-l-slot-image',
        selected ? 'border-electric-400 bg-electric-400/10' : 'border-charcoal-400 bg-charcoal-700/50 hover:border-charcoal-300',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <SectionLabel className={cn('inline-flex items-center gap-1.5', selected ? 'text-electric-400' : undefined)}>
          <Icon size={14} />
          {cloud ? 'Cloud save' : 'This device'}
        </SectionLabel>
        {suggested ? (
          <span className="rounded-comfy border border-electric-400/60 bg-electric-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-electric-400">
            Suggested
          </span>
        ) : null}
      </div>
      <p className="flex items-center gap-1.5 text-2xl font-extrabold tracking-tight text-credits tabular-nums">
        <CreditsIcon size={20} />
        {formatNum(summary.lifetimeCredits)}
        <span className="text-xs font-semibold text-smoke-600">lifetime</span>
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <Stat label="Income" value={`${formatCps(summary.cps)}`} />
        <Stat label="Followers" value={formatNum(summary.followers)} />
        <Stat label="Season" value={`S${summary.season}`} />
        <Stat label="Played" value={formatDuration(summary.playedSec)} />
        <Stat label="Last write" value={summary.savedAt > 0 ? formatCompactDate(summary.savedAt) : 'never'} className="col-span-2" />
      </dl>
    </button>
  )
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600">{label}</dt>
      <dd className="font-bold text-smoke-100 tabular-nums">{value}</dd>
    </div>
  )
}
