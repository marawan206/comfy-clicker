'use client'
/**
 * /hub — ComfyHub. The same litegraph canvas and header as the game (the store is a module
 * singleton started in the root layout, so the counter keeps ticking here), a short intro with the
 * player's own hub numbers, and the listing panel with its sort tabs, tag filter and Publish CTA.
 * The full overlay set is mounted so the header's daily / stats / settings buttons work here.
 */
import { Award, Play, Upload, Workflow } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { NumberTicker } from '@/components/common/NumberTicker'
import { HubPanel } from '@/components/hub/HubPanel'
import { DotGrid } from '@/components/layout/DotGrid'
import { Header } from '@/components/layout/Header'
import { Overlays } from '@/components/overlays/Overlays'
import { formatNum } from '@/game/format'
import { useGame, useGameShallow } from '@/state/useGame'

const ENTER = { type: 'spring', stiffness: 260, damping: 26 } as const

export default function HubPage() {
  const os = useReducedMotion()
  const setting = useGame((s) => s.settings.reducedMotion)
  const instant = Boolean(os) || setting

  return (
    <>
      <DotGrid />
      <div className="relative z-10 flex min-h-dvh flex-col">
        <Header />
        <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
          <motion.div
            className="flex flex-col gap-4"
            initial={instant ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={ENTER}
          >
            <Intro />
            <HubPanel />
          </motion.div>
        </main>
      </div>
      {/* Toasts, the daily calendar, settings, stats and event banners stay reachable from the shared header. */}
      <Overlays />
    </>
  )
}

/** Eyebrow, title, one dry line, and the player's own hub numbers from the store. */
function Intro() {
  const { rep, published, runs } = useGameShallow((s) => ({
    rep: s.hubRep,
    published: s.stats.hubPublished,
    runs: s.stats.hubRuns,
  }))
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-comfy border-2 border-charcoal-400 bg-charcoal-700 text-sapphire-700 shadow-[0_3px_0_#0e0e0f]"
        >
          <Workflow size={28} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">ComfyHub</p>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-smoke-100">Workflows other people will actually run</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-smoke-600">
            Publish a recipe from your Studio. Every time another player runs it, five percent of their job comes back as royalty and your
            rep climbs. Run someone else&apos;s and the Studio loads it as-is — model, precision, tags. Missing custom nodes not included.
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        <Stat icon={<Award size={12} aria-hidden="true" />} label="Hub rep" value={rep} title="Reputation earned when other players run your workflows" />
        <Stat icon={<Upload size={12} aria-hidden="true" />} label="Published" value={published} title="Workflows you have put on the hub this save" />
        <Stat icon={<Play size={12} aria-hidden="true" />} label="Runs" value={runs} title="Times other players ran your workflows (collected while you are signed in)" />
      </dl>
    </div>
  )
}

function Stat({ icon, label, value, title }: { icon: React.ReactNode; label: string; value: number; title: string }) {
  return (
    <div className="min-w-24 rounded-comfy border border-charcoal-400 bg-charcoal-700 px-3 py-2" title={title}>
      <dt className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-bold tabular-nums text-smoke-100">
        <NumberTicker value={value} format={formatNum} />
      </dd>
    </div>
  )
}
