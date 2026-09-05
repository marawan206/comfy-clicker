# Comfy Clicker — UI specification

Next.js 16 App Router, React 19, Tailwind 4, `motion` (motion.dev, `import { motion, AnimatePresence, useSpring } from 'motion/react'`),
shadcn base (`src/components/ui`), Kokonut UI components (installed via `pnpm dlx shadcn@latest add https://kokonutui.com/r/<slug>.json`),
lucide icons, brand SVGs in `src/assets/brand` (import as React components through `@svgr/webpack`? NO — Next 16 without config:
use `next/image` for `/brand/*.svg` in `public/brand`, and inline the few we recolor (credits, comfy-c) as small React components in `src/components/brand/`).

## State access
`src/state/useGame.ts`: `useGame(selector, equals?)`, `useGameShallow(selector)`, `useGameStore()`, `useGameLifecycle()`, `useGameEvents(handler)`.
`src/state/store.ts` exposes actions: `click, buyHardware(id, n|'max'), buyUpgrade, unlockMapNode, quantize, setupModel, trainLora, queueJob, claimContract, claimDaily, rebrand, resolveEvent, upscalePost, toggleSetting, setFlag, setWeekOverride, setLiveTrending, hardReset, replaceState, save, dismissOffline`.
Game formulas/helpers: `src/game/*` (see CONTRACT.md) — UI never re-implements math; it calls `unitCost`, `bulkCost`, `maxAffordable`, `paybackSec`, `canBuy`, `lockReason`, `runnableHardware`, `bestRunnable`, `genTimeMs`, `jobCost`, `quantFee`, `setupFee`, `currentTrending`, `msUntilRollover`, `matchTags`, `trendMult`, `likesAt`, `mapNodeAvailable`, `canAffordNode`, `rebrandCp`, `canRebrand`, `canClaim` (daily), `isUnlocked`, formatters from `format.ts`.
All game components are client components (`'use client'`). Selectors must return primitives or small objects with `useGameShallow`. The counter/cps/power meter may update at 20 Hz; lists (store rows, feed) must select stable slices (counts, ids, affordability booleans) so they re-render only on change.

## Visual language (identity — not Cookie Clicker's)
- Canvas: `bg-charcoal-800` page with a litegraph dot grid (`radial-gradient(#3c3d42 1px, transparent 1px)` 24 px, every 5th dot stronger via a second layer at 120 px), subtle vignette.
- Panels ("nodes"): `bg-charcoal-600 border-2 border-charcoal-400 rounded-2xl shadow-[0_4px_0_#0e0e0f]`, a 4 px left category stripe using slot colours (`slot-image` hardware, `slot-cond` upgrades, `slot-latent` models, `slot-model` studio/posts, `slot-mask` achievements, `slot-vae` power), header row with an uppercase 11 px tracking-wide label like ComfyUI node titles.
- Rounded-square DNA: icon wells, avatars, tiles use `rounded-[0.354em]`-style proportional radii (logo corner ratio).
- Colour roles: credits (numbers, prices, floating +N, rain) = `text-credits` amber only; energy/CTA/selection/trending = `electric-400`; structure/owned/real posts = `sapphire-700`; text `smoke-100/600/800`; locked/unaffordable = `slot-vae` at 70 %.
- Type: Inter (`font-inter`), numbers `tabular-nums font-extrabold tracking-tight`, labels `uppercase text-[11px] tracking-[0.08em] font-semibold`.
- Juice via Motion: springs for press/scale, `AnimatePresence` for toasts/cards, `useSpring`-driven odometer for the big counter, layout animations for store rows. Respect `prefers-reduced-motion` and the `settings.reducedMotion` flag.
- Kokonut candidates: particle/shimmer button for the hero CTA, animated number ticker for the counter, bento/card shells, animated tabs, text shimmer for headings, toast/notification card, background beams/grid for the hero column. Use them where they save time; otherwise plain Tailwind + Motion.

