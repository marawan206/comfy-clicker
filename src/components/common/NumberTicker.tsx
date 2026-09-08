'use client'
import { useEffect, useRef, useState } from 'react'
import { formatNum } from '@/game/format'

interface Props {
  value: number
  /** Formatter; defaults to formatNum. */
  format?: (n: number) => string
  /** Approach speed per frame (0..1); higher = snappier. */
  speed?: number
  className?: string
}

/** Eases a displayed number toward `value` each frame so 20 Hz updates read as a smooth roll. */
export function NumberTicker({ value, format = formatNum, speed = 0.25, className }: Props) {
  const [shown, setShown] = useState(value)
  const target = useRef(value)
  const current = useRef(value)
  target.current = value
  useEffect(() => {
    let raf = 0
    const step = () => {
      const t = target.current
      const c = current.current
      const next = Math.abs(t - c) < Math.max(1, Math.abs(t) * 1e-6) ? t : c + (t - c) * speed
      if (next !== c) {
        current.current = next
        setShown(next)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [speed])
  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {format(shown)}
    </span>
  )
}
