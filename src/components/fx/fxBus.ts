/**
 * Tiny pub/sub between UI components and the FX canvas. Components call `fx.*` from event
 * handlers (pointer positions are viewport coordinates); `FxCanvas` subscribes once and turns
 * each command into particles. No React here so it can be called from anywhere, including
 * the store's event listeners.
 */

export type FxCommand =
  | { kind: 'floatText'; x: number; y: number; text: string; color?: string }
  | { kind: 'burst'; x: number; y: number; count?: number }
  | { kind: 'confetti' }
  | { kind: 'flash'; color?: string }
  | { kind: 'rain'; density: number }

export type FxListener = (command: FxCommand) => void

const listeners = new Set<FxListener>()

/** Subscribe to FX commands; returns the unsubscribe function. */
export function subscribeFx(listener: FxListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(command: FxCommand): void {
  for (const listener of listeners) listener(command)
}

export const fx = {
  /** Floating text (e.g. `+12`) rising from a viewport point; defaults to the credits amber. */
  floatText(x: number, y: number, text: string, color?: string): void {
    emit(color === undefined ? { kind: 'floatText', x, y, text } : { kind: 'floatText', x, y, text, color })
  },
  /** A handful of credit diamonds bursting from a viewport point (3–6 when `count` is omitted). */
  burst(x: number, y: number, count?: number): void {
    emit(count === undefined ? { kind: 'burst', x, y } : { kind: 'burst', x, y, count })
  },
  /** 120 confetti pieces from the top of the viewport (viral post, big unlocks). */
  confetti(): void {
    emit({ kind: 'confetti' })
  },
  /** A brief full-screen tint; defaults to electric yellow. */
  flash(color?: string): void {
    emit(color === undefined ? { kind: 'flash' } : { kind: 'flash', color })
  },
  /**
   * Temporarily raise the credit-rain density (sprites on screen, 0–60). The canvas eases back
   * to the cps-driven density after a few seconds, so this is a burst, not a setting.
   */
  rain(density: number): void {
    emit({ kind: 'rain', density })
  },
}
