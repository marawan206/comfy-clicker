'use client'
/**
 * The FX layer: one full-viewport canvas above the UI (pointer-events none) that draws floating
 * credit text, credit-diamond bursts, a light credit rain over the hero column, confetti and
 * screen flashes. Plain arrays, one rAF loop, DPR aware, paused while the tab is hidden, capped
 * at 300 sprites, and switched off entirely by `settings.particles = false` or reduced motion.
 */
import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'motion/react'
import { useGame, useGameEvents } from '@/state/useGame'
import { subscribeFx, type FxCommand } from '@/components/fx/fxBus'

const COLOR_CREDITS = '#fbbf24'
const COLOR_ELECTRIC = '#f0ff41'
const COLOR_SAPPHIRE = '#172dd7'
const COLOR_PINK = '#ff9cf9'
const COLOR_WHITE = '#f3f3f3'
/** slot-vae: the locked/loss colour, and so the colour a ratioed post flashes. */
const COLOR_RATIO = '#ff6e6e'
const CONFETTI_COLORS = [COLOR_ELECTRIC, COLOR_SAPPHIRE, COLOR_WHITE, COLOR_PINK]
/** Roulette multiplier that earns confetti: the golden seed and the x42. */
const SPIN_CONFETTI_MULT = 10

const MAX_SPRITES = 300
const MAX_FLOATS = 80
const RAIN_RESERVE = 60
/** Credit rain lives in the left 30 % of the viewport (the hero column). */
const RAIN_BAND = 0.3
const RAIN_ALPHA = 0.25
const SPRITE_PX = 12
/** The lucide "component" glyph the CreditsIcon draws (24-unit viewBox). */
const CREDITS_PATH =
  'M15.536 11.293a1 1 0 0 0 0 1.414l2.376 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0zm-13.239 0a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414L6.088 8.916a1 1 0 0 0-1.414 0zm6.619 6.619a1 1 0 0 0 0 1.415l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.415l-2.377-2.376a1 1 0 0 0-1.414 0zm0-13.238a1 1 0 0 0 0 1.414l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z'

type SpriteKind = 'diamond' | 'rain' | 'confetti'

interface Sprite {
  kind: SpriteKind
  x: number
  y: number
  vx: number
  vy: number
  /** Seconds lived / total seconds. */
  age: number
  ttl: number
  rot: number
  vr: number
  scale: number
  color: string
  /** Rain sway phase. */
  phase: number
}

interface FloatText {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  ttl: number
  text: string
  color: string
  size: number
}

interface Flash {
  color: string
  age: number
  ttl: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo)
}

/** Draws the credits glyph once into an offscreen canvas so every sprite is a cheap blit. */
function rasterCredits(dpr: number, color: string): HTMLCanvasElement {
  const px = SPRITE_PX * dpr
  const off = document.createElement('canvas')
  off.width = px
  off.height = px
  const ctx = off.getContext('2d')
  if (!ctx) return off
  ctx.scale(px / 24, px / 24)
  const path = new Path2D(CREDITS_PATH)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.fillStyle = color
  ctx.globalAlpha = 0.55
  ctx.fill(path)
  ctx.globalAlpha = 1
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.stroke(path)
  return off
}

