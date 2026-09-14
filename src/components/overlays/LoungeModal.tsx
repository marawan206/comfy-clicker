'use client'
/**
 * The Latent Lounge: two tables, one bet control.
 *
 * **Wheel** is the KSampler spin, dressed as a node: `control_after_generate` says whether the
 * sampler has gone hot, `denoise` is the pity meter, and the reel scrolls the seven segments past
 * a fixed marker. **Coin** is one flip against the house, your side against Comfy's.
 *
 * Three rules this file exists to keep:
 * 1. **The odds are printed before the bet.** The wheel's table and the coin's two chances are
 *    always on screen. That is the whole difference between a game and a trap.
 * 2. **The bet is a number of credits.** A slider and a box, both showing the same figure, plus
 *    four plain shortcuts. No seconds of income, no tiers, no cooldown to wait out.
 * 3. **The engine decides.** Every bet goes through `canBet` first and the button carries the
 *    engine's own refusal, so `store.spin` / `store.flip` is never called on a bet the engine
 *    would refuse.
 *
 * The house edge lives in the footer, always visible, never behind a disclosure.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleDollarSign, Dices } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ComfyMark } from '@/components/brand/ComfyMark'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { fx } from '@/components/fx/fxBus'
import { ModalBase, ModalButton, SectionLabel, useReducedMotionPref } from '@/components/overlays/ModalBase'
import { BET_MIN, COIN_PAYOUT, COIN_WIN_CHANCE, LOUNGE_MIN_LEVEL, SPIN_HOT_MULT, SPIN_PITY_DRY } from '@/game/constants'
import { formatInt, formatNum, formatPct } from '@/game/format'
import { betBounds, canBet, coinEv, freeSpinAvailable, freeStake, isHot, pityDue, spinEv } from '@/game/gamble'
import { playerLevel } from '@/game/level'
import type { GambleOutcomeDef } from '@/game/types'
import { useNow } from '@/hooks/useNow'
import { useGameEvents, useGameShallow, useGameStore } from '@/state/useGame'

export interface LoungeModalProps {
  open: boolean
  onClose: () => void
}

export function LoungeModal({ open, onClose }: LoungeModalProps) {
  return (
    <ModalBase
      open={open}
      onClose={onClose}
      title="The Latent Lounge"
      icon={<Dices size={16} />}
      stripe="latent"
      size="lg"
      footer={<Disclosure />}
    >
      <LoungeBody />
    </ModalBase>
  )
}

// ---------------------------------------------------------------------------
// Numbers and copy
// ---------------------------------------------------------------------------

type TableId = 'wheel' | 'coin'

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
/** How long the coin turns before it shows a face. */
const FLIP_MS = 900
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

interface FlipResult {
  side: 'you' | 'comfy'
  wager: number
  payout: number
  streak: number
  nonce: number
}

