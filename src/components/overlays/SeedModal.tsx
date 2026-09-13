'use client'
/**
 * Seed Roulette, dressed as a KSampler node.
 *
 * The four widget rows are the game: `seed` is the odometer, `control_after_generate` says whether
 * the sampler has gone hot, `steps` is the wager and `denoise` is the pity meter. Under them the
 * reel scrolls the seven segments past a fixed marker.
 *
 * Two rules this file exists to keep:
 * 1. **The odds are printed before the bet.** The table below the reel is always on screen, with
 *    each segment's probability and what it would pay at the current wager. That is the whole
 *    difference between a game and a trap.
 * 2. **The engine decides.** Every spin goes through `canSpin` first and the button is disabled
 *    with the engine's own reason when it says no, so `store.spin` is never called on a spin the
 *    engine would refuse. The refusal copy is the engine's, not a paraphrase.
 *
 * The house edge and the cooldown live in the footer, always visible, never behind a disclosure.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Dices } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { fx } from '@/components/fx/fxBus'
import { ModalBase, ModalButton, SectionLabel, useReducedMotionPref } from '@/components/overlays/ModalBase'
import {
  SPIN_COOLDOWN_MS,
  SPIN_HOT_MULT,
  SPIN_MAX_SECS,
  SPIN_MIN_LEVEL,
  SPIN_PITY_DRY,
} from '@/game/constants'
import { formatDuration, formatInt, formatNum, formatPct } from '@/game/format'
import { canSpin, freeStake, freeSpinAvailable, isHot, msUntilSpin, pityDue, spinEv, wagerBounds } from '@/game/gamble'
import { playerLevel } from '@/game/level'
import type { GambleOutcomeDef } from '@/game/types'
import { useNow } from '@/hooks/useNow'
import { useGameEvents, useGameShallow, useGameStore } from '@/state/useGame'

export interface SeedModalProps {
  open: boolean
  onClose: () => void
}

export function SeedModal({ open, onClose }: SeedModalProps) {
  return (
    <ModalBase
      open={open}
      onClose={onClose}
      title="KSampler · Seed Roulette"
      icon={<Dices size={16} />}
      stripe="latent"
      size="lg"
      footer={<Disclosure />}
    >
      <SeedBody />
    </ModalBase>
  )
}

// ---------------------------------------------------------------------------
// Numbers and copy
// ---------------------------------------------------------------------------

/** Wager presets, in seconds of income. `Max` is appended separately. */
const PRESETS: readonly { label: string; secs: number }[] = [
  { label: '30s', secs: 30 },
  { label: '1m', secs: 60 },
  { label: '2m', secs: 120 },
  { label: '5m', secs: SPIN_MAX_SECS },
]

/** Result tint per segment, warmest at the top of the table. */
const OUTCOME_TINT: Record<string, string> = {
  nan: 'text-slot-vae',
  half: 'text-smoke-600',
  same: 'text-smoke-100',
  clean: 'text-[#7f8dff]',
  batch: 'text-slot-mask',
  golden: 'text-credits',
  s42: 'text-electric-400',
}

const tintFor = (id: string): string => OUTCOME_TINT[id] ?? 'text-smoke-100'

/** A probability, printed plainly: `34%`, `1.5%`, `0.3%`. `formatPct` signs its output, which a
 * chance must never be. */
const chance = (weight: number): string => `${Math.round(weight * 1000) / 10}%`

/** `= 1 min of income`, the only honest unit for a wager that scales with the rig. */
function incomeLabel(wager: number, cps: number): string {
  if (!(cps > 0)) return '= more than you make per second'
  const secs = wager / cps
  if (secs < 90) return `= ${Math.max(1, Math.round(secs))} s of income`
  return `= ${Math.round(secs / 60)} min of income`
}

/** Eight digits, so seed 42 reads as the seed everyone recognises. */
const seedText = (n: number): string => String(Math.abs(Math.floor(n))).padStart(8, '0').slice(-8)

const randomSeed = (): number => Math.floor(Math.random() * 1e8)