## Layout (desktop ≥ 1280; stacks below 1024)
```
Header (64px): [Comfy logo 32] Comfy Clicker | ◆ 12,480 credits  +47.2/s  ⚡ 640/650 W  ⚇ 3 signups  🔥 day 4 | Map · Hub · Board · Contracts | account · settings
Ticker (32px): "COMFY WIRE" pill + marquee of real posts and in-game news lines
Grid: minmax(320px,1fr) | minmax(0,2fr) | minmax(300px,1fr), gap 16px, padding 16px, min-h 0 so columns scroll internally
LEFT   HeroPanel (logo button 260–300px, aura, ripple, floating +N, click combo, click value line), FlagshipRig (best owned unit art, VRAM, "can run: SDXL, Flux (FP8)"), PowerMeter (draw/budget bar, throttle warning + buy PSU shortcut), QueueMini (running jobs), DailyStreak chip
CENTER Tabs: Studio | Feed | Contracts (default Studio when a model is available)
         RackPanel (owned hardware rows: art, name, count, per-unit cps, shelf of mini icons; family grouping) — collapsible, max-h 40vh
         StudioPanel: model chips (owned/lockable with reason; quantize button), precision toggle (native/fp8/q4 with EV hint), prompt textarea + PromptChips, HashtagPicker (≤3; trending highlighted with weight; "spam" warning at 3 trending), cost/ETA line ("1,240 credits · 12 s of income · 8 s on RTX 4090"), Generate post button, QueueList (ComfyUI-style striped progress bars with model vendor icon)
         TrendingStrip: "Trending this week" 3 chips + countdown ring + "(AI weeks are 10 minutes)"
         FeedPanel: PostCard (thumb via Art, caption=prompt, hashtags, LikesCounter beating heart, "+◆ N" ring, breakdown "1,240 likes × 3.2 = 3,968", BLEW UP ribbon, FLOP tag, Q4 chip, upscale button), RealPostCard (initials/logo avatar, name, platform chip, text, likes, link-out; sapphire stripe), interleaved 1 real per 3 player posts
RIGHT  StorePanel tabs: Hardware (family sub-tabs as chips: CPU/Apple/NVIDIA/AMD/Workstation/Datacenter/Cloud/Regions; BuyAmount 1/10/100/Max; rows: art well, name, price with credits icon, +cps, payback, owned count; affordable/unaffordable/locked states; save-for bar "Next: RTX 4090 in 0:48"), Upgrades (grouped by category; unlocked-but-unaffordable dimmed; tooltip), Models (cards with vendor icon, kind badge, VRAM bar vs best card, lock reason, setup fee, quantize FP8/Q4 with fee), Power (PSU/cooling rows + meter)
Overlays: AchievementToast queue (bottom-right), EventBanner (top-center: Model Drop, Node Broke [click to fix], Spot Reclaimed, Power Surge, Cloud Promo), TrendingSpark (floating clickable # badge for 8 s), WelcomeBackModal (offline report), DailyModal (7-day calendar), RebrandModal, SettingsModal (save/export/import/reset, sfx, particles, reduced motion, projector), StatsModal, AuthSheet (later), FxCanvas (full-screen, pointer-events none)
Routes: `/` game, `/map` (The Graph), `/hub` (ComfyHub), `/leaderboard`, `/auth/*` — Map/Hub/Leaderboard are pages that keep the game store alive (store is a module singleton; `useGameLifecycle` in the root layout's client provider).
```

## FX layer (`src/components/fx/FxCanvas.tsx`)
One `<canvas>` sized to the viewport (devicePixelRatio aware), plain arrays: floating numbers (text, x, y, vy, ttl, colour), diamond particles (credits icon pre-rasterised to an offscreen canvas at 12 px amber), credit rain (density = clamp(log10(cps) × 8, 0, 60) sprites falling behind the UI at 25 % opacity, confined to the left column), confetti (120 particles, electric/sapphire/white/pink) on `postResolved viral`, screen flash on `achievement`/`milestone`. Subscribes with `useGameEvents`; caps 300 live particles; pauses when `document.hidden`; disabled by `settings.particles=false` or reduced motion.

## Hero button (`src/components/hero/GenerateButton.tsx`)
The Comfy logo (`/brand/comfy-logo.svg`) 260 px inside a 300 px rounded square with an animated conic aura behind (rotation speed ∝ log10(cps)); pointerdown → spring scale 0.94 → 1.04 → 1; ripple ring in electric; each click: `store.click()`, spawn floating `+{formatNum(value)}` at the pointer, 3–6 diamond particles; hold-to-repeat is NOT allowed (one click = one event), keyboard Space triggers a click when focus is not in an input. Under it: a Run-style pill "Generate" and a rotating flavor line (`CLICK_LINES`), and combo counter (clicks with ≤ 400 ms gaps; milestones at 10/25/50 show "combo ×N").

## Performance rules
- Selectors return primitives; heavy lists memoise rows by id; use `content-visibility: auto` on long lists; feed capped at 60 cards; `React.memo` on row components; never map over `state.posts` inside the 20 Hz counter component.
- Motion: prefer `transform`/`opacity`; no layout animations on lists longer than 20 rows.
- Images: `next/image` with fixed sizes; art fallbacks are CSS tiles (brand-blue rounded square + glyph) rendered by `src/components/common/Art.tsx` reading `src/data/assetManifest.ts` (`ASSETS[id] = { file, alt, fallback: { glyph | vendor | emoji } }`); missing files fall back on `onError`.
- No `Date.now()` in render; times come from store snapshots or `useNow(250ms)` hook for countdowns.

## Accessibility
Buttons have labels; store rows are buttons with `aria-disabled` when unaffordable and a `title` tooltip; toasts use `role="status"`; colour is never the only signal (icons/text for locked/affordable); focus rings in electric.

## Copy
Use `src/data/flavor.ts` for all rotating text. Prices always with the credits icon. Numbers via `formatNum`/`formatCps`/`formatDuration`.

## Kokonut UI components installed (src/components/kokonutui)
particle-button (hero CTA pill), attract-button (store buy buttons on hover), hold-button (Rebrand / hard reset confirmations), shimmer-text (section headings, "BLEW UP"), glitch-text (Spaghetti Mode easter egg), smooth-tab (Studio/Feed/Contracts and store tabs), beams-background (hero column backdrop, low opacity), tweet-card (real X posts in the feed), spotlight-cards / liquid-glass-card (model cards, flagship rig), loader (queue progress), type-writer (ticker + click flavor line), matrix-text (rickroll/hidden node reveal), smooth-drawer (mobile panels), profile-dropdown (account menu), card-flip (achievement/model detail).
Registry install: `pnpm dlx shadcn@latest add https://kokonutui.com/r/<slug>.json` — other slugs: gradient-button, dynamic-text, swoosh-text, sliced-text, scroll-text, bento-grid, card-stack, carousel-cards, toolbar, morphic-navbar, mouse-effect-card, currency-transfer, apple-activity-card, avatar-picker, action-search-bar, ai-prompt, ai-loading, flow-field, background-paths, shape-hero.
