'use client'
/**
 * The Generate button: the Comfy logo on a rounded square with a rotating conic aura behind it.
 * One pointerdown = one `store.click()` (no hold-to-repeat), a spring squash, an electric ripple,
 * floating "+N" and a burst of credit diamonds at the pointer. Space is handled by `useHotkeys`;
 * keyboard clicks still get the squash and a centred float via the store's `click` event.
 *
 * There are two controls here and they are one button. The square is the click target and the pill
 * under it is the same click with a word on it, which is not obvious the first time: a QA reader
 * took the square for artwork and the pill for something that queued a job, the way the Studio's
 * "Generate post" does. So the square now answers a hover and a focus the way a control should,
 * both carry the one tooltip that says they are the same press, their accessible names differ so a
 * screen reader does not meet two buttons called Generate, and until the first click of a save the
 * square wears a breathing ring. The tour cuts its first spotlight around `data-tour="hero-controls"`,
 * which holds both; `data-tour="generate"` stays on the square because `focusHero` focuses it.
 *
 * The guard has two visible states. A synthetic event never reaches the store at all
 * (`trustedInput`). A click the engine refuses, past the rate cap, pays nothing, so it draws
 * nothing: no float, no burst, no ripple, no squash, because a "+N" for a click that earned
 * nothing is a lie. The combo pill says `MAX` for it; this button stays exactly as it is, since
 * the next click inside the window pays and there is nothing to wait out.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Play } from 'lucide-react'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { useGame, useGameEvents, useGameStore } from '@/state/useGame'
import { formatNum } from '@/game/format'
import { fx } from '@/components/fx/fxBus'
import { Tooltip } from '@/components/common/Tooltip'
import { generateButtonTip } from '@/components/common/tooltipCopy'
import { playCue } from '@/audio/sfxEngine'
import { GENERATE_HOTKEY_ATTR } from '@/hooks/useHotkeys'
import { trustedInput } from '@/lib/input'
import { cn } from '@/lib/utils'

/** 34 % of the viewport height, floored at 220 px so the column still fits 1280x720. */
const BOX = 'clamp(220px, 34dvh, 300px)'
const RADIUS = `calc(${BOX} * 0.354)`
/** Intrinsic size handed to `next/image`; the CSS width is what actually sizes the logo. */
const LOGO = 300
const MAX_RIPPLES = 6
/** `electric-400`: the lucky-seed float, the one click in two hundred that pays ten times. */
const ELECTRIC = '#f0ff41'

/**
 * `formatNum` rounds everything under 1000 to a whole number, which turns a halved 0.5 click
 * (broken-node event) into "+1". Keep one decimal while the value is small and rounding would
 * misstate it by a quarter or more; the +1% achievement creep (1.05, 1.1…) still reads as "+1",
 * matching how every other credit figure in the UI rounds.
 */
export function formatClickValue(value: number): string {
  if (Number.isFinite(value) && value < 100 && Math.abs(value - Math.round(value)) >= 0.25) return value.toFixed(1)
  return formatNum(value)
}

interface Ripple {
  id: number
  x: number
  y: number
}

/** Aura spin period in seconds: 14 s idle, tightening toward 2 s as income climbs. */
function auraDuration(cps: number): number {
  const d = 14 / (1 + Math.log10(cps + 1))
  return Math.round(Math.max(2, d) * 10) / 10
}

