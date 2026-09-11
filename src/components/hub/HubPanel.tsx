'use client'
/**
 * ComfyHub listing: Trending | New tabs, a hashtag filter (live trending chips plus the full
 * catalog), the Publish CTA, and the cards. Running a card loads its recipe into the Studio and
 * navigates home; the publish dialog is mounted here so the CTA works without the game shell.
 * Hub jobs finish in the Studio, which reports them; this panel only starts the shared bridge
 * so the author's royalties are collected while browsing.
 */
import { useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { CloudOff, Flame, Loader2, RefreshCw, Sparkles, Upload, Workflow, X } from 'lucide-react'
import { Panel } from '@/components/common/Panel'
import { FOCUS_RING, useMotionOK } from '@/components/studio/studioHooks'
import { formatNum } from '@/game/format'
import { cn } from '@/lib/utils'
import { useGameStore } from '@/state/useGame'
import { HubCard } from './HubCard'
import { PublishDialog } from './PublishDialog'
import { UNKNOWN_VERDICT, ensureHubRoyaltyBridge, openHubPublish, requestStudioLoad, useHub, useRunVerdicts, type HubSort, type HubWorkflow } from './useHub'

const SORTS: readonly { id: HubSort; label: string; hint: string }[] = [
  { id: 'trending', label: 'Trending', hint: 'Runs in the last 24 h, boosted when the hashtags are trending on the live feed' },
  { id: 'new', label: 'New', hint: 'Freshly published' },
]

const PRESS = { type: 'spring', stiffness: 520, damping: 38 } as const

export function HubPanel() {
  const router = useRouter()
  const store = useGameStore()
  const motionOk = useMotionOK()
  const hub = useHub()
  const verdicts = useRunVerdicts(hub.workflows)
  // Authors browsing the hub collect the royalties their workflows earned meanwhile.
  useEffect(() => {
    ensureHubRoyaltyBridge()
  }, [])

  const onRun = useCallback(
    (workflow: HubWorkflow) => {
      requestStudioLoad({
        modelId: workflow.modelId,
        precision: workflow.precision,
        tags: workflow.hashtags,
        hubWorkflowId: workflow.id,
        name: workflow.name,
        authorHandle: workflow.authorHandle,
      })
      router.push('/')
    },
    [router],
  )

  const tagOptions = useMemo(() => store.catalog.hashtags.map((h) => ({ id: h.id, tag: h.tag })), [store])
  const hotChips = useMemo(() => hub.trending.map((id) => ({ id, tag: tagOptions.find((t) => t.id === id)?.tag ?? id })), [hub.trending, tagOptions])
  const meId = hub.auth.user?.id ?? null

  return (
    <>
      <Panel
        stripe="sapphire"
        title={
          <span className="inline-flex items-center gap-1.5">
            <Workflow size={14} aria-hidden="true" />
            ComfyHub
          </span>
        }
        right={
          <span className="tabular-nums">
            {hub.status === 'ok' ? `${formatNum(hub.workflows.length)} workflow${hub.workflows.length === 1 ? '' : 's'}` : hub.status === 'loading' ? 'loading' : 'offline'}
          </span>
        }
        className="w-full"
        bodyClassName="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Sort" className="flex items-center gap-1 rounded-xl border-2 border-charcoal-400 bg-charcoal-700 p-1">
            {SORTS.map((s) => {
              const active = hub.sort === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={s.hint}
                  onClick={() => hub.setSort(s.id)}
                  className={cn(
                    'relative h-8 rounded-lg px-3 text-sm font-semibold transition-colors',
                    FOCUS_RING,
                    active ? 'text-charcoal-800' : 'text-smoke-600 hover:bg-charcoal-500 hover:text-smoke-100',
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="hub-sort-pill"
                      aria-hidden="true"
                      className="absolute inset-0 rounded-lg bg-electric-400 shadow-[0_2px_0_#8a9a00]"
                      transition={motionOk ? PRESS : { duration: 0 }}
                    />
                  ) : null}
                  <span className="relative z-10 inline-flex items-center gap-1.5">
                    {s.id === 'trending' ? <Flame size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
                    {s.label}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={hub.refresh}
              aria-label="Refresh the hub"
              title="Refresh"
              className={cn('grid size-9 place-items-center rounded-xl border-2 border-charcoal-400 bg-charcoal-700 text-smoke-600 transition-colors hover:border-charcoal-300 hover:text-smoke-100', FOCUS_RING)}
            >
              <RefreshCw size={15} aria-hidden="true" className={hub.status === 'loading' && motionOk ? 'animate-spin' : undefined} />
            </button>
            <motion.button
              type="button"
              onClick={() => openHubPublish()}
              whileTap={motionOk ? { scale: 0.96, y: 2 } : undefined}
              transition={PRESS}
              title="Publish your current Studio recipe. Every run pays you 5% and bumps your rep."
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-xl border-2 border-electric-400 bg-electric-400 px-4 text-sm font-extrabold tracking-tight text-charcoal-800 shadow-[0_3px_0_#0e0e0f] hover:brightness-105',
                FOCUS_RING,
              )}
            >
              <Upload size={15} aria-hidden="true" />
              Publish
            </motion.button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">Filter</span>
          <TagChip label="All" active={hub.tag === null} onClick={() => hub.setTag(null)} />
          {hotChips.map((c) => (
            <TagChip key={c.id} label={`#${c.tag}`} hot active={hub.tag === c.id} onClick={() => hub.setTag(hub.tag === c.id ? null : c.id)} />
          ))}
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-smoke-600">
            <span className="sr-only">Any hashtag</span>
            <select
              value={hub.tag ?? ''}
              onChange={(e) => hub.setTag(e.target.value || null)}
              className={cn('h-8 rounded-lg border border-charcoal-300 bg-charcoal-700 px-2 text-xs font-semibold text-smoke-100', FOCUS_RING)}
            >
              <option value="">any hashtag</option>
              {tagOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.tag}
                </option>
              ))}
            </select>
            {hub.tag ? (
              <button type="button" onClick={() => hub.setTag(null)} aria-label="Clear the hashtag filter" className="grid size-7 place-items-center rounded-lg text-smoke-800 hover:bg-charcoal-500 hover:text-smoke-100">
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </div>

        {hub.status === 'offline' || hub.status === 'error' ? (
          <Empty
            icon={<CloudOff size={22} aria-hidden="true" />}
            title={hub.status === 'offline' ? 'ComfyHub is offline' : 'ComfyHub is not answering'}
            body={hub.error ?? 'Try again in a moment.'}
            action={
              <button type="button" onClick={hub.refresh} className={cn('text-xs font-semibold text-electric-400 hover:underline', FOCUS_RING)}>
                Retry
              </button>
            }
          />
        ) : hub.status === 'loading' && hub.workflows.length === 0 ? (
          <Empty icon={<Loader2 size={22} aria-hidden="true" className={motionOk ? 'animate-spin' : undefined} />} title="Fetching workflows" body="Resolving custom nodes. Missing: none, for once." />
        ) : hub.workflows.length === 0 ? (
          <Empty
            icon={<Workflow size={22} aria-hidden="true" />}
            title={hub.tag ? 'Nothing published under that hashtag yet' : 'Nobody has published yet'}
            body="Publish your Studio recipe and be the workflow everyone downloads and never credits — except here, where they must."
            action={
              <button type="button" onClick={() => openHubPublish()} className={cn('text-xs font-semibold text-electric-400 hover:underline', FOCUS_RING)}>
                Publish the first one
              </button>
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2" aria-label={`${hub.sort === 'trending' ? 'Trending' : 'New'} workflows`}>
            <AnimatePresence initial={false} mode="popLayout">
              {hub.workflows.map((w) => (
                <HubCard key={w.id} workflow={w} trending={hub.trending} meId={meId} verdict={verdicts.get(w.id) ?? UNKNOWN_VERDICT} onRun={onRun} />
              ))}
            </AnimatePresence>
          </ul>
        )}

        <p className="text-[11px] text-smoke-800">
          Trending score = runs in 24 h × (1 + 0.5 × live trending hashtags carried). Rep goes up with every run; 5% of each job is the author&apos;s royalty.
          {hub.auth.configured && !hub.auth.user ? ' Sign in to publish and to have your runs counted.' : ''}
        </p>
      </Panel>
      <PublishDialog />
    </>
  )
}

function TagChip({ label, active, hot, onClick }: { label: string; active: boolean; hot?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={hot ? 'Trending on the live feed right now' : undefined}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-colors',
        FOCUS_RING,
        active
          ? hot
            ? 'border-electric-400 bg-electric-400 text-charcoal-800'
            : 'border-smoke-500 bg-smoke-100 text-charcoal-800'
          : hot
            ? 'border-electric-400/70 bg-electric-400/10 text-electric-400 hover:bg-electric-400/20'
            : 'border-charcoal-300 bg-charcoal-500 text-smoke-600 hover:border-charcoal-100 hover:text-smoke-100',
      )}
    >
      {hot ? <Flame size={11} aria-hidden="true" /> : null}
      {label}
    </button>
  )
}

function Empty({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-charcoal-400 bg-charcoal-700/40 px-4 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-[0.354em] border-2 border-charcoal-400 bg-charcoal-700 text-smoke-600 shadow-[0_3px_0_#0e0e0f]">{icon}</span>
      <p className="text-sm font-bold text-smoke-100">{title}</p>
      <p className="max-w-md text-xs text-smoke-600">{body}</p>
      {action}
    </div>
  )
}
