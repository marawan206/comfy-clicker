'use client'
/**
 * The game's one tooltip. Node chrome (2 px border, hard shadow) on `@base-ui/react/tooltip`, with
 * a fixed set of lines: title, description, a cost row, a meta row and a lock row. Text only, never
 * a button: an actionable lock belongs in the guidance popover, not in a thing that closes on blur.
 *
 * `TooltipProviderRoot` is mounted once in `GameProvider`, so the 350 ms delay is shared and moving
 * between two tooltips inside 300 ms opens the second one instantly.
 *
 * Copy lives in `tooltipCopy.ts` as pure builders: `<Tooltip {...hardwareRowTip(def, row)}>`.
 */
import type { ReactElement, ReactNode } from 'react'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { Lock } from 'lucide-react'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { formatNum } from '@/game/format'
import { cn } from '@/lib/utils'

export type TooltipTone = 'default' | 'electric' | 'locked' | 'credits'
export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'
export type TooltipAlign = 'start' | 'center' | 'end'

/** What a thing costs. `have` is the player's balance; it only annotates the credits figure. */
export interface TooltipCost {
  credits?: number
  rp?: number
  cp?: number
  have?: number
}

export interface TooltipProps {
  title?: ReactNode
  description?: ReactNode
  cost?: TooltipCost
  meta?: ReactNode
  lock?: string | null
  shortcut?: string
  tone?: TooltipTone
  side?: TooltipSide
  align?: TooltipAlign
  /** Open delay in ms; falls back to the provider's 350. */
  delay?: number
  disabled?: boolean
  children: ReactElement
}

const TITLE_TONE: Record<TooltipTone, string> = {
  default: 'text-smoke-100',
  electric: 'text-electric-400',
  locked: 'text-slot-vae',
  credits: 'text-credits',
}

const SIDE_OFFSET = 8
const COLLISION_PADDING = 12

/** `z-[85]` sits above modals (80) by the ladder in UI-SPEC. */
const POPUP_CLASS =
  'cc-tooltip z-[85] max-w-[280px] rounded-xl border-2 border-charcoal-400 bg-charcoal-700 px-3 py-2 text-left shadow-[0_4px_0_#0e0e0f]'

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="ml-auto shrink-0 rounded-[0.354em] border border-charcoal-300 bg-charcoal-600 px-1.5 py-px font-sans text-[10px] font-bold tracking-[0.04em] text-smoke-600 uppercase">
      {children}
    </kbd>
  )
}

/** The cost row: credits in amber with `· have N` when short, then RP and CP in their own tints. */
function CostRow({ cost }: { cost: TooltipCost }) {
  const { credits, rp, cp, have } = cost
  const short = credits !== undefined && have !== undefined && have < credits
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold tabular-nums">
      {credits !== undefined && (
        <span className="inline-flex items-center gap-1 text-credits">
          <CreditsIcon size={11} aria-hidden="true" />
          {formatNum(credits)}
          {short && <span className="font-semibold text-slot-vae">· have {formatNum(have ?? 0)}</span>}
        </span>
      )}
      {rp !== undefined && (
        <span className="text-electric-400">
          {formatNum(rp)} <span className="text-[10px] tracking-[0.08em]">RP</span>
        </span>
      )}
      {cp !== undefined && (
        <span className="text-slot-latent">
          {formatNum(cp)} <span className="text-[10px] tracking-[0.08em]">CP</span>
        </span>
      )}
    </div>
  )
}

/**
 * A rich tooltip around any single element. The child is rendered as the trigger itself (no extra
 * wrapper), so keep its own `aria-label` and drop the `title=` attribute it used to carry.
 */
export function Tooltip({
  title,
  description,
  cost,
  meta,
  lock,
  shortcut,
  tone = 'default',
  side = 'top',
  align = 'center',
  delay,
  disabled = false,
  children,
}: TooltipProps) {
  const empty = title === undefined && description === undefined && cost === undefined && meta === undefined && !lock
  if (disabled || empty) return children

  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger delay={delay} render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          align={align}
          sideOffset={SIDE_OFFSET}
          collisionPadding={COLLISION_PADDING}
          className="z-[85]"
        >
          <BaseTooltip.Popup className={POPUP_CLASS}>
            {title !== undefined && (
              <div className="flex items-center gap-2">
                <span className={cn('text-xs font-semibold leading-tight', TITLE_TONE[tone])}>{title}</span>
                {shortcut ? <Kbd>{shortcut}</Kbd> : null}
              </div>
            )}
            {description !== undefined && (
              <p className="mt-0.5 text-[11px] leading-snug whitespace-pre-line text-smoke-600">{description}</p>
            )}
            {cost ? <CostRow cost={cost} /> : null}
            {meta !== undefined && <p className="mt-1 text-[11px] leading-snug text-smoke-700">{meta}</p>}
            {lock ? (
              <p className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-slot-vae">
                <Lock size={11} aria-hidden="true" className="mt-px shrink-0" />
                <span>{lock}</span>
              </p>
            ) : null}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}

export interface TipProps extends Omit<TooltipProps, 'title' | 'description'> {
  text: ReactNode
}

/** One-line shorthand: `<Tip text="Open the Models tab"><button ... /></Tip>`. */
export function Tip({ text, children, ...rest }: TipProps) {
  return (
    <Tooltip title={text} {...rest}>
      {children}
    </Tooltip>
  )
}

/**
 * The shared delay group. Mounted once in `GameProvider`: 350 ms before the first tooltip opens,
 * nothing on close, and 300 ms of grace in which the next tooltip opens with no delay at all.
 */
export function TooltipProviderRoot({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={350} closeDelay={0} timeout={300}>
      {children}
    </BaseTooltip.Provider>
  )
}