class FxEngine {
  private readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private sprites: Sprite[] = []
  private floats: FloatText[] = []
  private flashes: Flash[] = []
  private glyph: HTMLCanvasElement | null = null
  private width = 0
  private height = 0
  private dpr = 1
  private raf = 0
  private last = 0
  private running = false
  /** Density the game asks for (from cps). */
  private baseRain = 0
  /** Temporary override from `fx.rain`, eased back to `baseRain`. */
  private boostRain = 0
  private boostUntil = 0
  private rainAccumulator = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
  }

  resize(): void {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2)
    const w = window.innerWidth
    const h = window.innerHeight
    if (w === this.width && h === this.height && dpr === this.dpr && this.glyph) return
    this.width = w
    this.height = h
    this.dpr = dpr
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.glyph = rasterCredits(dpr, COLOR_CREDITS)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  destroy(): void {
    this.stop()
    this.sprites = []
    this.floats = []
    this.flashes = []
    this.ctx?.clearRect(0, 0, this.width, this.height)
  }

  setBaseRain(density: number): void {
    this.baseRain = clamp(density, 0, 60)
  }

  handle(command: FxCommand): void {
    switch (command.kind) {
      case 'floatText':
        this.floatText(command.x, command.y, command.text, command.color ?? COLOR_CREDITS)
        break
      case 'burst':
        this.burst(command.x, command.y, command.count ?? 3 + Math.floor(Math.random() * 4))
        break
      case 'confetti':
        this.confetti()
        break
      case 'flash':
        this.flashes.push({ color: command.color ?? COLOR_ELECTRIC, age: 0, ttl: 0.4 })
        if (this.flashes.length > 3) this.flashes.shift()
        break
      case 'rain':
        this.boostRain = clamp(command.density, 0, 60)
        this.boostUntil = performance.now() + 4000
        break
    }
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    if (this.floats.length >= MAX_FLOATS) this.floats.shift()
    // Rapid clicks land on one spot, so fan each new number out and lift it above the ones still alive.
    const stacked = this.floats.length
    this.floats.push({
      x: x + rand(-22, 22),
      y: y - Math.min(stacked, 12) * 5,
      vx: rand(-12, 12),
      vy: -rand(50, 90),
      age: 0,
      ttl: 0.95,
      text,
      color,
      size: text.length > 8 ? 15 : 18,
    })
  }

  private burst(x: number, y: number, count: number): void {
    const room = MAX_SPRITES - this.sprites.length
    const n = Math.min(count, room)
    for (let i = 0; i < n; i++) {
      const angle = rand(-Math.PI * 0.95, -Math.PI * 0.05)
      const speed = rand(120, 260)
      this.sprites.push({
        kind: 'diamond',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        ttl: rand(0.6, 0.9),
        rot: rand(0, Math.PI * 2),
        vr: rand(-6, 6),
        scale: rand(0.8, 1.3),
        color: COLOR_CREDITS,
        phase: 0,
      })
    }
  }

  private confetti(): void {
    const room = MAX_SPRITES - this.sprites.length
    const n = Math.min(120, room)
    const cx = this.width / 2
    for (let i = 0; i < n; i++) {
      const angle = rand(-Math.PI * 0.85, -Math.PI * 0.15)
      const speed = rand(260, 520)
      this.sprites.push({
        kind: 'confetti',
        x: cx + rand(-this.width * 0.15, this.width * 0.15),
        y: this.height * 0.28,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        ttl: rand(1.8, 2.8),
        rot: rand(0, Math.PI * 2),
        vr: rand(-10, 10),
        scale: rand(0.7, 1.3),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length] as string,
        phase: rand(0, Math.PI * 2),
      })
    }
  }

  private spawnRain(dt: number): void {
    const now = performance.now()
    const target = now < this.boostUntil ? Math.max(this.baseRain, this.boostRain) : this.baseRain
    if (target <= 0) return
    let live = 0
    for (const s of this.sprites) if (s.kind === 'rain') live++
    if (live >= target) return
    if (this.sprites.length >= MAX_SPRITES - RAIN_RESERVE) return
    // Trickle in rather than dumping the whole target in one frame.
    this.rainAccumulator += dt * Math.max(4, target * 0.5)
    while (this.rainAccumulator >= 1 && live < target) {
      this.rainAccumulator -= 1
      live++
      this.sprites.push({
        kind: 'rain',
        x: rand(8, this.width * RAIN_BAND),
        y: -SPRITE_PX,
        vx: 0,
        vy: rand(45, 95),
        age: 0,
        ttl: Infinity,
        rot: rand(-0.3, 0.3),
        vr: rand(-0.6, 0.6),
        scale: rand(0.7, 1.1),
        color: COLOR_CREDITS,
        phase: rand(0, Math.PI * 2),
      })
    }
  }

  private frame = (t: number): void => {
    if (!this.running) return
    const dt = clamp((t - this.last) / 1000, 0, 0.05)
    this.last = t
    this.step(dt)
    this.draw()
    this.raf = requestAnimationFrame(this.frame)
  }

  private step(dt: number): void {
    this.spawnRain(dt)
    const h = this.height
    const rainEdge = this.width * RAIN_BAND
    const sprites = this.sprites
    let w = 0
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i] as Sprite
      s.age += dt
      switch (s.kind) {
        case 'diamond':
          s.vy += 720 * dt
          s.vx *= 1 - 2.5 * dt
          break
        case 'confetti':
          s.vy += 380 * dt
          s.vx *= 1 - 1.6 * dt
          s.phase += dt * 6
          s.x += Math.sin(s.phase) * 40 * dt
          break
        case 'rain':
          s.phase += dt * 1.5
          s.x += Math.sin(s.phase) * 12 * dt
          if (s.x > rainEdge) s.x = rainEdge
          break
      }
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.rot += s.vr * dt
      const dead = s.age >= s.ttl || s.y > h + 24 || (s.kind !== 'rain' && (s.x < -40 || s.x > this.width + 40))
      if (!dead) sprites[w++] = s
    }
    sprites.length = w

    const floats = this.floats
    w = 0
    for (let i = 0; i < floats.length; i++) {
      const f = floats[i] as FloatText
      f.age += dt
      f.x += f.vx * dt
      f.y += f.vy * dt
      f.vy *= 1 - 1.2 * dt
      if (f.age < f.ttl) floats[w++] = f
    }
    floats.length = w

    const flashes = this.flashes
    w = 0
    for (let i = 0; i < flashes.length; i++) {
      const f = flashes[i] as Flash
      f.age += dt
      if (f.age < f.ttl) flashes[w++] = f
    }
    flashes.length = w
  }

  private draw(): void {
    const ctx = this.ctx
    if (!ctx) return
    ctx.clearRect(0, 0, this.width, this.height)
    if (this.sprites.length === 0 && this.floats.length === 0 && this.flashes.length === 0) return

    const glyph = this.glyph
    const half = SPRITE_PX / 2
    for (const s of this.sprites) {
      ctx.save()
      ctx.translate(s.x, s.y)
      ctx.rotate(s.rot)
      if (s.kind === 'confetti') {
        const fade = s.age > s.ttl - 0.5 ? (s.ttl - s.age) / 0.5 : 1
        ctx.globalAlpha = clamp(fade, 0, 1)
        ctx.fillStyle = s.color
        const cw = 8 * s.scale
        const ch = 4 * s.scale
        ctx.fillRect(-cw / 2, -ch / 2, cw, ch)
      } else if (glyph) {
        ctx.globalAlpha = s.kind === 'rain' ? RAIN_ALPHA : clamp(1 - (s.age / s.ttl) ** 2, 0, 1)
        ctx.scale(s.scale, s.scale)
        ctx.drawImage(glyph, -half, -half, SPRITE_PX, SPRITE_PX)
      }
      ctx.restore()
    }

    if (this.floats.length > 0) {
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      for (const f of this.floats) {
        const p = f.age / f.ttl
        const pop = p < 0.15 ? 0.85 + p : 1
        ctx.globalAlpha = p > 0.6 ? clamp(1 - (p - 0.6) / 0.4, 0, 1) : 1
        ctx.font = `800 ${Math.round(f.size * pop)}px Inter, ui-sans-serif, system-ui, sans-serif`
        ctx.lineWidth = 4
        ctx.strokeStyle = 'rgba(14, 14, 15, 0.85)'
        ctx.strokeText(f.text, f.x, f.y)
        ctx.fillStyle = f.color
        ctx.fillText(f.text, f.x, f.y)
      }
      ctx.restore()
    }

    for (const f of this.flashes) {
      const p = f.age / f.ttl
      ctx.globalAlpha = 0.28 * (1 - p) ** 1.5
      ctx.fillStyle = f.color
      ctx.fillRect(0, 0, this.width, this.height)
    }
    ctx.globalAlpha = 1
  }
}