export function GenerateButton() {
  const store = useGameStore()
  const cps = useGame((_s, d) => d.cps)
  const clickValue = useGame((_s, d) => d.clickValue)
  // A boolean, so the 20 Hz loop re-renders this once: on the first click of the save.
  const untouched = useGame((s) => s.totalClicks === 0)
  const reducedSetting = useGame((s) => s.settings.reducedMotion)
  const reduced = Boolean(useReducedMotion()) || reducedSetting
  const reducedRef = useRef(reduced)

  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const scale = useMotionValue(1)
  const [ripples, setRipples] = useState<Ripple[]>([])
  const rippleId = useRef(0)
  const fromPointer = useRef(false)

  const squash = useCallback(() => {
    if (reducedRef.current) return
    animate(scale, [0.94, 1.04, 1], { duration: 0.3, ease: 'easeOut' })
  }, [scale])

  const ripple = useCallback((clientX: number, clientY: number) => {
    if (reducedRef.current) return
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const id = ++rippleId.current
    setRipples((prev) => [...prev.slice(-(MAX_RIPPLES - 1)), { id, x: clientX - rect.left, y: clientY - rect.top }])
  }, [])

  const removeRipple = useCallback((id: number) => {
    setRipples((prev) => prev.filter((r) => r.id !== id))
  }, [])

  /** Feedback for a click at a viewport point, whatever produced it. Never called for a refusal. */
  const feedback = useCallback(
    (clientX: number, clientY: number, value: number, lucky: boolean) => {
      squash()
      ripple(clientX, clientY)
      if (lucky) {
        fx.floatText(clientX, clientY - 14, `+${formatClickValue(value)} · seed 42`, ELECTRIC)
        fx.burst(clientX, clientY, 12)
        playCue({ name: 'cash' })
        return
      }
      fx.floatText(clientX, clientY - 12, `+${formatClickValue(value)}`)
      fx.burst(clientX, clientY)
    },
    [squash, ripple],
  )

  const clickAt = useCallback(
    (clientX: number, clientY: number) => {
      fromPointer.current = true
      const result = store.click()
      fromPointer.current = false
      // Past the rate cap: the click paid nothing, so it draws nothing.
      if (result.events.some((e) => e.type === 'clickBlocked')) return
      const event = result.events.find((e) => e.type === 'click')
      const value = event && event.type === 'click' ? event.value : store.derived.clickValue
      const lucky = event !== undefined && event.type === 'click' && event.lucky === true
      feedback(clientX, clientY, value, lucky)
    },
    [store, feedback],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!trustedInput(e.nativeEvent)) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      clickAt(e.clientX, e.clientY)
    },
    [clickAt],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'Enter' || e.repeat) return
      if (!trustedInput(e.nativeEvent)) return
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      clickAt(rect.left + rect.width / 2, rect.top + rect.height / 2)
    },
    [clickAt],
  )

  // Clicks that did not come through this component (Space, other UI) still squash the logo.
  useGameEvents((event) => {
    if (event.type !== 'click' || fromPointer.current) return
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    feedback(rect.left + rect.width / 2, rect.top + rect.height * 0.42, event.value, event.lucky === true)
  })

  useEffect(() => {
    reducedRef.current = reduced
    if (reduced) scale.set(1)
  }, [reduced, scale])

  return (
    <div data-tour="hero-controls" className="flex w-full flex-col items-center gap-3">
      <div className="relative flex items-center justify-center" style={{ width: BOX, height: BOX, maxWidth: '100%' }}>
        <div
          aria-hidden="true"
          className={cn('pointer-events-none absolute -inset-4 opacity-80 blur-2xl', !reduced && 'cc-aura')}
          style={
            {
              '--cc-aura-duration': `${auraDuration(cps)}s`,
              borderRadius: '50%',
              background: 'conic-gradient(from 0deg, #f0ff41, #172dd7 35%, #ff9cf9 65%, #f0ff41)',
            } as React.CSSProperties
          }
        />
        <Tooltip {...generateButtonTip(clickValue)} side="bottom" delay={600}>
        <motion.button
          ref={buttonRef}
          type="button"
          data-tour="generate"
          aria-label={`Generate. Earns ${formatClickValue(clickValue)} ${clickValue === 1 ? 'credit' : 'credits'} per click`}
          {...{ [GENERATE_HOTKEY_ATTR]: 'true' }}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => e.preventDefault()}
          style={{ scale, width: BOX, height: BOX, maxWidth: '100%', borderRadius: RADIUS, touchAction: 'manipulation' }}
          className={cn(
            'relative isolate flex select-none items-center justify-center overflow-hidden border-2 border-charcoal-300 bg-charcoal-700 shadow-[0_6px_0_#0e0e0f] outline-none transition-colors duration-150 [-webkit-tap-highlight-color:transparent] focus-visible:ring-4 focus-visible:ring-electric-400',
            // A 245 px target with no hover answer reads as artwork. Colours only: the scale is a
            // Motion value on this element and a CSS transform transition would fight it.
            'cursor-pointer hover:border-electric-400 hover:bg-charcoal-600',
          )}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(circle at 50% 35%, rgb(240 255 65 / 0.12), transparent 60%)' }}
          />
          {/* Until the first click of a save, the square says press me. A sibling span rather than
              a class on the button: `cc-breathe` animates a transform and the button's scale is a
              Motion value. The utility is already reduced-motion guarded in globals.css. */}
          {untouched ? (
            <span
              aria-hidden="true"
              className="cc-breathe pointer-events-none absolute inset-0 rounded-[inherit] ring-4 ring-electric-400 ring-inset"
            />
          ) : null}
          <Image
            src="/brand/comfy-logo-glyph.png"
            alt=""
            width={LOGO}
            height={LOGO}
            priority
            unoptimized
            draggable={false}
            className="pointer-events-none relative h-auto w-[86%] select-none drop-shadow-[0_8px_18px_rgba(23,45,215,0.45)]"
          />
          <AnimatePresence>
            {ripples.map((r) => (
              <motion.span
                key={r.id}
                aria-hidden="true"
                initial={{ scale: 0.2, opacity: 0.9 }}
                animate={{ scale: 2.4, opacity: 0 }}
                transition={{ duration: 0.55, ease: 'easeOut' }}
                onAnimationComplete={() => removeRipple(r.id)}
                className="pointer-events-none absolute size-24 rounded-full border-[3px] border-electric-400"
                style={{ left: r.x - 48, top: r.y - 48 }}
              />
            ))}
          </AnimatePresence>
        </motion.button>
        </Tooltip>
      </div>

      <Tooltip {...generateButtonTip(clickValue)} side="bottom">
        <motion.button
          type="button"
          // The square above owns the same action, so the two names differ. The visible label is
          // still "Generate" and the accessible name still opens with it, which is what a voice
          // control listens for.
          aria-label="Generate. Same as the logo above"
          {...{ [GENERATE_HOTKEY_ATTR]: 'true' }}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          whileTap={reduced ? undefined : { y: 3, boxShadow: '0 1px 0 #0e0e0f' }}
          whileHover={reduced ? undefined : { scale: 1.03 }}
          transition={{ type: 'spring', stiffness: 600, damping: 30 }}
          style={{ touchAction: 'manipulation' }}
          className={cn(
            'inline-flex select-none items-center gap-2 rounded-full px-6 py-2.5 text-base font-bold shadow-[0_4px_0_#0e0e0f] outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-4 focus-visible:ring-electric-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal-600',
            'cursor-pointer bg-electric-400 text-charcoal-800',
          )}
        >
          <Play size={18} strokeWidth={3} fill="currentColor" aria-hidden="true" />
          Generate
        </motion.button>
      </Tooltip>
    </div>
  )
}