interface HistoryChip {
  id: string
  label: string
  net: number
  nonce: number
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

function LoungeBody() {
  const store = useGameStore()
  const reduced = useReducedMotionPref()
  const now = useNow(1000)
  const outcomes = store.catalog.gamble

  const s = useGameShallow((state, d) => ({
    credits: Math.floor(state.credits),
    min: betBounds(state).min,
    max: betBounds(state).max,
    free: freeStake(d),
    dry: state.gamble.dryStreak,
    hot: isHot(state),
    pity: pityDue(state),
    pot: state.gamble.pot,
    bets: state.stats.spins + state.stats.flips,
    net: state.stats.spinNet,
    level: playerLevel(state),
  }))

  const freeReady = freeSpinAvailable(store.state, now)

  const [table, setTable] = useState<TableId>('wheel')
  const [bet, setBet] = useState(() => Math.max(BET_MIN, Math.min(s.max, 100)))
  const [result, setResult] = useState<Result | null>(null)
  const [flip, setFlip] = useState<FlipResult | null>(null)
  const [history, setHistory] = useState<HistoryChip[]>([])
  const [rejected, setRejected] = useState<string | null>(null)
  const [seed, setSeed] = useState(() => randomSeed())
  const [busy, setBusy] = useState(false)
  const reelRef = useRef<HTMLDivElement>(null)
  const coinRef = useRef<HTMLDivElement>(null)
  const nonce = useRef(0)
  /** The result the odometer or the coin settles on once the animation ends. */
  const pending = useRef<Landing | FlipResult | null>(null)

  // The wager is clamped on read, not corrected in an effect: the bank moves with every tick and
  // with every purchase made elsewhere, and a render that has to wait for a second pass to be
  // legal is a render that can call `store.spin` with a stale number.
  const wager = Math.min(Math.max(Math.floor(bet) || 0, s.min), Math.max(s.min, s.max))
  const check = canBet(store.state, store.derived, now, wager)
  const freeCheck = canBet(store.state, store.derived, now, 'free')
  const locked = s.level < LOUNGE_MIN_LEVEL

  const land = useCallback(
    (r: Landing) => {
      setResult((prev) => ({ ...r, from: prev?.outcome ?? (outcomes[0] as GambleOutcomeDef) }))
      setSeed(r.seed)
      setBusy(false)
      const net = r.payout - (r.free ? 0 : r.wager)
      setHistory((prev) => [...prev, { id: r.outcome.id, label: r.outcome.label, net, nonce: r.nonce }].slice(-HISTORY_MAX))
      floatNet(reelRef, net)
      if (r.outcome.mult >= JACKPOT_CONFETTI_MULT) fx.confetti()
    },
    [outcomes],
  )

  const landFlip = useCallback((r: FlipResult) => {
    setFlip(r)
    setBusy(false)
    const net = r.payout - r.wager
    setHistory((prev) => [...prev, { id: r.side === 'you' ? 'clean' : 'nan', label: r.side === 'you' ? 'Your side' : 'Comfy side', net, nonce: r.nonce }].slice(-HISTORY_MAX))
    floatNet(coinRef, net)
  }, [])

  // The engine is the source of truth for both results: the modal listens for its own events
  // rather than reading the action's return, so a bet taken anywhere else still lands here.
  useGameEvents((event) => {
    if (event.type === 'spin') {
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
      setBusy(true)
      return
    }
    if (event.type === 'flip') {
      nonce.current += 1
      const r: FlipResult = { side: event.side, wager: event.wager, payout: event.payout, streak: event.streak, nonce: nonce.current }
      if (reduced) {
        landFlip(r)
        return
      }
      pending.current = r
      setFlip(null)
      setBusy(true)
    }
  })

  // The animation: 1.6 s of scrambling seed, or 0.9 s of turning coin, then the result lands. One
  // timer per bet, cleared on unmount so closing the modal mid-spin leaves nothing behind.
  useEffect(() => {
    if (!busy) return
    const coin = pending.current !== null && 'side' in pending.current
    const id = coin ? 0 : window.setInterval(() => setSeed(randomSeed()), SCRAMBLE_TICK_MS)
    const end = window.setTimeout(
      () => {
        if (id) window.clearInterval(id)
        const r = pending.current
        pending.current = null
        if (r && 'side' in r) landFlip(r)
        else if (r) land(r)
        else setBusy(false)
      },
      coin ? FLIP_MS : SCRAMBLE_MS,
    )
    return () => {
      if (id) window.clearInterval(id)
      window.clearTimeout(end)
    }
  }, [busy, land, landFlip])

  const place = useCallback(
    (amount: number | 'free', game: TableId) => {
      const verdict = canBet(store.state, store.derived, Date.now(), amount)
      if (!verdict.ok) {
        setRejected(verdict.reason)
        return
      }
      setRejected(null)
      const r = game === 'coin' ? store.flip(verdict.stake) : store.spin(amount)
      if (r.error) setRejected(r.error)
    },
    [store],
  )

  const wheelEv = useMemo(() => spinEv(outcomes), [outcomes])
  const sessionNet = history.reduce((sum, h) => sum + h.net, 0)

  return (
    <div className="flex flex-col gap-4">
      <TableTabs table={table} onChange={setTable} disabled={busy} />

      <BetControl
        value={wager}
        min={s.min}
        max={s.max}
        credits={s.credits}
        disabled={locked}
        onChange={setBet}
      />

      {table === 'wheel' ? (
        <WheelTable
          outcomes={outcomes}
          wager={wager}
          seed={seed}
          hot={s.hot}
          dry={s.dry}
          pity={s.pity}
          pot={s.pot}
          result={result}
          busy={busy}
          reduced={reduced}
          reelRef={reelRef}
        />
      ) : (
        <CoinTable wager={wager} flip={flip} busy={busy} reduced={reduced} coinRef={coinRef} />
      )}

      {/* Last eight */}
      {history.length > 0 ? (
        <section aria-label="Recent bets" className="flex flex-wrap items-center gap-1.5">
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
            <span className={cn('font-extrabold tabular-nums', sessionNet >= 0 ? 'text-credits' : 'text-slot-vae')}>
              {sessionNet >= 0 ? '+' : ''}
              {formatNum(sessionNet)}
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
          disabled={!check.ok || busy}
          onClick={() => place(wager, table)}
          aria-label={check.ok ? `Bet ${formatInt(wager)} credits` : check.reason}
        >
          {table === 'coin' ? <CircleDollarSign size={16} aria-hidden="true" /> : <Dices size={16} aria-hidden="true" />}
          {table === 'coin' ? 'Flip the coin' : 'Queue prompt'}
        </ModalButton>
        {table === 'wheel' ? (
          <ModalButton tone="secondary" size="lg" disabled={!freeCheck.ok || busy} onClick={() => place('free', 'wheel')}>
            Free spin · {formatNum(s.free)}
          </ModalButton>
        ) : null}
        <p className="ml-auto max-w-[260px] text-right text-[11px] text-smoke-600">
          {rejected ? (
            <span className="font-semibold text-slot-vae">{rejected}</span>
          ) : !check.ok ? (
            <span className="font-semibold text-slot-vae">{check.reason}</span>
          ) : table === 'wheel' && freeReady ? (
            <span className="font-semibold text-electric-400">Today&apos;s free spin is still here.</span>
          ) : (
            <span>Bet what you like, as often as you like. The bank is the only limit.</span>
          )}
        </p>
      </div>

      <p className="text-[11px] text-smoke-800 tabular-nums">
        {formatInt(s.bets)} bets taken · lifetime {s.net >= 0 ? '+' : ''}
        {formatNum(s.net)} · wheel returns {formatPct(wheelEv - 1)} a spin, coin {formatPct(coinEv() - 1)} a flip
      </p>
    </div>
  )
}

/** Float the net result out of whichever box produced it. */
function floatNet(ref: RefObject<HTMLDivElement | null>, net: number): void {
  const el = ref.current
  if (!el) return
  const box = el.getBoundingClientRect()
  fx.floatText(
    box.left + box.width / 2,
    box.top + box.height / 2,
    `${net >= 0 ? '+' : ''}${formatNum(net)}`,
    net >= 0 ? '#fbbf24' : '#ff6e6e',
  )
}

// ---------------------------------------------------------------------------
// The bet control
// ---------------------------------------------------------------------------

/**
 * One number, three ways to set it: the slider, the box and the four shortcuts. The slider runs
 * over the bank rather than over a percentage, so the figure under the thumb is the figure that
 * will be staked; below BET_MIN the whole control is dead rather than quietly rounding up.
 */
function BetControl({
  value,
  min,
  max,
  credits,
  disabled,
  onChange,
}: {
  value: number
  min: number
  max: number
  credits: number
  disabled: boolean
  onChange: (n: number) => void
}) {
  const sliderId = useId()
  const boxId = useId()
  const broke = max < min
  const off = disabled || broke
  const step = Math.max(1, Math.round(max / 200))

  const set = (n: number) => onChange(Math.min(Math.max(Math.round(n), min), Math.max(min, max)))

  return (
    <section
      aria-label="Your bet"
      className="rounded-xl border-2 border-charcoal-400 border-l-4 border-l-slot-latent bg-charcoal-700/50 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={boxId} className="font-mono text-[11px] text-smoke-600">
          bet
        </label>
        <span className="text-[11px] text-smoke-600 tabular-nums">
          {formatInt(min)} to {formatInt(Math.max(min, max))} · you have {formatNum(credits)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <span className="flex items-center gap-1.5 rounded-comfy border border-charcoal-400 bg-charcoal-600 px-2.5 py-1.5">
          <CreditsIcon size={13} aria-hidden="true" />
          <input
            id={boxId}
            type="number"
            inputMode="numeric"
            min={min}
            max={Math.max(min, max)}
            value={value}
            disabled={off}
            onChange={(e) => {
              const n = Number(e.target.value)
              onChange(Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0)
            }}
            onBlur={() => set(value)}
            className="w-28 bg-transparent text-lg font-extrabold text-credits tabular-nums outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </span>
        <label htmlFor={sliderId} className="sr-only">
          Bet amount
        </label>
        <input
          id={sliderId}
          type="range"
          min={min}
          max={Math.max(min, max)}
          step={step}
          value={value}
          disabled={off}
          onChange={(e) => set(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer accent-electric-400 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Chip onClick={() => set(min)} disabled={off}>
          Min
        </Chip>
        <Chip onClick={() => set(value / 2)} disabled={off}>
          Half
        </Chip>
        <Chip onClick={() => set(value * 2)} disabled={off}>
          Double
        </Chip>
        <Chip onClick={() => set(max / 4)} disabled={off}>
          25%
        </Chip>
        <Chip onClick={() => set(max / 2)} disabled={off}>
          50%
        </Chip>
        <Chip onClick={() => set(max)} disabled={off}>
          All in
        </Chip>
        {broke ? <span className="ml-auto text-[11px] font-semibold text-slot-vae">Come back with {formatInt(min)} credits.</span> : null}
      </div>
    </section>
  )
}

function Chip({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-7 rounded-[0.354em] border border-charcoal-400 bg-charcoal-600 px-2 text-[11px] font-bold text-smoke-100 transition-colors hover:border-charcoal-300 hover:bg-charcoal-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function TableTabs({ table, onChange, disabled }: { table: TableId; onChange: (id: TableId) => void; disabled: boolean }) {
  const tabs: readonly { id: TableId; label: string; hint: string }[] = [
    { id: 'wheel', label: 'Wheel', hint: 'Seven segments, one seed' },
    { id: 'coin', label: 'Coin flip', hint: 'Your side against Comfy, pays double' },
  ]
  return (
    <div role="tablist" aria-label="Table" className="flex items-center gap-1 rounded-xl border-2 border-charcoal-400 bg-charcoal-700 p-1">
      {tabs.map((t) => {
        const active = t.id === table
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={t.hint}
            disabled={disabled && !active}
            onClick={() => onChange(t.id)}
            className={cn(
              'h-8 flex-1 rounded-lg px-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              active ? 'bg-electric-400 text-charcoal-800 shadow-[0_2px_0_#8a9a00]' : 'text-smoke-600 hover:bg-charcoal-500 hover:text-smoke-100',
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The wheel
// ---------------------------------------------------------------------------

function WheelTable({
  outcomes,
  wager,
  seed,
  hot,
  dry,
  pity,
  pot,
  result,
  busy,
  reduced,
  reelRef,
}: {
  outcomes: readonly GambleOutcomeDef[]
  wager: number
  seed: number
  hot: boolean
  dry: number
  pity: boolean
  pot: number
  result: Result | null
  busy: boolean
  reduced: boolean
  reelRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* The node mock */}
      <section
        aria-label="KSampler widgets"
        className="rounded-xl border-2 border-charcoal-400 border-l-4 border-l-slot-latent bg-charcoal-700/50 p-3"
      >
        <div className="flex flex-col gap-1.5">
          <Widget label="seed">
            <span className={cn('font-mono text-lg font-extrabold tracking-[0.14em] tabular-nums', busy ? 'text-smoke-600' : 'text-electric-400')}>
              {seedText(seed)}
            </span>
          </Widget>

          <Widget label="control_after_generate">
            {hot ? (
              <span className="text-sm font-bold text-electric-400">
                fixed <span className="text-smoke-600">· hot sampler ×{SPIN_HOT_MULT}</span>
              </span>
            ) : (
              <span className="text-sm font-semibold text-smoke-100">randomize</span>
            )}
          </Widget>

          <Widget label="denoise">
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1" aria-hidden="true">
                {Array.from({ length: SPIN_PITY_DRY }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'size-2.5 rounded-full border',
                      i < dry ? 'border-slot-latent bg-slot-latent' : 'border-charcoal-300 bg-charcoal-600',
                    )}
                  />
                ))}
              </span>
              <span className={cn('text-[11px]', pity ? 'font-bold text-slot-latent' : 'text-smoke-600')}>
                {pity ? 'pity armed · the next NaN is converted' : `${dry} of ${SPIN_PITY_DRY} NaN in a row`}
              </span>
            </span>
          </Widget>
        </div>
      </section>

      <Reel boxRef={reelRef} outcomes={outcomes} result={result} busy={busy} reduced={reduced} />

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
              {busy ? 'Sampling…' : 'The seed decides. The table below says how often it decides in your favour.'}
            </p>
          )}
        </AnimatePresence>
      </div>

      {/* The odds, printed before the bet */}
      <section aria-labelledby="wheel-odds">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <SectionLabel>
            <span id="wheel-odds">Odds</span>
          </SectionLabel>
          <p className="text-[11px] text-smoke-600 tabular-nums">
            pot <span className="font-bold text-credits">{formatNum(pot)}</span> · rides on seed 42
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
                <tr key={o.id} className={cn('border-t border-charcoal-400/60', result?.outcome.id === o.id && 'bg-charcoal-500/60')}>
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
    </div>
  )
}

/** A ComfyUI widget row: label on the left, value on the right, inside a rounded pill. */
function Widget({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 rounded-comfy border border-charcoal-400 bg-charcoal-600 px-3 py-1.5">
      <span className="font-mono text-[11px] text-smoke-600">{label}</span>
      {children}
    </div>
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
  busy,
  reduced,
}: {
  boxRef: RefObject<HTMLDivElement | null>
  outcomes: readonly GambleOutcomeDef[]
  result: Result | null
  busy: boolean
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
          <span>{busy ? 'sampling' : 'idle'}</span>
          <span className="font-mono">{busy ? '· · ·' : '×?'}</span>
        </div>
      )}
      {/* The marker: a fixed electric caret the segments pass under. */}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-electric-400" />
      <span className="pointer-events-none absolute inset-0 rounded-comfy ring-1 ring-electric-400/25 ring-inset" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The coin
// ---------------------------------------------------------------------------

/**
 * Two faces and one number. Your side pays COIN_PAYOUT, Comfy's side keeps the stake, and both
 * chances sit under the coin where the bet is placed: the gap between them is the house, and it
 * is the only edge the coin has.
 */
function CoinTable({
  wager,
  flip,
  busy,
  reduced,
  coinRef,
}: {
  wager: number
  flip: FlipResult | null
  busy: boolean
  reduced: boolean
  coinRef: RefObject<HTMLDivElement | null>
}) {
  const win = flip?.side === 'you'
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="The coin"
        className="flex flex-col items-center gap-3 rounded-xl border-2 border-charcoal-400 border-l-4 border-l-slot-latent bg-charcoal-700/50 px-3 py-5"
      >
        <div ref={coinRef} className="grid size-24 place-items-center">
          <motion.div
            key={flip?.nonce ?? (busy ? 'turning' : 'idle')}
            aria-hidden="true"
            initial={reduced || !busy ? false : { rotateY: 0 }}
            animate={busy && !reduced ? { rotateY: 1440 } : { rotateY: 0 }}
            transition={busy && !reduced ? { duration: FLIP_MS / 1000, ease: 'easeOut' } : { duration: 0 }}
            className={cn(
              'grid size-24 place-items-center rounded-full border-4 shadow-[0_4px_0_#0e0e0f]',
              flip === null
                ? 'border-charcoal-300 bg-charcoal-600 text-smoke-600'
                : win
                  ? 'border-electric-400 bg-electric-400/15 text-electric-400'
                  : 'border-slot-vae bg-slot-vae/15 text-slot-vae',
            )}
          >
            {flip === null ? (
              <span className="font-mono text-2xl font-extrabold">{busy ? '· ·' : '?'}</span>
            ) : win ? (
              <span className="text-sm font-extrabold uppercase tracking-[0.08em]">You</span>
            ) : (
              <ComfyMark size={34} />
            )}
          </motion.div>
        </div>

        <div className="min-h-[40px] text-center" role="status">
          {flip ? (
            <p className="text-sm">
              <span className={cn('font-extrabold', win ? 'text-electric-400' : 'text-slot-vae')}>
                {win ? 'Your side. Paid double.' : 'Comfy side. The house keeps it.'}
              </span>{' '}
              <span className={cn('font-extrabold tabular-nums', win ? 'text-credits' : 'text-slot-vae')}>
                {win ? `+${formatNum(flip.payout - flip.wager)}` : `-${formatNum(flip.wager)}`}
              </span>
              {win && flip.streak > 1 ? <span className="text-smoke-600"> · {flip.streak} in a row</span> : null}
            </p>
          ) : (
            <p className="text-sm text-smoke-600">{busy ? 'In the air…' : 'One flip. Your side pays double, Comfy side takes the stake.'}</p>
          )}
        </div>
      </section>

      <section aria-labelledby="coin-odds">
        <SectionLabel>
          <span id="coin-odds">Odds</span>
        </SectionLabel>
        <table className="mt-1.5 w-full border-collapse text-left text-xs">
          <thead>
            <tr className="text-[10px] font-semibold tracking-[0.08em] text-smoke-800 uppercase">
              <th scope="col" className="py-1 font-semibold">
                Side
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
            <tr className="border-t border-charcoal-400/60">
              <td className="py-1 font-semibold text-electric-400">Your side</td>
              <td className="py-1 text-right font-bold text-smoke-100 tabular-nums">×{COIN_PAYOUT}</td>
              <td className="py-1 text-right text-smoke-600 tabular-nums">{chance(COIN_WIN_CHANCE)}</td>
              <td className="py-1 text-right font-bold text-credits tabular-nums">{formatNum(Math.round(wager * COIN_PAYOUT))}</td>
            </tr>
            <tr className="border-t border-charcoal-400/60">
              <td className="py-1 font-semibold text-slot-vae">Comfy side</td>
              <td className="py-1 text-right font-bold text-smoke-100 tabular-nums">×0</td>
              <td className="py-1 text-right text-smoke-600 tabular-nums">{chance(1 - COIN_WIN_CHANCE)}</td>
              <td className="py-1 text-right font-bold text-slot-vae tabular-nums">-{formatNum(wager)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  )
}

/** The house edge, always on screen. */
function Disclosure() {
  const store = useGameStore()
  const wheel = spinEv(store.catalog.gamble)
  return (
    <p className="mr-auto text-left text-[11px] text-smoke-600">
      Wheel {formatPct(wheel - 1)} · coin {formatPct(coinEv() - 1)} · both pay back less than they take · you can lose the whole bet
    </p>
  )
}