/** Full-viewport FX canvas. Mount once, above the shell; renders nothing when FX are off. */
export function FxCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<FxEngine | null>(null)
  const settingsOn = useGame((s) => s.settings.particles && !s.settings.reducedMotion)
  const systemReduced = useReducedMotion()
  const active = settingsOn && !systemReduced
  const rainDensity = useGame((_s, d) => Math.round(clamp(Math.log10(d.cps + 1) * 8, 0, 60)))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!active || !canvas) return
    const engine = new FxEngine(canvas)
    engineRef.current = engine
    engine.resize()
    engine.setBaseRain(rainDensity)
    if (!document.hidden) engine.start()

    const onVisibility = () => {
      if (document.hidden) engine.stop()
      else engine.start()
    }
    const onResize = () => engine.resize()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('resize', onResize)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null
    observer?.observe(document.documentElement)
    const unsubscribe = subscribeFx((command) => engine.handle(command))

    return () => {
      unsubscribe()
      observer?.disconnect()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      engine.destroy()
      if (engineRef.current === engine) engineRef.current = null
    }
    // rainDensity is pushed by the effect below; only `active` should rebuild the engine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    engineRef.current?.setBaseRain(rainDensity)
  }, [rainDensity])

  useGameEvents((event) => {
    const engine = engineRef.current
    if (!engine) return
    switch (event.type) {
      case 'postResolved':
        if (event.viral) engine.handle({ kind: 'confetti' })
        // A ratio gets the same treatment as a viral post, in the opposite colour: one short red
        // wash, no particles. The card and the toast carry the detail.
        else if (event.ratioed) engine.handle({ kind: 'flash', color: COLOR_RATIO })
        break
      case 'achievement':
        engine.handle({ kind: 'flash', color: COLOR_ELECTRIC })
        break
      case 'milestone':
        engine.handle({ kind: 'flash', color: COLOR_CREDITS })
        break
      case 'easterEgg':
        engine.handle({ kind: 'confetti' })
        break
      case 'levelUp':
        engine.handle({ kind: 'confetti' })
        engine.handle({ kind: 'flash', color: COLOR_ELECTRIC })
        break
      case 'spin':
        // Golden seed and up. Anything smaller is a number changing, not an event.
        if (event.mult >= SPIN_CONFETTI_MULT) engine.handle({ kind: 'confetti' })
        break
      case 'flip':
        // A doubled bet is worth a wash of colour; a lost one is already a number falling.
        if (event.payout > 0) engine.handle({ kind: 'flash', color: COLOR_ELECTRIC })
        break
      case 'reward':
        engine.handle({ kind: 'confetti' })
        break
      default:
        break
    }
  })

  if (!active) return null
  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 select-none" />
}
