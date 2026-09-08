import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type Stripe = 'model' | 'clip' | 'cond' | 'image' | 'latent' | 'vae' | 'mask' | 'electric' | 'sapphire' | 'none'

const STRIPES: Record<Stripe, string> = {
  model: 'border-l-slot-model',
  clip: 'border-l-slot-clip',
  cond: 'border-l-slot-cond',
  image: 'border-l-slot-image',
  latent: 'border-l-slot-latent',
  vae: 'border-l-slot-vae',
  mask: 'border-l-slot-mask',
  electric: 'border-l-electric-400',
  sapphire: 'border-l-sapphire-700',
  none: 'border-l-charcoal-400',
}

export interface PanelProps {
  title?: ReactNode
  /** Right-aligned header content (counts, buttons). */
  right?: ReactNode
  stripe?: Stripe
  className?: string
  bodyClassName?: string
  children: ReactNode
}

/** A ComfyUI-node-styled panel: chunky border, hard shadow, category stripe, uppercase header. */
export function Panel({ title, right, stripe = 'none', className, bodyClassName, children }: PanelProps) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col rounded-2xl border-2 border-charcoal-400 border-l-4 bg-charcoal-600 shadow-[0_4px_0_#0e0e0f]',
        STRIPES[stripe],
        className,
      )}
    >
      {title !== undefined && (
        <header className="flex items-center justify-between gap-3 border-b border-charcoal-400/70 px-4 py-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">{title}</h2>
          {right ? <div className="flex items-center gap-2 text-xs text-smoke-600">{right}</div> : null}
        </header>
      )}
      <div className={cn('min-h-0 flex-1 p-4', bodyClassName)}>{children}</div>
    </section>
  )
}