/** How long the odometer scrambles before it settles. */
const SCRAMBLE_MS = 1_600
const SCRAMBLE_TICK_MS = 60
/** Height of one reel row; the strip is translated in whole rows. */
const ROW_H = 34
/** Full cycles the reel runs through before it lands. */
const REEL_CYCLES = 3
const HISTORY_MAX = 8
/** Multiplier that earns confetti in here; `FxCanvas` uses the same line on the engine event. */
const JACKPOT_CONFETTI_MULT = 10

interface Result {
  outcome: GambleOutcomeDef
  wager: number
  payout: number
  free: boolean
  hot: boolean
  seed: number
  nonce: number
  /** The segment already under the marker: the reel starts there so it never resets visibly. */
  from: GambleOutcomeDef
}

/** A result before the reel knows where it is starting from. */
type Landing = Omit<Result, 'from'>

interface HistoryChip {
  id: string
  label: string
  net: number
  nonce: number
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

function SeedBody() {
  const store = useGameStore()
  const reduced = useReducedMotionPref()
  const now = useNow(250)
  const outcomes = store.catalog.gamble

  const s = useGameShallow((state, d) => ({
    credits: Math.floor(state.credits),
    cps: d.cps,
    min: wagerBounds(state, d).min,
    max: wagerBounds(state, d).max,
    free: freeStake(d),
    dry: state.gamble.dryStreak,
    hot: isHot(state),
    pity: pityDue(state),
    pot: state.gamble.pot,
    spins: state.stats.spins,
    level: playerLevel(state),
  }))

  // `now` is a 250 ms clock, so the cooldown and the free-spin day are read off the store directly
  // rather than through a 20 Hz selector: both are timestamps, not counters.
  const coolMs = msUntilSpin(store.state, now)
  const freeReady = freeSpinAvailable(store.state, now)

  const [bet, setBet] = useState(() => s.min)
  const [result, setResult] = useState<Result | null>(null)
  const [history, setHistory] = useState<HistoryChip[]>([])
  const [rejected, setRejected] = useState<string | null>(null)
  const [seed, setSeed] = useState(() => randomSeed())
  const [scrambling, setScrambling] = useState(false)
  const reelRef = useRef<HTMLDivElement>(null)
  const nonce = useRef(0)
  /** The seed the odometer settles on once the scramble ends. */
  const pending = useRef<Landing | null>(null)

  // The wager is clamped on read, not corrected in an effect: the bounds move with the rig and with
  // every purchase made elsewhere, and a render that has to wait for a second pass to be legal is a
  // render that can call `store.spin` with a stale number.
  const wager = Math.min(Math.max(bet, s.min), Math.max(s.min, s.max))

  const check = canSpin(store.state, store.derived, now, wager)
  const freeCheck = canSpin(store.state, store.derived, now, 'free')
  const locked = s.level < SPIN_MIN_LEVEL

  const land = useCallback((r: Landing) => {
    setResult((prev) => ({ ...r, from: prev?.outcome ?? (outcomes[0] as GambleOutcomeDef) }))
    setSeed(r.seed)
    setScrambling(false)
    setHistory((prev) =>
      [...prev, { id: r.outcome.id, label: r.outcome.label, net: r.payout - (r.free ? 0 : r.wager), nonce: r.nonce }].slice(-HISTORY_MAX),
    )
    const el = reelRef.current
    if (el) {
      const box = el.getBoundingClientRect()
      const net = r.payout - (r.free ? 0 : r.wager)
      fx.floatText(
        box.left + box.width / 2,
        box.top + box.height / 2,
        `${net >= 0 ? '+' : ''}${formatNum(net)}`,
        net >= 0 ? '#fbbf24' : '#ff6e6e',
      )
    }
    if (r.outcome.mult >= JACKPOT_CONFETTI_MULT) fx.confetti()
  }, [outcomes])

  // The engine is the source of truth for the result: the modal listens for its own `spin` event
  // rather than reading the action's return, so a spin taken anywhere else still lands here.
  useGameEvents((event) => {
    if (event.type !== 'spin') return
    const outcome = outcomes.find((o) => o.id === event.outcome)
    if (!outcome) return
    nonce.current += 1
    const r: Landing = {
      outcome,
      wager: event.wager,
      payout: event.payout,
      free: event.free,
      hot: event.hot,
      // A jackpot lands on the seed everyone already knows.
      seed: outcome.id === 's42' ? 42 : randomSeed(),
      nonce: nonce.current,
    }
    if (reduced) {
      land(r)
      return
    }
    pending.current = r
    setResult(null)
    setScrambling(true)
  })

  // The odometer scrambles for 1.6 s, then the result lands. One interval per spin, cleared on
  // unmount so closing the modal mid-spin does not leave a timer behind.
  useEffect(() => {
    if (!scrambling) return
    const id = window.setInterval(() => setSeed(randomSeed()), SCRAMBLE_TICK_MS)
    const end = window.setTimeout(() => {
      window.clearInterval(id)
      const r = pending.current
      pending.current = null
      if (r) land(r)
      else setScrambling(false)
    }, SCRAMBLE_MS)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(end)
    }
  }, [scrambling, land])

  const spin = useCallback(
    (bet: number | 'free') => {
      const verdict = canSpin(store.state, store.derived, Date.now(), bet)
      if (!verdict.ok) {
        setRejected(verdict.reason)
        return
      }
      setRejected(null)
      const r = store.spin(bet)
      if (r.error) setRejected(r.error)
    },
    [store],
  )

  const ev = useMemo(() => spinEv(outcomes), [outcomes])
  const net = history.reduce((sum, h) => sum + h.net, 0)

  return (
    <div className="flex flex-col gap-4">
      {/* The node mock */}
      <section
        aria-label="KSampler widgets"
        className="rounded-xl border-2 border-charcoal-400 border-l-4 border-l-slot-latent bg-charcoal-700/50 p-3"
      >
        <div className="flex flex-col gap-1.5">
          <Widget label="seed">
            <span className={cn('font-mono text-lg font-extrabold tracking-[0.14em] tabular-nums', scrambling ? 'text-smoke-600' : 'text-electric-400')}>
              {seedText(seed)}
            </span>
          </Widget>

          <Widget label="control_after_generate">
            {s.hot ? (
              <span className="text-sm font-bold text-electric-400">
                fixed <span className="text-smoke-600">· hot sampler ×{SPIN_HOT_MULT}</span>
              </span>
            ) : (
              <span className="text-sm font-semibold text-smoke-100">randomize</span>
            )}
          </Widget>

          <Widget label="steps">
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-sm font-extrabold text-credits tabular-nums">
                <CreditsIcon size={12} aria-hidden="true" />
                {formatInt(wager)}
              </span>
              <span className="text-[11px] text-smoke-600">{incomeLabel(wager, s.cps)}</span>
            </span>
          </Widget>

          <div className="flex flex-wrap items-center gap-1.5 pl-1">
            {PRESETS.map((p) => {
              const value = Math.min(Math.max(Math.round(p.secs * s.cps), s.min), Math.max(s.min, s.max))
              return (
                <PresetChip key={p.label} active={wager === value} onClick={() => setBet(value)} disabled={locked}>
                  {p.label}
                </PresetChip>
              )
            })}
            <PresetChip active={wager === s.max && s.max > s.min} onClick={() => setBet(s.max)} disabled={locked}>
              Max
            </PresetChip>
            <span className="ml-auto text-[11px] text-smoke-600 tabular-nums">
              {formatInt(s.min)} to {formatInt(s.max)} · you have {formatNum(s.credits)}
            </span>
          </div>

          <Widget label="denoise">
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1" aria-hidden="true">
                {Array.from({ length: SPIN_PITY_DRY }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'size-2.5 rounded-full border',
                      i < s.dry ? 'border-slot-latent bg-slot-latent' : 'border-charcoal-300 bg-charcoal-600',
                    )}
                  />
                ))}
              </span>
              <span className={cn('text-[11px]', s.pity ? 'font-bold text-slot-latent' : 'text-smoke-600')}>
                {s.pity ? 'pity armed · the next NaN is converted' : `${s.dry} of ${SPIN_PITY_DRY} NaN in a row`}
              </span>
            </span>
          </Widget>
        </div>
      </section>

      {/* The reel */}
      <Reel boxRef={reelRef} outcomes={outcomes} result={result} scrambling={scrambling} reduced={reduced} />

      {/* The result line */}
      <div className="min-h-[40px]">
        <AnimatePresence mode="wait">
          {result ? (
            <motion.p
              key={result.nonce}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.1 : 0.2 }}
              className="text-sm"
              role="status"
            >
              <span className={cn('font-extrabold', tintFor(result.outcome.id))}>{result.outcome.line}</span>{' '}
              <span className="text-smoke-600">
                ×{result.outcome.mult}
                {result.hot ? ` · hot ×${SPIN_HOT_MULT}` : ''} ·{' '}
              </span>
              <span className={cn('font-extrabold tabular-nums', result.payout > 0 ? 'text-credits' : 'text-slot-vae')}>
                {result.payout > 0 ? `+${formatNum(result.payout)}` : `-${formatNum(result.wager)}`}
              </span>
            </motion.p>
          ) : (
            <p key="idle" className="text-sm text-smoke-600">
              {scrambling ? 'Sampling…' : 'The seed decides. The table below says how often it decides in your favour.'}
            </p>
          )}
        </AnimatePresence>
      </div>

      {/* The odds, printed before the bet */}
      <section aria-labelledby="seed-odds">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <SectionLabel>
            <span id="seed-odds">Odds</span>
          </SectionLabel>
          <p className="text-[11px] text-smoke-600 tabular-nums">
            pot <span className="font-bold text-credits">{formatNum(s.pot)}</span> · rides on seed 42
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[380px] border-collapse text-left text-xs">
            <thead>
              <tr className="text-[10px] font-semibold tracking-[0.08em] text-smoke-800 uppercase">
                <th scope="col" className="py-1 font-semibold">
                  Segment
                </th>
                <th scope="col" className="py-1 text-right font-semibold">
                  Pays
                </th>
                <th scope="col" className="py-1 text-right font-semibold">
                  Chance
                </th>
                <th scope="col" className="py-1 text-right font-semibold">
                  At {formatInt(wager)}
                </th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o) => (
                <tr
                  key={o.id}
                  className={cn(
                    'border-t border-charcoal-400/60',
                    result?.outcome.id === o.id && 'bg-charcoal-500/60',
                  )}
                >
                  <td className={cn('py-1 font-semibold', tintFor(o.id))}>{o.label}</td>
                  <td className="py-1 text-right font-bold text-smoke-100 tabular-nums">×{o.mult}</td>
                  <td className="py-1 text-right text-smoke-600 tabular-nums">{chance(o.weight)}</td>
                  <td className="py-1 text-right font-bold text-credits tabular-nums">{formatNum(Math.round(wager * o.mult))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Last eight */}
      {history.length > 0 ? (
        <section aria-label="Recent spins" className="flex flex-wrap items-center gap-1.5">
          <SectionLabel className="mr-1">Last {history.length}</SectionLabel>
          {history.map((h) => (
            <span
              key={h.nonce}
              title={h.label}
              className={cn(
                'rounded-[0.354em] border border-charcoal-400 bg-charcoal-700 px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                tintFor(h.id),
              )}
            >
              {h.net >= 0 ? '+' : ''}
              {formatNum(h.net)}
            </span>
          ))}
          <span className="ml-auto text-[11px] text-smoke-600">
            session net{' '}
            <span className={cn('font-extrabold tabular-nums', net >= 0 ? 'text-credits' : 'text-slot-vae')}>
              {net >= 0 ? '+' : ''}
              {formatNum(net)}
            </span>
          </span>
        </section>
      ) : null}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 border-t border-charcoal-400/70 pt-3">
        <ModalButton
          tone="primary"
          size="lg"
          data-autofocus
          disabled={!check.ok || scrambling}
          onClick={() => spin(wager)}
          aria-label={check.ok ? `Spin for ${formatInt(wager)} credits` : check.reason}
        >
          <Dices size={16} aria-hidden="true" />
          Queue prompt
        </ModalButton>
        <ModalButton tone="secondary" size="lg" disabled={!freeCheck.ok || scrambling} onClick={() => spin('free')}>
          Free spin · {formatNum(s.free)}
        </ModalButton>
        <p className="ml-auto max-w-[260px] text-right text-[11px] text-smoke-600">
          {rejected ? (
            <span className="font-semibold text-slot-vae">{rejected}</span>
          ) : !check.ok ? (
            <span className="font-semibold text-slot-vae">{check.reason}</span>
          ) : coolMs > 0 ? (
            <span>Next paid spin in {formatDuration(Math.ceil(coolMs / 1000))}</span>
          ) : freeReady ? (
            <span className="font-semibold text-electric-400">Today&apos;s free spin is still here.</span>
          ) : (
            <span>Free spin used today · paid spin ready</span>
          )}
        </p>
      </div>

      <p className="text-[11px] text-smoke-800 tabular-nums">
        {formatInt(s.spins)} spins taken · expected return {formatPct(ev - 1)} per spin
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A ComfyUI widget row: label on the left, value on the right, inside a rounded pill. */
function Widget({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 rounded-comfy border border-charcoal-400 bg-charcoal-600 px-3 py-1.5">
      <span className="font-mono text-[11px] text-smoke-600">{label}</span>
      {children}
    </div>
  )
}

function PresetChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-7 rounded-[0.354em] border px-2 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border-electric-400 bg-electric-400 text-charcoal-800'
          : 'border-charcoal-400 bg-charcoal-600 text-smoke-100 hover:border-charcoal-300 hover:bg-charcoal-500',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The seven segments scrolling under a fixed marker. The strip is built per spin as
 * `[previous, three full cycles, result]`, so it starts on the segment already showing and ends on
 * the new one: no reset flash, no unbounded offset. Reduced motion renders the landing row only.
 */
function Reel({
  boxRef,
  outcomes,
  result,
  scrambling,
  reduced,
}: {
  boxRef: RefObject<HTMLDivElement | null>
  outcomes: readonly GambleOutcomeDef[]
  result: Result | null
  scrambling: boolean
  reduced: boolean
}) {
  const strip = useMemo(() => {
    if (!result) return null
    const rows: GambleOutcomeDef[] = [result.from]
    if (!reduced) for (let c = 0; c < REEL_CYCLES; c++) rows.push(...outcomes)
    rows.push(result.outcome)
    return rows
  }, [result, outcomes, reduced])

  const target = strip ? (strip.length - 1) * ROW_H : 0

  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      className="relative overflow-hidden rounded-comfy border-2 border-charcoal-400 bg-charcoal-800"
      style={{ height: ROW_H }}
    >
      {strip ? (
        <motion.div
          key={result?.nonce ?? 0}
          initial={{ y: 0 }}
          animate={{ y: -target }}
          transition={reduced ? { duration: 0 } : { duration: 1.15, ease: [0.12, 0.8, 0.2, 1] }}
        >
          {strip.map((o, i) => (
            <div
              key={`${o.id}-${i}`}
              className={cn('flex items-center justify-between px-3 font-semibold', tintFor(o.id))}
              style={{ height: ROW_H }}
            >
              <span className="text-xs">{o.label}</span>
              <span className="text-xs font-extrabold tabular-nums">×{o.mult}</span>
            </div>
          ))}
        </motion.div>
      ) : (
        <div className="flex items-center justify-between px-3 text-xs text-smoke-800" style={{ height: ROW_H }}>
          <span>{scrambling ? 'sampling' : 'idle'}</span>
          <span className="font-mono">{scrambling ? '· · ·' : '×?'}</span>
        </div>
      )}
      {/* The marker: a fixed electric caret the segments pass under. */}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-electric-400" />
      <span className="pointer-events-none absolute inset-0 rounded-comfy ring-1 ring-electric-400/25 ring-inset" />
    </div>
  )
}

/** The house edge and the cooldown, always on screen. */
function Disclosure() {
  const store = useGameStore()
  const ev = spinEv(store.catalog.gamble)
  return (
    <p className="mr-auto text-left text-[11px] text-smoke-600">
      EV {formatPct(ev - 1)} · one spin every {Math.round(SPIN_COOLDOWN_MS / 60_000)} minutes · one free spin a day · you can lose the
      whole wager
    </p>
  )
}
