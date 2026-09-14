# Comfy Clicker: how it works

An end-to-end explainer of the codebase for the project owner. Every number, path and table name below is taken from the files as they are today; where a value lives in a constant or a data row, the current value is quoted. Paths are relative to the repository root.

## 1. What the game is

Comfy Clicker is an incremental ("idle") game skinned as the life of a ComfyUI creator. The single currency is **credits**. You earn them three ways:

- **Clicking Generate** (the Comfy logo on the left). One click is one `store.click()` and pays `derived.clickValue`, which starts at 1.
- **Owning hardware.** Every rig in `src/data/hardware.ts` has a `baseCps`; the rack's credits-per-second (`derived.cps`) accrues every 50 ms tick.
- **Posting.** In the Studio you pay a job cost to render a prompt with a real model (SD 1.5, FLUX, Wan 2.2, LTX-2…). The job runs on your best owned card, becomes a post in the feed, collects likes over 8 seconds, and every like pays credits back.

The fantasy is "you are a ComfyUI person with a GPU problem": you start on a 4c/8t office PC running SD 1.5 on `--cpu`, buy a used 3060, a 4090 with a sagging connector, an RTX PRO 6000, 8×H100 cloud nodes, then Comfy Cloud regions, an orbital datacenter and a Dyson swarm. Models are gated by **VRAM** (your best owned card must hold the weights, or you quantize to FP8/Q4), by **backend** (CPU boxes only run `cpuOk` models, Apple silicon only `mpsOk` images, AMD needs ROCm and sometimes ZLUDA), and API models need the API Nodes graph node and pay a 50 % surcharge. Every unit draws watts; exceed the power budget and the breaker trips, which stops every rig until the rack fits the circuit.

What makes it not Cookie Clicker:

- **Two coupled loops, one currency.** The rack is passive income; the Studio is an active, positive-EV bet whose expected return is fixed by design at roughly 1.23 × `payoutRatio` of the job cost (see §4). Reach (trending tags, audience, likes multipliers) moves *likes*, and likes move followers → Comfy Cloud signups → Research Points, which multiply everything. Credits never inflate through reach.
- **Real-world trending.** Three hashtags trend every in-game "week" (10 minutes). When the server can reach the real ComfyUI community (X, LinkedIn, Reddit, HN, blog, GitHub releases, the node registry, YouTube), the trio is derived from what people are actually posting; otherwise it is a deterministic function of the week index.
- **A skill tree drawn as a ComfyUI workflow** (The Graph, `/map`), a **prestige loop** called Rebrand that banks Comfy Points, and **ComfyHub** (`/hub`), where signed-in players publish workflow recipes that other players run for royalties and rep.
- **A player level derived from lifetime stats**, which gates the model list (SD 1.5 at level 1, FLUX.1 dev at 4, video at 5 and up, API models at 7 and up), and a **Latent Lounge** (a wheel and a coin flip) with printed odds tables, no cooldown and payouts that deliberately cannot touch XP or the leaderboard.
- **The engine is pure TypeScript with no React**, driven by a catalog of data tables, unit-tested (25 test files under `src/game/__tests__`, 48 across the repo) and paced by a simulator that the tests assert against.

## 2. Repository map

| Path | What lives there |
|---|---|
| `src/game/` | The engine: types, constants, tick, actions, derived stats, save/load, every formula. No React, no DOM. |
| `src/data/` | Balance data: hardware ladder, models, precisions, upgrades, map nodes, achievements, hashtags, contracts, events, flavor text, the asset manifest, `assetIndex.json`, the founder-post seed. May import only `@/game/types` and `@/game/constants`. |
| `src/state/` | The framework-agnostic `GameStore` singleton, React binding hooks, cloud-save sync, server-driven actions. |
| `src/components/` | All UI, by area: `layout`, `hero`, `store`, `studio`, `feed`, `rigs`, `map`, `hub`, `auth`, `overlays`, `fx`, `common`, `brand`, `kokonutui` (vendored Kokonut UI components), `ui` (shadcn base). |
| `src/app/` | Next.js App Router: `/` (`page.tsx` → `GameShell`), `/map`, `/hub`, `/leaderboard`, `/auth/callback`, `not-found.tsx`, and every `api/**/route.ts`. |
| `src/server/` | Server-only code: the live feed pipeline (`feed/`), Supabase clients and env (`supabase/`), ComfyHub (`hub.ts`), the leaderboard read model (`leaderboard.ts`). |
| `src/audio/` | `sfxMap.ts` (pure: names, the event-to-cue switch, the click limiter, the synth recipes) and `sfxEngine.ts` (the only file that touches an `AudioContext`). |
| `src/hooks/` | `useHotkeys`, `useEasterEggs`, `useNow`, `useSfx`. |
| `src/lib/` | Framework-free helpers the UI shares: `input.ts` (trusted events), `gifts.ts` (who gets a welcome gift), `handle.ts` (the username rules, shared with the SQL migration), `utils.ts` (`cn`). |
| `src/proxy.ts` | Next 16's middleware. Refreshes the Supabase session cookie on every request that carries one. |
| `src/assets/brand/` | SVGs copied from ComfyUI_frontend (logo, credits icon, vendor and node icons) via `scripts/copy-brand-assets.sh`. |
| `public/brand/`, `public/art/`, `public/fonts/`, `public/sfx/` | Served brand SVGs, generated art (webp/mp4), Inter, and the 18 sound effects (mono MP3, 276 KB in total). |
| `scripts/` | `balance.ts` (pacing simulator), `art-prompts.ts`, `art-collect.mjs`, `art-postprocess.mjs`, `check-assets.ts`, `backdate-commit.mjs`, `copy-brand-assets.sh`. |
| `supabase/migrations/` | `0001_init.sql`, `0002_feed_cron.sql`, `0003_hub_integrity.sql`, `0004_profiles.sql`, `0005_hardening.sql`; `supabase/config.md` documents applying them. |
| `docs/` | `UI-SPEC.md`, `DEPLOY.md`, this file. |
| `art-src/`, `.tmp/` | Raw MCP art outputs and session scratch; both are gitignored and Vercel-ignored (`.vercelignore`). |

### The three contracts

- `src/game/CONTRACT.md` is the engine contract: the module list, every exported function's signature and semantics, the effect-folding conventions and the required tests. It states the two documented exceptions to "data enters through a `Catalog` argument" (`save.ts` defaults to `CATALOG`, the RP/CP helpers in `map.ts` default to `MAP_NODES`) and the two documented exceptions to the engine's own behaviour, both of which read as bugs to anyone who has not been told: a click refused by the auto-clicker guard returns a `clickBlocked` *event* where every other validation failure returns a silent error, and a Lounge payout moves `state.credits` only.
- `docs/UI-SPEC.md` is the UI contract: state access (`useGame(selector, equals?)`, `useGameShallow`, `useGameStore`, `useGameLifecycle`, `useGameEvents`), the visual language (ComfyUI palette, slot-colour stripes, rounded-square radius 0.354), the three-column layout, the FX layer, performance rules and the Kokonut component list.
- `docs/DEPLOY.md` is the ops contract: Vercel env vars, Supabase auth settings, the smoke test.

### How balance is separated from logic

`src/data/index.ts` assembles a `Catalog` (`hardware, models, precisions, upgrades, mapNodes, achievements, hashtags, contracts, events, gamble`). Every engine function takes the catalog as an argument (`buildIndex(catalog)` in `src/game/catalog.ts` memoises id maps per catalog object in a `WeakMap`), so tests pass tiny fixtures via `createCatalog({...})`. The boundary is enforced by `src/game/__tests__/data-boundaries.test.ts`, which scans imports in both directions.

## 3. The engine

### GameState (`src/game/types.ts`, initial values in `src/game/state.ts`)

| Field | Meaning |
|---|---|
| `v` | Save version (`SAVE_VERSION = 1`). |
| `meta` | `createdAt, lastTickAt, lastSavedAt, playedSec, guestId, season`. `lastTickAt` is what offline settlement measures from. |
| `credits`, `lifetimeCredits`, `seasonCredits` | Bank, all-time, this season. `addCredits` in `engine.ts` moves all three. |
| `totalClicks` | Lifetime Generate clicks. |
| `hardware` | `Record<id, count>`; starts `{ 'pc-4c8t': 1 }`. |
| `hardwareTiers` | Tier upgrades reached per hardware id (0..4). |
| `upgrades` | Owned named upgrade ids. |
| `models` | `Record<id, { precisions: Precision[]; setup: boolean }>`; starts with `sd15` native, set up. |
| `loras` | Hashtag ids with a trained LoRA. |
| `mapNodes`, `achievements` | Unlocked node ids, earned achievement ids. |
| `posts`, `queue` | Feed posts (capped at `MAX_POSTS = 60`) and Studio jobs (capped at `MAX_QUEUE = 8`). |
| `followers`, `followersFrac`, `lifetimeFollowers`, `lifetimeLikes`, `signups` | Social counters; `followersFrac` banks fractional followers. |
| `rp`, `cp`, `cpSpent`, `hubRep` | Research Points, Comfy Points, CP locked into map nodes, ComfyHub reputation. |
| `contracts` | `{ active: ActiveContract[]; nextRotateAt }`. |
| `events` | `{ active: ActiveEvent[]; nextAt }`; first event waits `EVENT_MIN_GAP_MS` (3 min). |
| `daily` | `{ lastClaimDay, streak, claimed[] }` (last 7 day keys kept). |
| `gamble` | The Lounge: `{ freeSpinDay, winStreak, dryStreak, coinStreak, pot }`. No timestamps: there is no cooldown, the house edge does the work. |
| `citizens` | `{ drops, feed }`: the workflows you have published and the runs citizens have taken on them. |
| `stats` | posts, videos, flops, virals, quantizations, offlineClaims, rebrands, contractsDone, hubPublished, hubRuns, lorasTrained, bestPostLikes, lastPrompt, lastPostKey, bestCps, clicksWindow, plus eleven newer counters: `levelSeen` (the level watermark), `ratioed`, `dislikes`, `spins`, `flips`, `spinNet`, `clickLockUntil`, `clickStrikes`, `clickStrikeAt`, `luckyClicks`, `landedStreak`, `bestLandedStreak`. |
| `settings` | `sfx, particles, reducedMotion, projector, autosave` (all booleans; `sfx`, `particles` and `autosave` default on). |
| `flags` | Discovery flags (`konami`, `spaghetti`, `speedrun`, `sparkNext`…), plus three that are bookkeeping rather than discoveries: `tutorial-done`, `gift:founder` / `gift:sonam` and their `:declined` twins. |
| `weekOverride` | Pin the trending week for demos; `null` = live. |
| `liveTrending` | `{ tags, fetchedAt }` pushed by the feed client; trusted for `LIVE_TRENDING_TTL_MS` (30 min). |

### Derived (`src/game/derived.ts`)

Recomputed only when something structural changes, never per tick. `activeEffects` gathers `Effect`s from owned upgrades, reached hardware tiers (virtual `tier:<hw>:<n>` upgrades, each `rigMult ×2`), unlocked map nodes and running events, then folds them:

- `rawCps = Σ count × baseCps × rigMult[id] × familyMult[family]`
- `cpMult = 1 + CP_MULT_PER_POINT (0.02) × cp × Π cpMult effects`
- `globalMult = Π(1 + globalMult) × (1 + RP_MULT_PER_POINT (0.01) × rp) × (1 + ACHIEVEMENT_MULT (0.01) × achievements) × cpMult`
- `cps = rawCps × globalMult × throttleMult(powerDraw, powerBudget)` (that last factor is 1 or 0: past the breaker the rack is off)
- `clickValue = (1 + clickFlat) × Π clickMult × globalMult + clickCpsPct × cps`
- `bestVram`, `bestTier`, `bestHardwareId` (highest `speedScore`, ties → VRAM → price), `hasGpu`
- `concurrency = 1 + Σ`, `speedMult = Π`, `likesMult = Π`, `payoutBonus = Σ payoutRatio`, `followRate = 0.05 × Π`, `viralChance = 0.05 + Σ`, `flopChance = max(0.02, 0.15 − Σ)`, `offlineCapHours = 8 + Σ`, `offlineEfficiency = max(0.5, effects)`, `weekSpeed = Π`
- flags `zluda, apiNodes, hashtagResearch, streakGrace, reservedCapacity`; `unlockedFamilies` (everything except `amd-consumer`, which needs an `unlockFamily` effect); `tagLikes` (LoRAs add `LORA_TAG_LIKES = 0.25` on their tag), `familyGenTime`, `coolingTier`.

### The loop (`src/game/loop.ts`)

`startLoop({ tick, render, onLongGap })` runs on `requestAnimationFrame`, accumulates wall-clock time and drains it in fixed `STEP_S = 0.05` s slices (20 Hz), stamping each step with the wall time at which it ends. A frame gap above `MAX_CATCHUP_S = 5` s is not simulated; it is handed to `onLongGap`, and the store answers with `applyOffline`. The next frame is requested in a `finally`, so a throwing listener cannot stop income. Outside a browser `startLoop` is a no-op.

### A tick (`src/game/engine.ts`)

`tick(state, derived, catalog, dtSec, now, rng)` does, in order: (1) `addCredits(cps × dt)` and `playedSec += dt`; (2) `advanceQueue` (finish due jobs into posts, start pending ones up to `concurrency`) then `settlePosts` (pay newly arrived likes, grant completed posts); (3) `runCitizens` (at most one run per published workflow); (4) `expireEvents`, `maybeStartEvent`; (5) `progressContracts` on this tick's events and `rotateContracts` when `contractsDue`; (6) `checkAchievements` then `settleLevelUps` once per whole played second; (7) trending-week rollover detection → `weekRollover`; (8) power-of-ten cps milestones → `milestone`; (9) breaker flip → `powerThrottle`; then `lastTickAt = now`. Per-state bookkeeping (last week, last throttle flag) lives in a `WeakMap`, not the save. `DERIVED_EVENT_TYPES` (`purchase, upgrade, mapUnlock, achievement, eventStart, eventEnd, signup, rebrand, daily`) tells the store when to recompute `Derived`; `GameStore.tick` uses `needsDerived(events)`.

### Actions and `ActionContext` (`src/game/actions.ts`)

Every action is `(ctx: ActionContext, ...args) => ActionResult` with `ctx = { state, derived, catalog, now, rng }` and `ActionResult = { events, dirty, error? }`. Validation failures return `{ events: [], dirty: false, error }` and leave the state untouched; `dirty` makes the store recompute `Derived`. `GameStore.run(fn)` snapshots one context per call so `now` and `rng` are consistent inside an action. The actions: `click`, `buyHardware(id, 1|10|100|'max')`, `buyUpgrade`, `unlockMapNode`, `quantize`, `setupModel`, `trainLora`, `queueJob`, `claimContract`, `claimDaily`, `spin(wager | 'free')`, `flip(wager)`, `rebrand`, `resolveEvent`, `toggleSetting`, `setFlag` (UI discovery flags, idempotent, emits `easterEgg`, and runs `checkAchievements` on the spot so an egg, its achievement and that achievement's credits land on the same click), `upscalePost`, `grantGift(kind)`, `declineGift(kind)`, `completeTutorial`. Server-driven actions (`claimDailyFromServer`, `markDailyClaimed`, `recordHubPublish`, `applyHubRoyalties`) follow the same contract from `src/state/cloudActions.ts`.

`click` is the one deliberate hole in "validation failures emit nothing": a click the auto-clicker guard refuses returns a single `clickBlocked` event and no error, because the Generate button has to be able to say why it went quiet. It still moves nothing at all, not even `totalClicks`.

### Events emitted to the UI

`GameEvent` (types.ts): `click{value,lucky?}, purchase, upgrade, mapUnlock, jobStarted, postCreated, postResolved{viral,flop,ratioed}, achievement{id,reward}, offline{gain,elapsedSec}, contractDone, eventStart, eventEnd, daily{day,credits}, rebrand{cp}, powerThrottle{on}, signup{total}, weekRollover{tags}, easterEgg{id}, milestone{cps}, levelUp{level,credits,unlocked}, clickBlocked{reason,until}, spin{outcome,mult,wager,payout,free,hot}, flip{side,wager,payout,streak}, citizenRun{handle,workflowName,credits}, reward{id,credits}`. The store fans them out through `onEvent`; React consumes them with `useGameEvents`. Three consumers switch over the whole union: `FxCanvas`, `AchievementToast` and `src/audio/sfxMap.ts`, and the last one has a `never` default, so adding a member fails the build until someone decides what it sounds like.

### Save format, migrations, export (`src/game/save.ts`)

`serialize` is `JSON.stringify({...state, v: SAVE_VERSION})`, stored under `SAVE_KEY = 'comfy-clicker:save'`. `loadSave(raw, now, guestId)` runs `MIGRATIONS[n]` up to `SAVE_VERSION` (only `0 → 1`, which stamps `v`), validates with a forgiving Zod `saveSchema` (unknown keys stripped, invalid fields fall back to fresh-state values, arrays and records drop only broken entries), then `hydrate` drops ids the catalog no longer knows, normalises jobs, pulls timestamps from a clock that ran ahead back to `now`, and guarantees the starter PC and SD 1.5. Only an unparseable blob is corrupt; the store stashes it under `SAVE_CORRUPT_KEY` (`comfy-clicker:save.corrupt`). Export codes are `'CC1|' + base64(utf8 json)` (`exportString`/`importString`, which also accepts raw JSON).

Every field added since launch carries a schema fallback, so a blob written before it still loads: the eleven new `stats` counters, `settings.autosave` (true), the whole `gamble` block, and on a post `ratioed`, `mismatchedTags`, `nearViral` and a signed `followersGained`. Three hydrate rules are worth knowing. A save with no `stats.levelSeen` is stamped with `playerLevel(state)`, so a veteran gets the level their stats already earned with no back-pay and no toast storm. A `gamble.nextSpinAt` or `stats.clickLockUntil` written by a clock that ran ahead is clamped to one full period from `now`, so neither can outlast its own rules.

**When the save is written** (`src/state/autosave.ts`, pure and timer-free). The 20 Hz loop asks `autosaveDue(now, lastSaveAt, dirtyAt, settings.autosave)` on every step and it answers with a reason or nothing: `action` when a state-changing action left the save dirty and it has been quiet for `SAVE_DEBOUNCE_MS = 1 500` ms (ten purchases in a second are one write), else `interval` when `AUTOSAVE_MS = 10 000` ms have passed. `click` and `resolveEvent` are the two actions that fire many times a second, so they never schedule an action write; the interval covers them. `manual` (the S key, Save now), `hide` (`visibilitychange`/`pagehide`) and `import` are asked for directly, and the hide write ignores `settings.autosave` entirely: losing a session because a setting was off is not a trade anybody wants. A write the browser refuses sets `store.saveError` instead of being swallowed.

### Offline progress (`src/game/offline.ts`)

`applyOffline` runs on `start()` and on every long gap. `elapsed = (now − lastTickAt)/1000`. If `elapsed ≤ SHORT_GAP_S` (300 s) the gain is `cps × elapsed` at full rate with no report (the short-gap rule: a tab switch never shows the welcome-back card). Otherwise `paidSec = min(elapsed, offlineCapHours × 3600)` and `gain = cps × paidSec × offlineEfficiency` (base cap 8 h, base efficiency 0.5; `Comfy Cloud: Always On` raises efficiency to 1 and the cap by 8 h; map nodes push the cap to 48 h). Then `replayQueue` finishes jobs at their real end times with a deterministic RNG seeded from `guestId|lastTickAt|now`, `settlePosts` pays them out, `progressContracts` credits them, `offlineClaims` increments when `elapsed ≥ 60`, a `weekRollover` is announced once if the week changed, `primeTickMemo` keeps the next tick quiet about it, then `checkAchievements` and `settleLevelUps` run. `applyOffline` never touches `state.gamble` or `state.citizens`, so eight hours away leave one due citizen run rather than a backlog of a thousand.

**The welcome-back card follows the engine, not a second threshold.** `applyOffline` emits an `offline` event only past `SHORT_GAP_S`, and the store shows the modal for any such event with `gain > 0` (`offlineReportOf` in `store.ts`). The old rule, its own `elapsedSec ≥ 60` check in the store, reported gaps between 60 and 300 seconds: those are silent full-rate catch-ups, so the card was telling the player they had earned at 50 % up to an 8 h cap when they had in fact been paid 100 % with no cap.

## 4. The economy, with the real numbers

### Click value

Base 1 credit. `src/data/upgrades.ts` click category: Better Prompts +1 flat (100 credits, after 10 clicks), Batch Size 2/4/8 each ×2 (1 000 / 10 000 / 100 000 credits at 300 / 1 500 / 5 000 clicks), Comfy Desktop +1 % of cps per click and +4 h offline cap (100 000, 3 000 clicks), Ctrl+Enter +2 % (1 000 000, 10 000 clicks), Queue Front +4 % (10 000 000, 20 000 clicks). Graph: `core-readme` and `core-paste` ×1.25 each, `core-templates` and `core-linear` +1 % cps each, `prestige-muscle-memory` ×2. A click also shaves `CLICK_JOB_BONUS_MS = 150` ms off the earliest running job, up to `CLICK_JOB_BONUS_CAP = 0.5` of its duration. One click in 200 (`LUCKY_CLICK_CHANCE = 0.005`) is a lucky seed and pays `LUCKY_CLICK_MULT = 10` times over, tagging its `click` event `lucky` and raising the `luckySeed` flag behind the visible achievement "Lucky Seed"; the roll happens on accepted clicks only, so a click the guard refuses can never burn it. The simulator prices the lucky seed in, so the pacing tests stay honest.

### The auto-clicker guard (`src/game/clickGuard.ts`, `src/lib/input.ts`)

Three layers, cheapest first, and none of them ever stops the rack: hardware income is untouched, nothing is permanent, and the copy is a joke rather than an accusation.

1. **The UI drops untrusted events.** `trustedInput(e)` in `src/lib/input.ts` is `e.isTrusted === true`, which is false for anything `dispatchEvent` produced: the console one-liners and the browser-extension clickers die here. `GenerateButton`'s pointer and key handlers and `useHotkeys` all gate on it. (jsdom events are all untrusted, so component tests call `overrideTrust(true)` in setup.)
2. **A hard rate cap**, `CLICK_CAP_PER_SEC = 15` accepted clicks over a trailing second. A refused click pays nothing, does not bump `totalClicks`, does not shave job time and emits no `click` event. It is explicitly **not** a strike: a burst is not cheating, it just does not count.
3. **A cadence check.** Over the last `CADENCE_INTERVALS = 24` *attempted* intervals (25 timestamps), a strike lands when `mean < CADENCE_MAX_MEAN_MS = 200` **and** `cv = stddev / mean < CADENCE_MAX_CV = 0.05`. Fast plus regular is the only combination that trips: a human hand at 5/s sits at a coefficient of variation of 0.15 to 0.35 and a timer-driven tool sits under 0.02, and slow regularity is allowed outright, so a patient human tapping a flat 3/s is never touched. Attempted means every call, including the ones the cap refused, so a 25/s tool cannot hide under the cap by having two thirds of its clicks thrown away.

A strike escalates the lockout through `CLICK_LOCKOUT_MS = [10 s, 30 s, 60 s]` (capped at `CLICK_LOCKOUT_MAX_MS = 60 s`), raises `flags.clickGuard` behind the hidden achievement "Suspiciously Regular", and empties the ring so the player gets a fresh 24 intervals to be human in. Strikes decay after `CLICK_STRIKE_DECAY_MS = 5 min` without a new one. The ring of attempted timestamps lives in a `WeakMap` side table (the same pattern as the tick memo, because it is session bookkeeping); the lockout itself is persisted in `stats.clickLockUntil / clickStrikes / clickStrikeAt`, so a reload does not wash it away. The "Batch Size: Yes" egg (100 clicks in 10 s) stays reachable: 10/s with human jitter trips nothing, and a test pins it.

While a lockout runs, the Generate pill reads `Paused · 0:07` off `stats.clickLockUntil`, the logo greys out, and `clickBlocked` suppresses every piece of click feedback (no float, no burst, no ripple, no squash) so a refused click is silent rather than misleading.

### The hardware ladder (`src/data/hardware.ts`)

38 units ordered by `baseCost`; the index is the payback rank and `baseCps = round3(baseCost / payback)`. Design payback:

```
rank ≤ 14 : payback = 125 − 4.5·rank                       (125 s → 62 s)
14 < rank ≤ 19 : payback = 40 + (62 − 40) × 0.9^(rank − 14)   (→ 53 s at the RTX PRO 6000)
rank > 19 : geometric interpolation across the family band TAIL_PAYBACK_S
            datacenter [60 s, 240 s], cloud-node [300 s, 4 h], region [12 h, 48 h]
PAYBACK_OVERRIDE_S: orbital-dc 120 h, dyson-swarm 240 h
```

Vendor multipliers on payback: consumer Radeons ×`AMD_PAYBACK_MULT = 0.92` (cheaper per cps, but gated behind the ROCm Setup upgrade and taxed ×1.25 on gen time); Apple ×`MPS_PAYBACK_MULT = 1.3`; MI-series datacenter parts get no discount. Per-unit growth by family (`FAMILY_GROWTH`): cpu 1.15, apple 1.15, nvidia-consumer 1.12, amd-consumer 1.12, workstation 1.11, datacenter/cloud-node/region 1.15. `unitCost = ceil(baseCost × growth^owned)` after stripping 1e-9 float noise (`src/game/economy.ts`). Representative rungs (computed from the shipped data):

| Unit | Rank | Cost | cps | Payback | W | Tier | VRAM |
|---|---|---|---|---|---|---|---|
| `pc-4c8t` | 0 | 15 | 0.12 | 125 s | 65 | 1 | 8 |
| `rtx-3060` | 4 | 350 | 3.271 | 107 s | 170 | 3 | 12 |
| `rtx-4090` | 9 | 1 800 | 21.302 | 84.5 s | 450 | 5 | 24 |
| `rtx-5090` | 12 | 9 000 | 126.761 | 71 s | 575 | 6 | 32 |
| `rtx-pro-6000` | 19 | 45 000 | 849.204 | 53 s | 600 | 7 | 96 |
| `h100-80` | 22 | 150 000 | 1 574.901 | 95 s | 700 | 9 | 80 |
| `aws-p5` (8×H100) | 29 | 12 000 000 | 8 502.83 | 23.5 min | 5 600 | 10 | 80 |
| `runpod-8xb300` | 32 | 4×10⁸ | 27 777.778 | 4 h | 11 200 | 11 | 288 |
| `region-us-east` | 33 | 2×10¹⁰ | 462 962.963 | 12 h | 250 000 | 12 | ∞ |
| `dyson-swarm` | 37 | 3×10¹⁴ | 3.47×10⁸ | 240 h | 0 | 12 | ∞ |

Families and their store tabs (`HARDWARE_FAMILIES`): CPU, Apple, NVIDIA, AMD, Workstation, Datacenter, Cloud Nodes, Regions. Unlock chains are `ownHardware` conditions (3060 needs the 8c/16t; 4090 needs a 4070 Ti Super or a 3090; the L4 deliberately needs the A6000 so a payback-greedy climber takes the workstation on-ramp and reaches the 96 GB PRO 6000). Regions carry `max: 1` and gate on map nodes: `region-us-east` on `regions-unlock`, the next two on the previous region, `orbital-dc` on `orbital-unlock`, `dyson-swarm` on `dyson-unlock`. Cloud nodes have `cardsPerUnit: 8` (display only) and `azure-nd-mi300x` is `rocm`. Regions draw 250 kW each; the two space units draw 0 W.

**Tier upgrades** are virtual (`tier:<hardwareId>:<1..4>`, generated by `generateTierUpgrades`): thresholds `TIER_UPGRADE_THRESHOLDS = [5, 10, 25, 50]` owned, cost `baseCost × [10, 100, 1000, 10000]`, effect `rigMult ×2` each (×16 per unit at tier 4). Names rotate from `TIER_NAME_POOL` per family.

**VRAM gating = best owned unit.** `runsOn(model, precision, hw)` (`src/game/hardware.ts`) requires `backendAllows` (`src/game/quantize.ts`: `cpuOnly → model.cpuOk`; `mps → model.mpsOk && kind === 'image'`; `rocm → model.rocmOk || !model.needsZluda || derived.zluda`) and `hw.vram ≥ model.vram × precision.vramMult`. API models run anywhere once `derived.apiNodes` is true. `bestRunnable` is the owned unit with the shortest `genTimeMs` (so the MPS ×2 and ROCm ×1.25 taxes count). `setupFee` = `SETUP_FEE_MULT (1) × baseCost` when `model.vram > derived.bestVram`, else free. `lockReason` produces strings like `Needs 20 GB · your best card has 12 GB · quantize FP8 for 450 or buy an RTX 3090`.

**Generation time**: `base = clamp(baseTime × 1.3^(nativeTier − tier) [below] or × 0.85^(tier − nativeTier) [above], 3 s, 15 s)`, then `× precision.timeMult × speedMult × familyGenTime × (mps ? 2 : 1) × (rocm ? 1.25 : 1)`, where `tier = speedTier + coolingTier[family]` and `nativeTier` is the tier of the cheapest CUDA card that holds the native weights. API models skip the tier and backend terms.

### Power

`powerDraw = Σ count × watts`; `powerBudget = POWER_BUDGET_BASE (650 W) + Σ powerBudget effects`; `throttleMult = draw > budget ? 0 : 1` (`src/game/power.ts`): the breaker is a cliff, so past it every rig that needs watts stops and passive income is zero until the draw fits again. Clicking still pays, which is the way back out of a breaker tripped by one card too many. Budget comes from the six power upgrades (850 W PSU +300 W for 200 credits up to Fusion Reactor +200 MW for 30 000 000) and the Graph's infra lane (Undervolt +200 W for 5 000 up to Orbital Solar +1 GW for 2e9, plus Antarctic Datacenter +1 MW). Cooling upgrades and nodes add `coolingTier` (+1 speed tier per family). The `powerSurge` event subtracts 40 % of the rig's own budget.

### Player level and XP (`src/game/level.ts`, weights and tables in `src/game/constants.ts`)

**XP is derived from lifetime stats and never stored.** The only saved field is `stats.levelSeen`, the watermark that makes a level-up reward idempotent across reloads and cloud merges. That is what lets an old save get the right level with no migration and no back-pay, and it is why nothing here can be farmed: credits are log-compressed, posts doubly so, and everything the formula reads survives a rebrand, so a prestige never demotes you.

```
xp = floor(150 × log10(1 + lifetimeCredits)) + floor(25 × log2(1 + stats.posts))
   + floor(20 × achievements.length)         + floor(10 × stats.contractsDone)
   + floor(6  × mapNodes.length)             + floor(15 × stats.quantizations)
   + floor(15 × stats.lorasTrained)          + floor(50 × stats.rebrands)
```

Credits are the backbone at 150 XP per decade; achievements are the completionist lane at 20 each. Each row is floored on its own, so `xpBreakdown` (which the Stats modal prints row by row) always adds up to `playerXp` exactly.

`LEVEL_XP` has `MAX_LEVEL = 30` entries, is strictly increasing and starts at 0. Levels 1 to 12 are hand-placed against the balance simulator; 13 to 30 add a flat `LEVEL_XP_TAIL_STEP = 400` each, so level 30 is 11 950 XP.

| L | XP | L | XP | L | XP |
|---|---|---|---|---|---|
| 1 | 0 | 5 | 2 050 | 9 | 3 500 |
| 2 | 500 | 6 | 2 450 | 10 | 3 850 |
| 3 | 900 | 7 | 2 800 | 11 | 4 200 |
| 4 | 1 550 | 8 | 3 150 | 12 | 4 550 |

Driving `simulate('climb', t)` from `scripts/balance.ts` through the real `checkAchievements` with one post a minute puts level 2 at about 2 minutes, level 3 at about 8, level 4 at about 25, level 5 inside the first hour and level 6 around four hours. That is a measurement of today's tables, not a pinned test: `pacing.test.ts` pins hardware arrivals, `level.test.ts` pins the curve's shape and the payout, and nothing pins the arrival times, so re-measure before quoting them.

Each level is worth `levelReward(level, cps) = max(100 × level, round(90 × cps))` credits, paid through the same three counters `addCredits` moves (so a level-up feeds the next level a little) and announced with one `levelUp` event per level in order. Crossing two thresholds on one tick is possible, because the reward itself raises lifetime credits; `settleLevelUps` loops until the watermark catches up, bounded by `MAX_LEVEL`. Nothing else is granted: no RP, no multiplier. Achievements already carry the permanent bonus, and a level that also multiplied income would make the XP formula self-feeding.

`LEVEL_TITLES` runs from 1 Fresh Install, 2 Queue Prompt, 3 Node Wrangler, 4 Guidance Scale, 5 Latent Explorer, 6 Sampler Sommelier, 7 VRAM Negotiator, 8 Custom Node Author, 9 Cluster Operator, 10 Region Owner, 11 Subgraph Architect, 12 Checkpoint Merger, through to 29 The Frontend Rewrite and 30 Honorary Maintainer. The titles live in `constants.ts` rather than `src/data/flavor.ts` because `level.ts` may import only types and constants: `state.ts` imports `playerLevel` for `statValue('level')`, so anything richer would be a cycle.

**What the level gates.** `ModelDef.minLevel` (default 1) is a plain field, not an `UnlockCond`, on purpose: a level-locked model has to stay visible in the store with its reason rather than vanish from the list. `lockReason` checks it before anything else and `setupModel` refuses with the identical string, `Needs level 4 · you are level 2`, which is what makes every model surface explain the gate the same way. `createJob` deliberately does **not** check, so a model that is already installed stays usable if the table moves under it.

| L | Models |
|---|---|
| 1 | `sd15` |
| 2 | `sdxl`, `stable-audio` |
| 3 | `sd35-medium`, `flux-schnell`, `ace-step` |
| 4 | `chroma`, `flux-dev`, `hunyuan3d-21` |
| 5 | `flux-kontext`, `wan22-5b` |
| 6 | `hidream`, `ltx2`, `trellis` |
| 7 | `qwen-image`, `qwen-image-edit`, `ideogram`, `recraft`, `grok-imagine` |
| 8 | `flux2`, `mochi`, `gpt-image`, `nano-banana`, `flux-pro` |
| 9 | `cosmos`, `wan22-14b`, `luma-ray`, `vidu`, `hailuo` |
| 10 | `hunyuan-video-15`, `kling`, `runway-gen4` |
| 11 | `veo`, `sora` |
| 12 | `minimax-h3` |

`models-data.test.ts` pins the shape rather than the table: every model has an integer `minLevel` in 1..12, `sd15` is 1, every level from 2 to 12 unlocks at least one model so no rung is dead, every API model is 7 or higher, every video model is 5 or higher, and `minLevel` never falls as VRAM rises inside a local kind.

The rest of the level is UI: a `LevelChip` in the header with a 3 px electric bar, a `LevelUpBanner` that merges two level-ups into `Level 4 to 6`, confetti plus an electric flash from `FxCanvas`, a first section in the Stats modal with the XP breakdown, and a `level-locked` state on `ModelCard` that beats `api-locked` and `needs-setup`.

### Models (`src/data/models.ts`)

35 models: 11 image, 7 video, 2 3D, 2 audio, 13 API. Fields: `vram`, `cpuOk/mpsOk/rocmOk/needsZluda/api`, `baseCost`, `costSecs`, `payoutRatio`, `baseLikes`, `baseTime`, `quantizable`, `thumbTags`. Job cost is `round(max(baseCost, costSecs × cps) × precision.costMult × (api ? API_COST_MULT (1.5) : 1))` (`src/game/studio.ts`). Representative rows:

| Model | Kind | VRAM | baseCost | costSecs | payout | baseLikes | baseTime | Notes |
|---|---|---|---|---|---|---|---|---|
| `sd15` | image | 4 | 10 | 4 | 1.10 | 15 | 4 | cpuOk, mpsOk, rocmOk, preinstalled, not quantizable |
| `sdxl` | image | 8 | 16 | 4 | 1.11 | 20 | 5 | mpsOk, rocmOk |
| `flux-dev` | image | 20 | 170 | 5 | 1.15 | 90 | 8 | native rig RTX 3090; FP8 fee 450, Q4 300 |
| `flux2` | image | 40 | 2 800 | 6 | 1.18 | 550 | 10 | `needsZluda` on AMD |
| `wan22-5b` | video | 20 | 180 | 10 | 1.19 | 225 | 10 | rocmOk |
| `wan22-14b` | video | 56 | 7 200 | 12 | 1.21 | 2 500 | 13 | native rig RTX PRO 6000 |
| `minimax-h3` | video | 160 | 20 000 | 20 | 1.22 | 4 500 | 14 | needsZluda; native rig B200 |
| `hunyuan3d-21` | 3d | 16 | 70 | 6 | 1.16 | 50 | 9 | |
| `ace-step` | audio | 12 | 40 | 5 | 1.16 | 37 | 7 | |
| `kling`, `veo`, `sora`… | API | 0 | 1 200–2 500 | 12 | 1.25 | 950–1 800 | 10/12 | `unlock: mapNode api-nodes`, not quantizable |

Only API models carry an `unlock`; local models are always listed and gated by the setup fee and hardware.

### Precision (`src/data/precisions.ts`)

| id | vramMult | qualityMult | costMult | timeMult | feeFraction |
|---|---|---|---|---|---|
| native | 1 | 1 | 1 | 1 | 0 |
| fp8 | 0.5 | 0.92 | 0.85 | 0.9 | 0.375 |
| q4 | 0.3 | 0.8 | 0.7 | 1.15 | 0.25 |

`quantFee = round(feeFraction × nativeHardware.baseCost)`; FP8 needs the `quant-fp8` Graph node (1 500 credits), Q4 needs `quant-q4` (15 000). The models-data test pins that `setupFee + quantFee(fp8) < nativeHardware.baseCost` for every quantizable model.

### The content roll (`src/game/virality.ts`)

- **M**: one draw `u = rng()` settles the viral band, so a roll that missed it by a hair is knowable instead of indistinguishable from an ordinary day. `u < viralChance` (base 0.05) → `uniform(3, 8)` viral; else `nearViral = u < NEAR_VIRAL_BAND (2) × viralChance` and then, with `flopChance` (base 0.15), `uniform(0.3, 0.6)` flop; else `uniform(0.85, 1.35)`. E[M] ≈ 1.23. `Post.nearViral` only puts an amber `ALMOST BLEW UP` tag on the card; it changes no number.
- **trend** = `trendMult(matched, trending, keywordHits, kind)` (`src/game/hashtags.ts`): matched trending tags hottest first get `1 + TRENDING_WEIGHTS[rank]` with weights `[1.0, 0.4]` (one match 2.0, two 2.4); more than `MAX_MATCHED_TRENDING = 2` matched → flat 1.0 (the spam rule); a trending type tag (`#videogen`, `#3dgen`, `#musicgen`) whose kind matches the post adds `TYPE_TAG_BONUS = 0.2` without using a slot; plus `EXTRA_KEYWORD_BONUS = 0.1` per distinct keyword hit up to `MAX_EXTRA_KEYWORDS = 3`. A repost (same model, matched tags and normalised prompt as the previous post, `repostKey`) multiplies trend by `REPOST_PENALTY = 0.5`.
- **audience** = `1 + log10(1 + followers / AUDIENCE_REF_DIVISOR (50))`; **tagBonus** = Π(1 + tagLikes[tag]) × (1 + `FAMILY_AFFINITY_BONUS` 0.1 when a matched tag's `family` equals the model family); **eventBoost** = ×3 during a founder repost and ×3 once for a caught spark; **founder** = ×3 with `FOUNDER_BOOST_CHANCE = 0.02` or, once per save, when the prompt name-drops `yoland*`, `robin`, `robinjhuang` or `comfyanonymous`; **hubMult** = `HUB_RUN_LIKES_BOOST = 1.15` for a job run from a ComfyHub recipe.
- **landed streak**: `stats.landedStreak` counts consecutive posts that neither flopped nor got ratioed, and multiplies `targetLikes` by `1 + min(LANDED_STREAK_MAX 0.25, LANDED_STREAK_STEP 0.025 × landedStreak)`. Likes only, so the EV bands below are exactly what they were. `stats.bestLandedStreak` keeps the record.
- `targetLikes = max(1, round(M × trend × quality × baseLikes × audience × likesMult × tagBonus × eventBoost × founder × hubMult × streakMult))`.
- **Credits follow the roll, not the reach**: `credits = (payoutRatio + payoutBonus) × paid × M × quality`, where `paid = job.cost / 1.5` for API models; `creditsPerLike = credits / targetLikes`, so the card's `likes × credits/like = credits` identity always holds. Untagged native EV/cost ≈ 1.23 × payoutRatio regardless of upgrades; the virality test pins EV bands of [1.05, 1.6] for local models and [0.95, 1.1] net of surcharge for API models over 20 k rolls.
- Likes arrive over `POST_WINDOW_MS = 8 000` ms as `likesAt = floor(targetLikes × (1 − (1 − p)³))`; `settlePosts` pays `(newLikes − likes) × creditsPerLike` per tick and, when complete, grants followers `targetLikes × followRate × (viral ? 3 : 1)`, updates stats, sets `granted` and emits `postResolved`. `upscalePost` costs 30 % of the post's original cost for +40 % likes at the same credits/like (refused on a ratio first, with its own reason, then on flops).

### Ratioed posts (`src/game/hashtags.ts`, `src/game/virality.ts`)

A post whose **explicit** type tag names a kind the model is not (`#videogen` on SD 1.5) gets ratioed: it collects dislikes instead of likes and the player pays for every one of them. Explicit is the load-bearing word. `matchTags` returns a third field, `explicit`, holding the literal `#tags` typed into the prompt plus the ids selected in the Studio, and keyword hits are deliberately excluded: "a cat in motion" matches the `videogen` keyword `motion`, and prose is not a claim about what the post is. `mismatchedTypeTags(explicit, kind, catalog)` returns the explicit ids whose `HashtagDef.kind` is set and differs, in catalog order.

A ratio settles the band before anything is drawn: `flop = true`, `M = uniform(0.3, 0.6)`, `trend = 1` flat (so the repost penalty is moot), no founder roll, no hub boost, and **no spark consumed**, so a caught spark and an unused founder name-drop survive for the next honest post. Then

```
targetLikes = max(1, round(RATIO_DISLIKE_MULT (3) × M × baseLikes × audience × likesMult))
credits     = RATIO_LOSS_MULT (1) × paid × M          // stored positive; the sign lives in post.ratioed
```

Audience and `likesMult` still apply, because a bigger account gets ratioed harder. `settlePosts` then runs the same 8-second clock with the sign flipped: each arriving dislike takes `creditsPerLike` out of the bank (floored at zero), `post.creditsPaid` accumulates the loss as a positive number so the card can render the minus, `stats.dislikes` climbs, and on completion followers *leave* (`removeFollowers(floor(targetLikes × followRate))`, so `post.followersGained` is negative), `stats.flops` and `stats.ratioed` both increment and `postResolved` carries `ratioed: true`. `lifetimeLikes`, `lifetimeCredits`, `seasonCredits`, `lifetimeFollowers` and `bestPostLikes` never move for a ratio: those feed XP, achievements and the leaderboard, and a ratio is not an accomplishment.

The damage is calibrated to sting without ending a run. An ordinary flop returns 30 to 60 % of the job cost; a ratio returns nothing and takes another 30 to 60 % on top, so the swing is 130 to 160 % of one job. `flags.ratioed` drives the hidden achievement "Workflow? (Derogatory)", and `upscalePost` refuses with `Nobody upscales a ratio · tag the kind you actually posted`.

The Studio warns and never blocks: mismatched chips in `HashtagPicker` read `wrong kind` in `slot-vae` with an inline `Remove`, the cost line says what the post is about to be worth, and the Generate button stays enabled. The `PostCard` gets a `RATIOED` ribbon, a dislike-mode counter, a `slot-vae` payout ring reading `-N`, a chip naming the offence (`#videogen on SD 1.5`) and a line from `RATIO_LINES`. The EV bands still hold, because a correctly typed tag pays exactly what an untagged post pays, and a test pins that.

### Followers, signups, RP (`src/game/social.ts`)

`addFollowers` banks fractions; each time `lifetimeFollowers` crosses `signupThreshold(k)` (`SIGNUP_THRESHOLDS = [0, 100, 250, 500, 1 000, 2 500, 5 000, 10 000, 25 000, 50 000, 100 000]`, then ×`SIGNUP_GROWTH = 2` per step), one Comfy Cloud signup happens and `rp += 1`. RP raises `globalMult` by 1 % per point forever; spending RP on the Graph never deducts it (`rpAvailable = rp − rpSpent(nodes)`).

### Contracts (`src/game/contracts.ts`, `src/data/contracts.ts`)

30 contracts across seven goal types (`posts` plain/by kind/by tag, `likes`, `followers`, `ownHardware`, `clicks`, `quantize`, `virals`). `CONTRACT_SLOTS = 3` stay filled by weighted pick among defs whose `minTier ≤ derived.bestTier` and that are not already active or already satisfied. Reward = `max(100, rewardSecs × cps)` at acceptance, plus optional `rewardRp`/`rewardCp`. An unfinished contract expires `CONTRACT_ROTATE_MS = 30 min` after acceptance; a done one waits to be claimed; a claim sets `nextRotateAt = 0` for an immediate refill; an unfillable slot retries after 60 s. Examples: "Wedding Slideshow" (5 posts, 300 s, tier 1), "Kontext Friday" (10 posts tagged `fluxkontext`, 720 s, tier 3), "Global Campaign" (2 000 000 likes, 3 600 s, +1 CP, tier 9).

### Random events (`src/game/events.ts`, `src/data/events.ts`)

One event rolls every `uniform(3, 8)` minutes, weighted among defs with `minTier ≤ bestTier` whose kind is not already running. Durations (`EVENT_DURATION_S`): modelDrop 300 s (`tagLikes +1.0` on a random subject tag), nodeBroke 120 s (`globalMult −0.5` until the player clicks Fix), founderRepost 60 s (×3 likes), spotReclaim 60 s (a cloud node's `rigMult` → 0 unless `reservedCapacity`), powerSurge 90 s (budget −40 %), trendingSpark 8 s (catch it → `flags.sparkNext` → ×3 likes on the next post), cloudPromo 77 s (`globalMult +1`). Ten defs, e.g. `ev-cloud-promo` weight 1 minTier 5, `ev-spot-reclaim` weight 2 minTier 8.

### Daily bonus (`src/game/daily.ts`)

UTC day keys. Streak continues if the last claim was yesterday (or two days ago with `streakGrace`), else restarts at 1. Day `n` of a 7-day cycle pays `max(DAILY_MIN_CREDITS (50), cps × DAILY_BASE_SECS (600) × n)`; day 3 adds 1 RP, day 7 adds 1 CP.

### The Latent Lounge (`src/game/gamble.ts`, `src/data/gamble.ts`)

Two tables behind a header tile, gated at `LOUNGE_MIN_LEVEL = 2`. **The wheel** is the KSampler spin: in `GAMBLE_OUTCOMES` the `weight` **is** the probability and the table sums to exactly 1, so `weightedPick` draws from it directly and the expected value is the plain weighted mean.

| id | label | mult | p | pays |
|---|---|---|---|---|
| `nan` | NaN latent | ×0 | 0.355 | 0 |
| `half` | Half denoised | ×0.5 | 0.300 | 0.150 |
| `same` | Same seed, same image | ×1 | 0.170 | 0.170 |
| `clean` | Clean sample | ×2 | 0.120 | 0.240 |
| `batch` | Batch of four | ×4 | 0.042 | 0.168 |
| `golden` | Golden seed | ×10 | 0.010 | 0.100 |
| `s42` | Seed 42 | ×42 | 0.003 | 0.126 |

**The coin** is one flip against the house: your side pays `COIN_PAYOUT = 2` and lands `COIN_WIN_CHANCE = 0.48` of the time, so it returns 0.96. Both numbers are printed next to the button, because the gap between them is the entire house edge.

`spinEv()` is therefore **0.954** and `coinEv()` **0.96**, and that is the point. There is no cooldown and no ceiling on a bet: any amount from `BET_MIN` (10 credits) up to the whole bank, as often as the player likes, with a slider and a number box that always show the same figure. What makes that safe is not a timer, it is the maths, and `gamble.test.ts` pins it by simulating 50 000 bets a table (pity reroll, hot sampler and the minted pot included) and insisting a credit put on either table comes back worth less than a credit. If a future table crosses 1, the Lounge has become an income source and the change is wrong.

On top of that: one free spin per UTC day with a house stake of `max(FREE_SPIN_MIN (200), round(FREE_SPIN_SECS (120) × cps))`, which deducts nothing. A pity meter, where `dryStreak` counts consecutive `nan` results and at `SPIN_PITY_DRY = 3` the next losing draw is converted once into the cheapest winning segment (the draw still happens, so the rng sequence is identical either way). A hot sampler, where `winStreak` counts consecutive ×2-or-better results and at `SPIN_HOT_STREAK = 3` the widget flips to `control_after_generate: fixed` and payouts carry `SPIN_HOT_MULT = 1.5` until anything under ×2 breaks it (a `nan`, a `half` or even a `same`). And a pot, fed `round(SPIN_POT_FRACTION (0.02) × bet)` by every paid bet on either table, which `s42` takes whole on top of its own payout.

**The documented exception**: a payout moves `state.credits` and nothing else. `lifetimeCredits` feeds XP and therefore the player level, and `seasonCredits` feeds prestige and the leaderboard, so crediting either here would turn the Lounge into an XP farm and let a lucky seed buy a rank. It is the one credit path in the engine that does not go through `addCredits`, it looks like a missing line, and a test pins that both counters stay put. A bet does not call `noteSpend` either: a bank that lands on zero because a seed ate the wager is not "Out Of Credits, Not Ideas".

Achievements: visible `seed-first` "Random Seed" and `seed-100` "Degenerate Sampler"; hidden `seed-42-hit` "It Was Always 42" (`jackpot42`), `seed-nan-3` "NaN, NaN, NaN" (`nanStreak3`), `seed-hot` "Control After Generate: Fixed" (`hotSeed`), `coin-five` "Call It In The Air" (`coinFive`). `LoungeModal` prints both odds tables above the fold and the footer never hides the edge; `FxCanvas` throws confetti at ×10 and up, and only the ×42 raises a toast, because everything smaller is already on the reel in front of you.

### Citizens (`src/game/citizens.ts`, `src/data/citizens.ts`)

Publishing a recipe to ComfyHub puts a *drop* on the citizens' board, and invented players start running it. Each run pays the author a royalty of `max(CITIZEN_ROYALTY_MIN (5), round(CITIZEN_ROYALTY_SECS (3) × cps × heat))` through `addCredits` (a royalty is income, so lifetime and season totals move exactly as they do for a real hub run), adds a run and a point of rep, and lands in an activity list with the handle that took it: `latent_goblin`, `vae_sommelier`, `q4_trucker`, invented from two word pools so no real account is ever borrowed.

A drop starts at `heat = 1` and cools: every run multiplies it by `CITIZEN_HEAT_DECAY = 0.94`, the gap to the next run is `uniform(12 s, 45 s) / heat`, and below `CITIZEN_COLD_HEAT = 0.15` or past `CITIZEN_TREND_MS = 45 min` it is cold for good. In practice that is about **31 runs worth 43 seconds of income over 43 minutes**, whatever the rig earns: a publish is a burst of attention, not an annuity. `runCitizens` takes at most one run per drop per tick, so a tab closed for eight hours comes back to one due run and never a backlog, and `CITIZEN_MAX_DROPS = 6` workflows are tracked at once (the coldest falls off the board first). `/hub` shows the board above the listing.

### Rebrand / prestige (`src/game/prestige.ts`)

Available once you own any `cloud-node` or `region`. `rebrandCp = floor((seasonCredits / 1e8) ^ 0.45)` (1e8 → 1 CP, 1e10 → 7, 1e12 → 63); `creditsForCp` inverts it. Each CP is +2 % income forever (`cpMult`, further multiplied by the five Season Income nodes ×1.1 each). **Resets**: credits, seasonCredits, hardware (back to the starter PC plus any `startHardware` effects: a 4090, a PRO 6000, an H100 from prestige nodes), hardwareTiers, credit-bought upgrades, models (SD 1.5 kept), queue, posts, followers and followersFrac, contracts, events, `lastPostKey`. **Kept**: achievements, every map node, rp, cp, cpSpent, loras, hubRep, daily, flags, lifetime followers/likes/signups, lifetime stats. `season += 1`, `stats.rebrands += 1`.

### Achievements (`src/data/achievements.ts`)

**103 achievements, 26 of them hidden**; each adds `ACHIEVEMENT_MULT = 0.01` to `globalMult`, and each is worth 20 XP. `checkAchievements` runs once per played second and cascades up to 4 passes so "Achievement Achieved" (25 achievements) lands in the same call. Conditions use the shared `UnlockCond` language (`stat`, `ownHardware`, `ownFamily`, `ownModel`, `precision`, `mapNode`, `upgrade`, `cps`, `flag`, `all`, `any`).

`AchievementDef.reward` is a one-off credit payout handed over the moment the row is granted, so an easter egg, its achievement and its credits all land on the same click. Four rows carry one today: `title-25` 1 000, `grand-tour` 500, `night-shift` 333, `ctrl-enter` 250. The payout moves the three credit counters inline rather than through `addCredits`, because importing it back would close a cycle; the `achievement` event carries the amount as `reward` (0 when there is none).

Twenty-five of the 26 hidden achievements are flag-driven; `level-20` "There Is No Level 21" is the exception and keys off the `level` stat. A hidden achievement renders as the literal text `???` in the Stats grid, with no icon, no lock glyph and neither its name nor its description anywhere in the DOM until it is owned; `describeUnlock` answers a `flag` condition with `Secret` so a tooltip cannot leak the trigger either. `hiddenAchievements.test.ts` (jsdom) asserts one `???` per unearned hidden row, no hidden name or description in the markup, and the real name once it is earned.

### What to do next (`src/game/goals.ts`)

One engine module answers both halves of "what now": which single action is worth taking, and which achievement is closest. It invents no game math, reading prices from `economy.ts`, gates from `unlock.ts` and `hardware.ts`, fees from `quantize.ts`, node availability and balances from `map.ts` and the XP bar from `level.ts`. Everything in it is called from 20 Hz selectors, so each function is one pass over the catalog returning primitives or one small flat object.

`condProgress(cond, state, derived, catalog)` turns any `UnlockCond` into `{ current, target, fraction, label }`. `stat` and `cps` divide by the threshold. `ownHardware` and `ownFamily` add the share of the next unit already banked (`min(1, credits / unitCost)`, against the cheapest unlocked unit for a family), because a near miss is exactly what the panel exists to show. `ownModel`, `precision`, `mapNode`, `upgrade` and `flag` are 0 or 1 with `describeUnlock` as the label. `all` reports its furthest child (the blocker), `any` its closest (the branch that will finish it). Fractions are clamped to [0, 1] and a measurable label reads `9,120 / 10,000 likes`, except the level stat, which is the one key whose unit goes first: `level 3 / 5`.

`nextAchievements(state, derived, catalog, n = 3)` returns the closest non-hidden, unearned, incomplete rows, ranked by fraction descending, then the smaller target, then catalog order, with yes/no conditions sunk to the bottom because they have no bar to draw. It inserts into a list of `n` rather than sorting the catalog.

`nextGoal` picks one thing, first match wins: a done and unclaimed contract (free credits nobody should leave on the table), then a model at or under the player's level that is not set up and whose setup fee is affordable (cheapest fee first, so free ones lead), then `saveTarget`, then the cheapest available Graph node already payable in its own currency, then the level bar. It is null only at max level with nothing outstanding. Every credit goal carries a whole-number percent and `etaSec` (`Infinity` at cps 0), so the bar re-renders at most a hundred times per target, and a `buy` goal also carries `unlocksModel`: the biggest model the unit would newly run *natively*, with level-locked models skipped so the hint never promises what the purchase cannot deliver.

`saveTarget` is the cheapest visible, purchasable-but-unaffordable unit, gated by `canBuy`'s non-credit checks in the same order and priced with `unitCost`. It moved here out of `storeHooks`, and the hook is now a thin wrapper over it, so the store's save-for bar and the Next up panel cannot quote different numbers; a test pins that they agree over a lived-in save. `isGoalDone` is what flips a row to its done state, and for a `buy` goal it is satisfied when the credits are **banked**, not spent: the goal was to save the price.

### The pacing simulator (`scripts/balance.ts`, `src/game/__tests__/pacing.test.ts`)

`simulate(strategy, seconds)` replays a greedy buyer against the shipped ladder using the game's own `unitCost`, `throttleMult` and `creditsForCp`, with a modelled click schedule (3/s for 3 min, 2/s to 10 min, 1/s to 30 min, then 0.5/s), a +30 % content bonus after 3 minutes, global +10 % upgrades at lifetime 1e3…1e9, tier upgrades, and the power ladder (a unit that would trip the breaker is also offered bundled with the PSU steps needed). `naive` buys the best affordable payback every second; `climb` saves for the best payback reachable within 45 s of income. `projectWeek` runs 7 days of one active hour plus 12 offline hours (capped at 8 h × 50 %). The tests pin: 3060 < 3 min, 4090 < 8 min, PRO 6000 < 15 min, a cloud node < 25 min (climb); first purchases in ladder order and through the workstation on-ramp; AMD never bought without ROCm; no region inside 3 h of continuous play but a Runpod 8×B300 pod owned; the orbital datacenter and Dyson swarm beyond a one-hour-a-day week while `region-us-east` lands after day 1; naive slower than climb at every milestone and forced to buy power once the breaker trips. `pnpm balance` prints the tables.

## 5. The UI

### App structure

`src/app/layout.tsx` wraps everything in `GameProvider`, whose `useGameLifecycle` calls `store.start()` once; the store is a module singleton (`getGameStore()` in `src/state/store.ts`), so income keeps ticking on `/map`, `/hub` and `/leaderboard`. `/` renders `GameShell` (`src/components/layout/GameShell.tsx`): a 350–600 ms splash with rotating `LOADING_LINES`, then `Header` (64 px), `NewsTicker` (32 px), the three-column `Workbench` (`minmax(320px,1fr) | minmax(0,2fr) | minmax(300px,1fr)`), `FxCanvas` and `Overlays`, all inside `FeedProvider`. Left column: `HeroPanel` (GenerateButton, counter, combo meter with `COMBO_GAP_MS = 400`), `NextUpPanel`, `FlagshipRig`, `PowerMeter`, `QueueMini`. Centre: `RackPanel` plus `CenterTabs` (Studio | Feed | Contracts, persisted in `localStorage['comfy-clicker:center-tab']`) with `TrendingStrip` above Studio and Feed. Right: `StorePanel` (Hardware | Upgrades | Models | Power, persisted under `comfy-clicker:store-tab`). `GameShell` also mounts `useSfx` next to `useHotkeys` and the `Tutorial` overlay, which lives here rather than in `Overlays` because it points at the workbench and `Overlays` also runs on the other routes. `/map` mounts `GraphMap` under its own header; `/hub` and `/leaderboard` reuse `Header` and `Overlays`.

The layout stays three columns on purpose: it reads left to right the way the loop reads, act then create then invest. The click target and the ticking number sit top left where the hand rests, the store is peripheral on the right, which is what makes an affordable row lighting up in the corner of the eye work, and every column scrolls internally so the big button never leaves the screen.

### The external store and selectors (why)

`GameStore` mutates `state` in place, bumps a monotonic `version` in a microtask (`notify`) and exposes `subscribe`/`getVersion`. `useGame(selector, equals)` (`src/state/useGame.ts`) binds through `useSyncExternalStore`: the selector runs on every version bump (≈20 Hz) but the cached value is returned unless `equals` says the slice changed, so a component re-renders only when its slice does. `useGameShallow` compares small objects key by key. The performance rules in `UI-SPEC.md` follow from this: selectors return primitives or `|`-joined id strings (`usePostIds`, `useMapSets`, `eventKey`), lists memoise rows by id, `content-visibility: auto` on long lists, feed capped at 60 cards, no `Date.now()` in render (countdowns use `useNow(250)`), and no mapping over `state.posts` inside the 20 Hz counter.

### FX canvas (`src/components/fx/FxCanvas.tsx`, `fxBus.ts`)

One full-viewport `<canvas>` (`z-50`, pointer-events none, DPR ≤ 2) with plain arrays for sprites (diamonds, rain, confetti; `MAX_SPRITES = 300`), floating texts (`MAX_FLOATS = 80`) and flashes. The credits glyph is rasterised once to an offscreen canvas at 12 px amber. Rain density is `clamp(log10(cps + 1) × 8, 0, 60)` sprites in the left 30 % of the viewport at 25 % alpha. Components talk to it through `fx.floatText / burst / confetti / flash / rain` on a tiny pub/sub; engine events map to `postResolved viral → confetti`, `achievement → electric flash`, `milestone → amber flash`, `easterEgg → confetti`. Paused when `document.hidden`; disabled by `settings.particles = false`, `settings.reducedMotion` or the OS preference.

### Hotkeys (`src/hooks/useHotkeys.ts`)

`Space` → one Generate click (ignored in inputs and on focused buttons unless they carry `data-generate-hotkey`; never repeats while held), `S` → `store.save()` + `comfy:saved` toast, `?` (Shift+/) outside inputs → `comfy:open-modal` with detail `help`, which `Tutorial` picks up as a replay, `Esc` → `comfy:close-modals`. `Ctrl/Cmd+Enter` inside the Studio prompt queues the job (and raises the `ctrl-enter` egg the first time). The Graph adds `/` (search), Enter, Esc, `+`/`-`, `0` (fit all), `F` (fit the frontier). `GenerateButton` gates its own pointer and key handlers on `trustedInput`, so a synthetic event never reaches the store.

### Easter eggs: every flag and its trigger

| Flag | Raised by | Reward |
|---|---|---|
| `konami` | ↑↑↓↓←→←→BA anywhere (`useEasterEggs`) | Spaghetti Mode: 60 s of animated litegraph noodles + glitch banner; afterwards 10 % of clicks give a 5 s reprise; surfaces hidden node `spaghetti-monster` (+11 % likes, 1 111 credits); achievement "Legacy Frontend". |
| `comfy-wave` | Typing `comfy` outside a text field | The wordmark surfs across the header; achievement "Comfy Said Hi". |
| `click-frenzy` | 100 Generate clicks within 10 s | Flash + burst; achievement "Batch Size: Yes". |
| `ticker-seven` | Clicking the "Comfy Wire" pill 7 times (`NewsTicker`) | Hidden node `pythongosssss-node` (+7 % income, 777 credits); achievement "Breaking: Nothing". |
| `seed42` | Seed box = `42`, or `seed 42` / `seed:42` in the prompt (`PromptInput`) | Hidden node `seed-42` (+1 % viral, 42 credits); achievement "Deterministic, Allegedly". |
| `rickroll` | Prompt contains `rickroll` | Matrix-reveal toast; hidden node `rickroll` (follow rate ×1.05, 1 987 credits). |
| `spaghetti` | Prompt contains the word `spaghetti` (engine, `createJob`) | Achievement "Spaghetti Mode". |
| `founderMention` | Prompt mentions a founder (engine) | ×3 likes once; achievement "Noticed By The Founders". |
| `sparkCaught`, `fixedNode` | Catching a spark / fixing a broken node | Achievements. |
| `speedrun` | First cloud node under `SPEEDRUN_SECS` (25 min) of play | Achievement "Speedrun". |
| `brokeAtZero` | A credits purchase leaving exactly 0 | Achievement "Out Of Credits, Not Ideas". |
| `luckySeed` | A click that rolled the lucky seed (1 in 200, ×10) | Visible achievement "Lucky Seed". |
| `clickGuard` | Tripping the cadence detector (`clickGuard.ts`) | Achievement "Suspiciously Regular". |
| `ratioed` | A post tagged for a kind its model is not (`virality.ts`) | Achievement "Workflow? (Derogatory)". |
| `jackpot42`, `nanStreak3`, `hotSeed`, `coinFive` | The Lounge: the ×42, three NaNs in a row, three wins in a row, five coin flips on your side | "It Was Always 42", "NaN, NaN, NaN", "Control After Generate: Fixed". |
| `gift:founder`, `gift:sonam` | Accepting a welcome gift | Achievement "Friends In High Places". |

**The seven newer eggs.** Every one of them is hidden, flag-driven and announced through the same path: the engine ones by diffing `CREATE_JOB_FLAGS` around `createJob`, the UI ones through `store.setFlag`, which raises the flag, emits `easterEgg`, grants the achievement and pays that achievement's credits in one call.

| Flag | Raised by | Achievement | Credits |
|---|---|---|---|
| `title-25` | 25 clicks on the "Comfy Clicker" wordmark, at most `TITLE_GAP_MS = 1 500` ms apart (`Header.Brand`). The word springs from click 10 and glows from 20, so something is clearly building long before the payout. | "Not The Generate Button" | 1 000 |
| `grand-tour` | Opening Map, Hub, Board, Stats and Settings in one session (`GRAND_TOUR_PANELS`, tracked in `sessionStorage['comfy-clicker:grand-tour']`) | "Read The Docs" | 500 |
| `night-shift` | A Generate click between 03:00 and 03:59 **local** time. The clock is read in the browser, because the engine has no timezone and must not grow one. | "Prompt Executed At 3 A.M." | 333 |
| `ctrl-enter` | Queueing a post with Ctrl/Cmd+Enter from the prompt box | "Queue Prompt (Legacy Shortcut)" | 250 |
| `bad-hands` | A prompt containing the phrase `bad hands` (engine, `createJob`) | "Negative Prompt In The Positive Box" | none |
| `masterpiece` | A prompt starting with `masterpiece best quality` (engine) | "Masterpiece, Best Quality" | none |
| `sd15-forever` | Queueing an `sd15` job while `derived.bestTier >= 12`, i.e. rendering SD 1.5 from a region (engine) | "It Is 2022 In Here Forever" | none |

### Overlays and the event bus

`Overlays` (`src/components/overlays/Overlays.tsx`) mounts `AchievementToast` (headless bridge from engine events to toasts), `EventBanner` (bottom-centre stack, collapses to a pill after 6 s), `TrendingSpark`, `EasterEggs`, `LevelUpBanner`, `WelcomeBackModal`, the five modals (`ModalId = settings | stats | daily | rebrand | seed`), `GuidanceHost` and `ToastHost` (`TOAST_MAX_VISIBLE = 4`, 5 s). `AuthSheet` and `PublishDialog` are owned by `AccountMenu` and the Studio rather than by this switch, and the `?` tile and hotkey raise `comfy:open-modal` with detail `help`, which is not a modal id at all: `Tutorial` listens for it and replays the tour.

Window `CustomEvent`s used across the UI: `comfy:open-modal`, `comfy:close-modals`, `comfy:saved`, `comfy:cloud-merge`, `comfy:cloud-decided`, `comfy:store-tab` (detail `{ tab, family?, focusId? }`), `comfy:center-tab`, `comfy:pick-hashtag`, `comfy:studio-load`, `comfy:map-focus`, `comfy:handle-changed`, `comfy:hub-changed`, `comfy:hub-run-recorded`, `comfy:hub-royalties`, `comfy:auth-tab`.

`AchievementToast` also bridges `levelUp`, `milestone`, `weekRollover`, a ratioed `postResolved`, `reward` and the ×42 `spin` to toasts, so each of those is visible from `/map` and `/hub` too. Every toast it raises passes `sound: false`, because the engine event has already sounded.

Settings offers export/import codes, hard reset (hold 2 s), `Save now`, four toggles (`sfx`, `particles`, `reducedMotion`, `projector`) and an About block crediting `marawan206` and Comfy Cloud for the art; `projector` and `reducedMotion` are mirrored onto `<html>` classes. `settings.autosave` exists in the state and the save schema and is read by the tick, but no switch renders it (see §13). `SaveStatus` sits in the header nav: `Saved just now` under 2 s, then `Saved 12s ago` / `3m ago` / `2h ago`, amber `Autosave off · saved 12s ago` if the setting is ever turned off, and `Not saving` in `slot-vae` with a one-time danger toast when the browser refuses a write.

### The header nav (`src/components/layout/navMeta.ts`, `navBadges.ts`, `NavTile.tsx`)

Eight destinations, drawn as tiles rather than grey glyphs: `Map · Hub · Board · Seed | ? · Stats · Settings · Projector`, with the divider between `seed` and `help`. `NAV_TILES` is the data (id, href, label, one-line pitch, tint, icon, whether it keeps its label at xl), and every tint is a set of literal Tailwind class strings, never built at runtime, because Tailwind scans source files for class names. Map is electric, Hub `#7f8dff`, Board credits amber, Seed `slot-latent`, Stats `slot-image`, Settings `slot-cond`, Help and Projector `smoke-600`. The active route gets a washed background and a 2 px underline that springs between tiles on a shared `layoutId`.

Badges are counts with `BADGE_CAP = 9` (`9+` above it): Map counts Graph nodes that are available and affordable right now, Hub the runs accumulated in `localStorage['comfy-clicker:hub-unseen']` since the last `/hub` visit, Board a rank read from a cache the leaderboard page writes with `RANK_TTL_MS = 60 min` (a rank older than that is a lie, so the badge drops rather than misleads), Stats the achievements earned since `comfy-clicker:stats-seen`, Lounge a bare dot while the free spin is waiting, Help a dot until the tour has run.

The "new" pulse has its own rules in `shouldPulse`, and they are about usefulness rather than novelty: a destination must be both unvisited (`comfy-clicker:visited`) *and* worth the detour, so Map waits for a node the player can actually buy, Hub and Stats wait for the first post, Board waits for a sign-in or 10 000 lifetime credits, and Settings, Seed, Help and Projector never pulse. `MAX_PULSES = 2` caps how many dots blink at once: a player returning after a week can satisfy four rules on one load, and four blinking dots is decoration rather than an invitation.

### Tooltips and the guidance popover

**`Tooltip`** (`src/components/common/Tooltip.tsx`) is the game's one tooltip, built on `@base-ui/react/tooltip` with node chrome. It takes a fixed set of slots, `title`, `description`, `cost` (`credits`/`rp`/`cp` plus the player's `have`, which annotates the credits figure in `slot-vae` when they are short), `meta`, `lock` and `shortcut`, plus `tone` (`default | electric | locked | credits`), `side` and `align`. `Tip` is the one-line shorthand. It is text only, never a button: an actionable lock belongs in the guidance popover, which does not close on blur. `TooltipProviderRoot` is mounted once in `GameProvider` with `delay 350, closeDelay 0, timeout 300`, so the whole app shares one delay group and moving between two tooltips inside 300 ms opens the second instantly. Copy lives in `src/components/common/tooltipCopy.ts` as pure builders (`<Tooltip {...hardwareRowTip(def, row)}>`), which is what makes it testable. Where a Tooltip is added the old `title=` attribute goes and the `aria-label` stays.

**Guidance** is the answer to "I clicked something locked and nothing happened". The engine half is `src/game/guidance.ts` (see CONTRACT.md): a structured `LockCause` union whose formatted output is byte-identical to the strings `lockReason`, `canBuy().reason`, `canQuantize().reason` and `describeUnlock` already produced, which is why the existing tests are the proof it did not drift. The UI half is `src/components/guidance/`: `lockGuide.ts` turns causes into a `GuideSpec` (`subject`, one line of `why`, at most three numbered steps, each with a label, a detail like `1,200 credits in Hardware › NVIDIA`, an optional `etaSec` and a `GuideAction`), and `GuidanceHost.tsx` is a bus, not a component tree. Any surface calls `guide(anchorEl, spec)` (or `guideCauses`) and the single host, mounted in `Overlays`, anchors a `@base-ui/react/popover` to that element, so nothing has to thread props and only one explanation is ever on screen. Esc, an outside press, any action and a `purchase` or `upgrade` event all close it.

`navigate.ts` runs the step's action: on the same route it uses the existing window events (`comfy:store-tab` with `family` and `focusId`, `comfy:center-tab`, `comfy:map-focus`, `comfy:open-modal`), and across routes it parks the request in `sessionStorage['comfy-clicker:goto']` and pushes the route, where `GraphMap` or `StorePanel` consumes it exactly once. `useHighlight` in `storeHooks.ts` scrolls the target row into view and rings it electric for a moment on arrival.

### The tutorial (`src/components/overlays/Tutorial.tsx`, `tutorialSteps.ts`, `src/state/tourStore.ts`)

Six coach-mark steps, about ninety seconds: a full-screen dim with a rounded spotlight cut around one live element and a node-styled bubble beside it.

| n | anchor (`data-tour`) | title | advances when |
|---|---|---|---|
| 1 | `generate` | This is the button. | `totalClicks >= start + TUTORIAL_CLICKS (10)` |
| 2 | `studio-generate` | Spend it in the Studio. | a job is queued or a post exists |
| 3 | `center-tab-feed` | It is collecting likes. | a post created since the tour started has resolved, or Next |
| 4 | `store-buy` (falls back to `store`) | Now buy something. | any hardware count rises |
| 5 | `trending` | Trending this week. | `comfy:pick-hashtag`, or Next |
| 6 | `nav` | The rest is up there. | Done |

Ten clicks in step one because a post costs exactly 10 credits. **Nothing here is modal**: the whole overlay is `pointer-events: none` apart from its own two buttons, so a player who ignores the bubble and goes exploring is never trapped. Gates are measured against a `tourStart` snapshot taken when the tour opens, and `firstIncompleteStep` skips anything already satisfied, so wandering only shortens the tour.

The spotlight is an SVG mask at `z-[70]`: a white full rect, a black rounded rect (radius 16) over the target's box inflated by 8 px, then a `charcoal-800` rect at 0.72 opacity through the mask and a 2 px electric stroke around the cutout. The cutout springs between steps (stiffness 380, damping 34) and is instant under reduced motion. Targets are re-measured every `MEASURE_MS = 500`, and an anchor missing for `MISSING_MS = 2 000` auto-skips its step. The bubble is 300 px of Panel chrome at `z-[71]` and never sits in the bottom-right block the toast stack owns. The tour hides while any `[role="dialog"][aria-modal="true"]` is in the DOM.

"Has been taught" is `flags['tutorial-done']`, set by the `completeTutorial` action, so the cloud save carries it between devices, export codes carry it and a hard reset replays the tour. Only the step cursor is local, in `localStorage['comfy-clicker:tour']` behind `tourStore`, a tiny `useSyncExternalStore` singleton (`DailyModal` only wants to know whether the tour is up, and `Tutorial` is the single writer, so a provider nobody else would use would be overkill). `shouldAutoStart` opens it `AUTO_START_MS = 900` ms after the shell is ready, only when the flag is unset, no modal or offline report is up, and the save is genuinely new: under `NEW_PLAYER_CLICKS = 50` clicks, zero posts, under `NEW_PLAYER_CREDITS = 500` lifetime credits. A save that fails that check but lacks the flag gets `completeTutorial()` called silently on boot, so a veteran never sees it. Skipping marks it done, and the `?` tile or the `?` key replays it.

### Sound (`src/audio/`)

`sfxMap.ts` is pure and node-testable: the 18 names in `SFX_NAMES` (`achievement, breaker, cash, click, contract, daily, egg, error, flop, jackpot, levelup, lose, purchase, spin, tick, toast, viral, whoosh`), the per-name `BASE_GAIN`, `cueForEvent(event, ctx)` as an exhaustive switch with a `never` default, `cueForToast(tone)`, `comboRate(combo) = 1 + min(combo, COMBO_RATE_CAP 50) × 0.006` (1.0 alone, 1.3 at a 50-click streak), the `ClickLimiter` token bucket (`CLICK_LIMIT_PER_SEC = 20`), and a synth `Recipe` for every name so an empty `public/sfx` still sounds like a game. The files themselves are 18 mono MP3s under `public/sfx`, 276 KB in total, and a test asserts the folder and the name list stay in step.

`sfxEngine.ts` is the only file that touches Web Audio. The `AudioContext` is created lazily on the first **trusted** `pointerdown` or `keydown` and never at import time, is resumed on `visibilitychange`, and is never built at all while `settings.sfx` is false. Master volume comes from `localStorage['comfy-clicker:sfx-volume']` (`SFX_DEFAULT_VOLUME = 0.6`, a device preference rather than save data). Nothing plays while `document.hidden`. Files are fetched lazily per name and cached; a non-2xx or a decode failure marks that name missing and the synth recipe takes over for the session. At most `MAX_VOICES = 8` sources are live, clicks are capped by the limiter and never stack more than `CLICK_MAX_OVERLAP = 3` deep, every click gets ±2 % detune so a held combo does not turn into a buzzsaw, and click gain drops to `CLICK_DUCK = 0.5` while one of the `DUCKERS` (`achievement, viral, levelup, jackpot`) is playing. `MIN_GAP_MS.error = 500` throttles the blocked-click alarm to two a second.

`useSfx` (mounted once by `GameShell`) subscribes with `useGameEvents` and tracks its own click combo. The map: `click` → `click` at `comboRate`; `clickBlocked` → `error`; `purchase` → `purchase`, with a second at rate 1.12 after 90 ms for a bulk buy of 10 or more; `upgrade` → `purchase` at 1.12; `mapUnlock` → `whoosh` then `cash`; `jobStarted` → `tick`; `postCreated` → `whoosh`; `postResolved` → `viral` / `lose` on a ratio / `flop` / else `cash`; `achievement` → `egg` for a hidden row, else `achievement`; `levelUp` → `levelup`; `contractDone` → `contract`; `eventStart` → `error`, `breaker`, `egg` or a double tick by kind; `eventEnd` → `cash` only for a fixed node; `daily` → `daily`; `rebrand` → `levelup` at 0.8; `powerThrottle` → `breaker` on, `cash` off; `signup` → `cash` at 1.2; `weekRollover` → double tick; `easterEgg` → `egg`; `milestone` → `levelup` at 0.9; `spin` → `jackpot` at ×10 and up, `lose` at ×0, else `spin`; `reward` → `cash` then `achievement`. `offline` is deliberately silent, because it fires before any gesture has unlocked audio. Toasts play `cueForToast(tone)` when a card mounts unless they pass `sound: false`, which every toast raised from an engine event does.

### Asset manifest and Art fallbacks

`src/data/assetManifest.ts` declares every raster asset: 38 `hw-*`, 35 `model-*`, 12 `badge-*`, 8 `av-*`, 2 ui (`hero-aura`, `bg-backdrop`), 51 `thumb-<family>-NN` (9 families; the three video families are `.mp4`) and 9 `map-*`: 155 ids. `src/data/assetIndex.json` (written by `art-postprocess.mjs`) lists which files exist under `public/art/`, and `Art` (`src/components/common/Art.tsx`) renders the file only when it is in that index, otherwise a same-size fallback tile (vendor SVG on a hashed gradient, a lucide glyph on sapphire, or a seeded gradient). `thumbFamilyFor(modelId, kind)` and `pickThumb(family, prompt, hash)` choose a post thumbnail by tag overlap with the prompt.

## 6. The live feed

### Sources (`src/server/feed/sources/*`)

| Source | How | Notes |
|---|---|---|
| `x` | fxtwitter JSON (`api.fxtwitter.com/<user>/status/<id>`), fallback Twitter syndication CDN | Curated status ids from `realPostsSeed`; dates from the snowflake id. Also fetches the @ComfyUI profile avatar for org-authored items. |
| `linkedin` | Guest-visible post pages with a desktop UA; reads `description` meta, `data-num-reactions`, `datePublished`, `og:image` | Curated activity ids plus up to 2 discovered per profile (`robinjhuang`, `yolandyan`), kept only if the text mentions "comfy". Activity ids encode creation time (`id >> 22`). |
| `reddit` | `r/comfyui/top/.rss?t=week&limit=15` Atom | JSON endpoints 403; Atom has no score, so `likes` is null. |
| `hn` | Algolia search `query=comfyui&tags=story` | Keeps stories whose title/url mention Comfy. |
| `blog` | `blog.comfy.org/feed` RSS | |
| `github` | `Comfy-Org/ComfyUI/releases?per_page=5` | `GITHUB_TOKEN` optional. |
| `registry` | `api.comfy.org/nodes` pages 1–2, top 10 by downloads | `likes` = GitHub stars; excluded from trending. |
| `youtube` | Two channel Atom feeds | |

`collectFeed` (`src/server/feed/index.ts`) runs all sources in parallel with a 5 s per-request timeout (`FETCH_TIMEOUT_MS`) and a 25 s per-source deadline, backfills the 12 curated founder posts from `src/data/realPostsSeed.ts` (live copies win on id), normalises and computes trending.

### Normalisation (`normalize.ts`)

Dedupe by id, collapse whitespace, clamp text to 600 chars, drop adult-content text, ISO dates (fallback `now`), non-negative integer likes, `verified` for official handles (`OFFICIAL_HANDLES`), and tag by keyword: a compiled regex per vocabulary entry (word-bounded keywords plus literal `#tag`), hits capped at 5 per tag, at most 6 tags per item. The vocabulary is `FEED_VOCAB = buildFeedVocabulary()`: the game's 30 hashtag ids, kinds and families, with `FEED_VOCAB_FALLBACK`'s feed-tuned keywords winning wherever both know an id and the catalog keywords kept for the rest. That merge is load-bearing and `refreshFeed` now goes through it by passing no `hashtags` option at all: the game's keyword lists are written for player prompts (`dev`, `app`, `1024`, `pack`), so handing `collectFeed` the raw catalog tags ordinary release notes with model hashtags, and those false hits reach trending.

### Trending derivation (`trending.ts`)

Over social items from the last 14 days (`TRENDING_WINDOW_DAYS`), each item weighs `1 + ln(1 + likes)`; score per tag = Σ hits × weight; tags present on more than 70 % of items are background and skipped; `comfyui` is always excluded; fewer than 5 items → `[]`. The top 3 are returned with at least one non-type tag guaranteed.

### The store (`store.ts`): DB → memory → seed

`readFeed()` tries Supabase (`feed_items` newest `FEED_LIMIT = 120`, latest `trending_tags` row, `feed_meta['feed']`), then a process-memory cache, then the committed seed. `stale` is true past `FEED_TTL_MS = 15 min`. `refreshFeed()` coalesces concurrent callers, runs `collectFeed`, upserts `feed_items` in batches of 100, inserts a `trending_tags` row, upserts `feed_meta`, and then prunes.

**The seed top-up reserves its slots before the cut.** `withSeed(items)` subtracts the curated founder posts from the limit first and slices the live rows to what is left, instead of merging everything and slicing afterwards. Merging first dropped every founder post as soon as the table held 120 newer rows, which the cron reaches inside a day: they are all dated 2026-06-04 or earlier, and retention deletes their rows because they sit outside the window, so this read-time top-up is the only thing keeping them in the feed at all.

**Retention** closes the other half of that: after every refresh, `prune` deletes `feed_items` older than `FEED_RETENTION_DAYS = 30` and every `trending_tags` snapshot but the newest 200. Reads only ever look at the newest 120 anyway, so nothing visible changes; the table just stops growing forever.

### Routes and auth

- `GET /api/feed` returns the snapshot and, when stale, schedules `refreshFeed` with Next's `after()` so callers never wait on the network (lazy refresh). Cache `s-maxage=60`.
- `GET /api/trending` returns `{ tags, updatedAt, origin }`.
- `GET|POST /api/feed/refresh` requires `Authorization: Bearer $CRON_SECRET` (`isCronAuthorized` in `src/server/supabase/env.ts`, constant-time compare; closed when the secret is unset). Scheduled by `vercel.json` daily at 06:00 UTC and, optionally, by `0002_feed_cron.sql` every 15 minutes through `pg_cron` + `pg_net`.

### How trending reaches the game

`src/components/feed/feedClient.ts` polls `/api/feed` every 10 minutes (and on tab return) and, when the payload carries exactly `TRENDING_COUNT = 3` tags, calls `store.setLiveTrending(tags)`. `currentTrending(state, now, catalog, weekSpeed)` uses `liveTrending.tags` while `now − fetchedAt < 30 min`, otherwise the deterministic board: `weekIndex = floor(now / (WEEK_MS / weekSpeed))` with `WEEK_MS = 10 min`, and `trendingForWeek` picks 3 distinct ids by a partial Fisher–Yates shuffle seeded with `mulberry32(week)`. The `Fast Weeks` prestige node sets `weekSpeed = 2`. The TrendingStrip shows a live/seeded/pinned marker and a countdown ring to `msUntilRollover`.

## 7. Accounts and cloud saves

**Guest mode** is the default: the save lives in `localStorage` under `comfy-clicker:save`, the guest id under `comfy-clicker:guest`. Without `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` (`hasSupabase()` false) auth status is `unavailable` and every cloud action returns a friendly error.

**Auth** (`src/components/auth/useAuth.ts`): email + password through the cookie-backed browser client (`@supabase/ssr`), one `onAuthStateChange` subscription, a `profiles.handle` lookup after sign-in. Sign-up redirects confirmation links to `/auth/callback`, which exchanges a PKCE `code` or verifies a `token_hash` and bounces to `next` with `?auth=ok|error`. The origin those links point at is `NEXT_PUBLIC_SITE_URL` when it is set, falling back to `window.location.origin`; the Supabase project's Site URL and redirect allow-list have to carry the deployed URL too, or Supabase falls back to Site URL and the email says `localhost:3000`. A trigger creates the `profiles` row with `handle = 'comfy-' || left(id, 6)`.

**Usernames.** `src/lib/handle.ts` holds the rules shared by the client and the SQL: `HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/` (the same literal as the column check), `RESERVED_HANDLES`, `normalizeHandle`, `validateHandle` and `mapProfileError`. The create-account form takes an optional handle and passes it as `options.data.handle`; since `0004_profiles.sql` the sign-up trigger honours it when it is well formed, unreserved and free, and otherwise falls back to the generated handle with the same collision retry, so a sign-up never fails because a name was taken. `AccountMenu` → `UsernameModal` renames through `useAuth.updateHandle`, which maps `23505` to "that username is taken", `23514` to the format rule, and the trigger's own `handle_cooldown` and `handle_reserved` to their copy. A rename is one a day per user JWT, enforced by `profiles_guard_handle()` rather than by the client.

**Welcome gifts** (`src/lib/gifts.ts`, `src/data/gifts.ts`). `giftFor(email, handle)` returns `founder` for exactly `yoland@comfy.org`, `robin@comfy.org` or `comfy@comfy.org`, or for an email or handle containing `yoland`, `robin` or `yaozhong`; `sonam` when either contains `sonam`; founder wins when both match. `GIFTS.founder` is one `rtx-pro-6000` plus the `psu-850` upgrade, which rides along because 600 W on top of the 65 W starter box is over the 650 W base budget and a gift that arrives throttled reads as a bug; `GIFTS.sonam` is 50 000 credits. `FounderGiftModal` runs only after the cloud sign-in decision (`comfy:cloud-decided`), because a founder on a new device would otherwise be offered the gift against a throwaway local state the cloud save then replaces. The offer is dismissible only by answering: Esc and the backdrop both count as a decline, and `grantGift` / `declineGift` set flags so it is asked exactly once. A **handle** match counts only while `profiles.handle_changed_at` is null, i.e. the handle is still the one sign-up assigned, or the email is already on `comfy.org`; otherwise anyone could rename themselves into a free RTX PRO 6000.

**Cloud saves** (`src/state/persistence.ts`): the local autosave is always written first; the cloud row (`saves`) is a copy carrying `version, state, cps, lifetime_credits, followers, season, saved_at`. On sign-in: no row → upload; the row is this device's last upload (a `localStorage['comfy-clicker:cloud']` receipt with the same `saved_at`) → upload; the local run is fresh (`lifetimeCredits < 500 && playedSec < 120 && totalClicks < 50 && season === 1`) → adopt the cloud save silently; both real and different → `comfy:cloud-merge` opens `CloudMergeModal` with the higher-lifetime side preselected. Adopting runs `applyOffline` from the cloud's `lastTickAt`. Afterwards uploads happen every `CLOUD_SYNC_MS = 60 s` while a fingerprint changes and on hide/unload. **Conditional updates**: every `update` is `.eq('saved_at', cloudSavedAt)`; zero rows written means another device wrote in between, so the row is re-read and either silently re-based (same run within 5 s of income) or the merge question is asked again.

**One tab writes** (`GameStore`, `src/state/store.ts`). Without a lock the last writer wins unconditionally, so a hidden tab waking up stamps its hour-old state over the tab actually being played, and for a signed-in player the two tabs fight over the cloud row roughly once a minute, which surfaces as the destructive merge question. So one tab per origin owns `SAVE_KEY`: it holds a heartbeat lock in `localStorage['comfy-clicker:leader']` (`{ id, at }`), restamps it from the tick every `LEADER_HEARTBEAT_MS = 2 000` ms, and any tab may take a lock older than `LEADER_STALE_MS = 6 000` ms, because a frozen tab stops restamping by itself. Every other tab is a follower: it plays normally but never writes the save, never starts cloud sync, and mirrors the leader's blob through the `storage` event. localStorage has no compare-and-swap, so two tabs claiming in the same millisecond both write and then re-read to see who landed last; the loser steps back on its next heartbeat. A storage that refuses the write is a storage no other tab can be sharing either (private mode, full quota), so that tab keeps playing as leader and the refused save surfaces through `saveError`.

**The local blob is stamped with the account it belongs to**, in `localStorage['comfy-clicker:save-owner']` (absent for a guest run), written only after a successful upload or adopt. A stamp naming somebody else is the previous player's run on a shared browser, and it is already in *that* account's row, so it is never offered to the new account as "this device": a foreign stamp adopts the cloud row outright, or hard-resets when the new account has no row yet. Without it, and with the merge dialog preselecting on lifetime credits alone, one Enter could hand one player another's progress and overwrite a real save.

**Daily on the server** (`POST /api/daily`): the UTC day comes from the server clock; `daily_logins` has one row per user and day; a repeat is a 409 carrying the held day and streak (the client adopts it via `markDailyClaimed`); the streak continues on a one-day gap, or a two-day gap when the player's cloud save owns `streakGrace` (read from `saves.state`, never asserted by the client). Writes use the service role (0003 removed the client insert policy). The client pays out with `claimDailyFromServer` using the game's own reward formula; guests use the local path, and an unreachable server falls back to a local claim.

**Leaderboard** (`src/server/leaderboard.ts`): reads the public `leaderboard` view with a cookie-less anon client, joins `profiles.created_at`, ranks the top 100 by `lifetime_credits`. Plausibility rule: `lifetime_credits ≤ cps × secondsSinceCreated × PLAUSIBILITY_MULT (12) + PLAUSIBILITY_FLOOR (1e6)`; failing rows are flagged with an asterisk, never dropped. The page refreshes every 60 s and on focus; the API is cached `s-maxage=30`.

## 8. The Graph (map)

### Data model (`src/data/mapNodes.ts`)

132 `MapNodeDef`s: `id, title, desc, branch, cost, currency ('credits' | 'rp' | 'cp'), parents[], effects[], hidden?, unlock?, position, icon`. Positions sit on a 260 × 140 grid (`MAP_GRID_X/Y`), one horizontal lane per branch (`MAP_ROWS`: prestige 0, regions 1, infra 2–3, hardware 4–6, core 7, models 8, techniques 9–10, api 11, social 12, hidden 13) so edges always point right. By branch: core 13 (`core-root` → `core-v1`, costs 0 → 1e10), hardware 24 (eight families × three `familyMult` nodes ×1.1/×1.25/×1.5, the first only visible once you own the family), models 11, techniques 20 (speed, `quant-fp8`, `quant-q4`, ROCm Basics, ZLUDA, `lora-training`, six `distill-<family>` nodes at `familyGenTime 0.7`), infra 18, regions 9 (credits, then `orbital-unlock` 25 CP, `orbital-relay` 60 CP, `dyson-unlock` 200 CP), api 7 (`api-nodes` 5e6 credits), social 12 (priced in RP, 1 → 60), prestige 14 (CP, 3 → 200: Season Income I–V, Start With a 4090/PRO 6000/H100, Muscle Memory, Fast Weeks, Warm Cache, Legacy Audience, Founders' Club, The Singularity), hidden 4. `MARKER_IDS` (`quant-fp8`, `quant-q4`, `lora-training`, `regions-unlock`, `orbital-unlock`, `dyson-unlock`) are read by id elsewhere rather than through effects.

### Availability and currencies (`src/game/map.ts`)

`mapNodeAvailable`: not owned, every parent owned (the root has none), unlock condition met, and hidden nodes need their discovery flag. `mapNodeVisible`: non-hidden nodes are always drawn; hidden ones only once surfaced or owned. Credits are deducted; CP goes through `cpSpent` so `state.cp` (and the prestige multiplier) never falls; RP is never deducted. `rpSpent` is derived from owned RP nodes. `unlockMapNode` reports `Unlock <parent> first`, the unlock description, or `Not enough <currency>`.

### Rendering (`src/components/map/GraphMap.tsx`)

An `@xyflow/react` canvas dressed as a ComfyUI workflow: lane bands per branch (`LaneGroup` nodes), memoised `MapNode` boxes, bezier `MapEdge` noodles, a two-layer dot background (24 px minor, 120 px major), a restyled minimap and controls, a search box and branch legend top-left, `NodeDetails` on the right. Nodes are not draggable or selectable; `onNodeClick` selects. `useMapSets` selects four `|`-joined id strings (owned, available, affordable, surfaced) so the graph rebuilds only when a set changes, and `buildGraph` reuses unchanged node objects. The first fit frames the "frontier" (owned + available) at no less than zoom 0.6; zoom range 0.15–1.75. `useUnlockNode` bursts diamonds, flashes on prestige/CP nodes and toasts in the branch colour (`BRANCH_META` in `mapLayout.ts`).

## 9. ComfyHub

**Tables**: `hub_workflows` (author, name ≤ 80 chars, `model_id`, `precision`, `lora_tag`, `upscaler`, `hashtags` ≤ 8, `runs_24h`, `runs_total`, `rep`, `royalties_total`) and `hub_runs` (workflow, runner, `credits_paid`, `royalty`, `rep`, `claimed_at`). **RLS**: workflows readable by everyone, insert/update/delete by the author, but the counters are protected by the `hub_workflows_protect_counters` trigger (a user JWT cannot change `runs_24h`, `runs_total`, `rep`, `royalties_total`); runs are readable by everyone and, since 0003, written only by the service role.

**Flow** (`src/server/hub.ts`, `src/components/hub/useHub.ts`):

1. *Publish*: the Studio's "Publish to ComfyHub" opens `PublishDialog` (prefilled from the form); `POST /api/hub/publish` validates with `hubPublishSchema` (`HUB_MAX_HASHTAGS = 3`) and inserts as the signed-in user; the client bumps `stats.hubPublished`.
2. *List*: `GET /api/hub?sort=trending|new&tag=…`: trending ranks by `runs_24h × (1 + HUB_TRENDING_BONUS (0.5) × liveTrendingMatches)` in memory (over-fetching up to 200 rows), `new` by `created_at`; `HUB_LIST_LIMIT = 60`.
3. *Run*: a card's Run button is enabled when `computeRunVerdict` (the game's own `runnableHardware`/`lockReason`) says the player can run that model at that precision. `requestStudioLoad` patches the Studio form, parks the recipe in `sessionStorage['comfy-clicker:hub-load']`, forces the centre tab to Studio and navigates to `/`. The next job queued with a matching model and precision carries `hubWorkflowId`; the post gets `HUB_RUN_LIKES_BOOST = 1.15` likes (the runner's reward).
4. *Royalty*: when that post resolves, `ensureHubRoyaltyBridge` POSTs `{ workflowId, creditsPaid: post.cost }` to `/api/hub/run`. The server rate-limits `HUB_RUNS_PER_MINUTE = 40` per runner and `HUB_RUNS_PER_WORKFLOW_HOUR = 12` per runner per workflow (the per-minute limit bounds how fast runs are recorded but not where they point, so without the second one a single account can pump one workflow's `runs_24h`, which is the whole trending sort key), clamps `creditsPaid` to `runCostCap`, computes `royalty = round(paid × 0.05)` (0 on self-runs) and `rep = 1 + floor(log10(1 + royalty))`, and inserts the run; the `hub_runs_after_insert` trigger bumps all four counters atomically.

   **The cap no longer rests on the runner's own `saves.cps`.** RLS lets the owner write their own save row, so capping a run against it let the person being capped pick the cap, and a single PATCH setting `cps` to 1e12 turned royalties into minted credits. The cap is now `runCostCap(modelId, precision, min(saves.cps, plausibleCps(accountAge)))`: the runner's uploaded figure can only ever *lower* it, and the ceiling comes from `profiles.created_at`, the one scalar about a player the server writes itself. `plausibleCps(age) = min(HUB_CPS_CEILING (1e10), HUB_CPS_SEED (10 000) × (1 + age / HUB_CPS_TAU_S (60)) ^ HUB_CPS_EXP (3))`, fitted loosely to the pacing sim with one to two orders of magnitude of headroom for prestige and achievement multipliers, so an honest run is never clipped and the ceiling binds only far past anything the game produces. `HUB_CPS_HEADROOM = 4` is the slack on top, because the cloud row is up to a minute old and early income can jump several times over inside that minute.
5. *Collect*: the author's game polls `POST /api/hub/royalties` on sign-in, every `HUB_ROYALTY_POLL_MS = 120 s` and on tab return; `claim_hub_royalties(author)` marks unclaimed runs and returns `{ runs, royalty, rep }`, applied through `applyHubRoyalties` (credits via `addCredits`, `hubRep`, `stats.hubRuns`).

**Refresh**: `refresh_hub_runs_24h()` recomputes the rolling window; called by `GET /api/hub/refresh` (cron-authorised, `vercel.json` daily 06:30 UTC) and by the `comfy-clicker-hub-runs-24h` pg_cron job every 15 minutes when the extension is installed.

## 10. Database

All tables have RLS enabled; "service role only" means no anon/authenticated policy exists.

| Table / view | Columns | Read | Write |
|---|---|---|---|
| `profiles` | `id (uuid, → auth.users)`, `handle` (unique, `^[a-z0-9][a-z0-9_-]{2,31}$`), `avatar_seed`, `created_at`, `handle_changed_at` (0004; null = still the sign-up handle) | everyone | owner insert/update, policed by `profiles_guard_handle()` |
| `saves` | `user_id` (pk), `version`, `state` (jsonb), `cps`, `lifetime_credits`, `followers`, `season`, `saved_at`; index on `lifetime_credits desc` | owner | owner insert/update/delete |
| `daily_logins` | `(user_id, day)` pk, `streak ≥ 1` | owner | service role only (0003 dropped owner insert/update) |
| `hub_workflows` | `id`, `author_id`, `name`, `model_id`, `precision ∈ native/fp8/q4`, `lora_tag`, `upscaler`, `hashtags text[] ≤ 8`, `runs_24h`, `runs_total`, `rep`, `royalties_total`, `created_at`; indexes on author, `runs_24h desc`, `created_at desc`, GIN on hashtags | everyone | author insert/update/delete; counters server-owned by trigger |
| `hub_runs` | `id`, `workflow_id`, `runner_id`, `credits_paid`, `royalty`, `rep`, `claimed_at`, `created_at`; partial index on unclaimed | everyone | service role only (0003 dropped runner insert) |
| `feed_items` | `id text` pk, `source`, `author`, `handle`, `avatar_url`, `url`, `text`, `date`, `likes`, `media_url`, `tags text[]`, `verified`, `fetched_at` | everyone | service role |
| `trending_tags` | `id serial`, `tags text[]`, `computed_at` | everyone | service role |
| `feed_meta` | `key` pk, `updated_at`, `errors jsonb` | everyone | service role |
| `leaderboard` (view, `security_invoker = false`) | `user_id, handle, cps, lifetime_credits, followers, season`: top 100 by lifetime credits; never exposes `state` | everyone | none |

**Functions and triggers**: `handle_new_user()` (security definer, `search_path = ''`) on `auth.users` insert creates the profile, honouring a well-formed, unreserved, free `raw_user_meta_data.handle` since 0004 and otherwise retrying with longer uuid prefixes on collision; `profiles_guard_handle()` (0004, before update) refuses reserved names, holds a user JWT to one rename a day, stamps `handle_changed_at` and pins `created_at`; `hub_workflows_protect_counters()` restores the four counters when `auth.role()` is `authenticated`/`anon` and `pg_trigger_depth() ≤ 1`, on insert as well as update since 0005; `hub_runs_after_insert()` (security definer, after insert) bumps `runs_total`, `runs_24h`, `royalties_total`, `rep`; `refresh_hub_runs_24h()` recomputes `runs_24h` from the last 24 h (service role only); `claim_hub_royalties(uuid)` marks and sums the author's unclaimed runs from other players (service role only).

**Migrations**: `0001_init.sql` creates every table, policy, grant, the view, the first three functions and triggers. `0002_feed_cron.sql` (optional, placeholders `__DEPLOY_URL__`/`__CRON_SECRET__`) installs `pg_cron` + `pg_net` and schedules `comfy-clicker-feed-refresh` every 15 minutes to POST `/api/feed/refresh`. `0003_hub_integrity.sql` adds `hub_runs.rep`, `hub_runs.claimed_at`, `hub_workflows.royalties_total` (backfilled), drops the runner-insert and daily owner-write policies, upgrades the two hub triggers, adds `claim_hub_royalties`, and schedules `comfy-clicker-hub-runs-24h` every 15 minutes when `pg_cron` is present.

`0004_profiles.sql` is the username migration: `profiles.handle_changed_at`, the rewritten `handle_new_user()` and the `profiles_guard_handle()` rename gate. The regex is repeated verbatim from the 0001 column check so the trigger and the constraint can never disagree, and `src/lib/handle.ts` carries the same literal for the client.

`0005_hardening.sql` closes three holes, all reachable with nothing but the public anon key and the player's own access token, straight to PostgREST. The hub counters were protected on UPDATE only, while the insert policy checks nothing but `auth.uid() = author_id`, so a signed-in player could POST a brand new workflow with `runs_24h` already filled in and land at the top of a trending list that ranks on `runs_24h` alone; the guard now runs before insert too and zeroes all four for user JWTs. The rename cooldown was bypassable, because `handle_changed_at` is a plain column the owner-update policy lets the owner write and an update that does not touch the handle skipped the rename branch entirely, so clearing the stamp in its own PATCH reset the limit; it is now pinned for user JWTs whenever the handle is not actually changing. And the reserved-name list was 26 names on the client against 9 in SQL, so `root`, `staff`, `administrator`, `hub`, `leaderboard` and a dozen others were claimable by a direct PostgREST update while the in-app modal refused them; since the handle is shown on the public leaderboard and on every ComfyHub card, `root` or `staff` reads as an official account. Both functions now carry the client's full list plus the two comfy-org names 0004 reserved. Additive throughout: no drops, no deletes, no column or policy changes, only function and trigger bodies.

`src/server/supabase/__tests__/schema.test.ts` reads the SQL text of 0001 (RLS on every table, policies present, no destructive statements, view shape, `search_path` pinned), 0004 (additive, `search_path = ''` on both functions, the handle regex identical to the column check, the cooldown interval, the reserved list) and 0005 (the three functions with pinned search paths, the insert guard, the pinned stamp, the shared reserved list). It reads the files, so editing a migration's text can break it.

## 11. Art pipeline

Every asset id in `assetManifest.ts` has one prompt in `scripts/art-prompts.ts`, built from a style prefix per family: `STYLE_ICON` (vector game icon, transparent background, readable at 48 px) for hardware and map glyphs (`STYLE_MAP`), `STYLE_BADGE` (hexagonal medal) for badges, `STYLE_CARD` (painterly charcoal card, 2:3) for model cards, `STYLE_AVATAR` for avatars, free-form prompts for the two UI backdrops, and per-family thumbnail prompts written in the voice of the tier they imitate. `artJobs()` assigns a Comfy Cloud MCP route per category and `batchItems()` turns them into `submit_batch` items:

| Family | Model | Params |
|---|---|---|
| hardware, badges, map | `openai/images-generations` with `gpt-image-2.5-sunburst`, 1024², quality high, transparent background | transparent icons |
| model cards, ui, 3D thumbs | `bfl/flux-2-pro`, aspect 2:3 / 16:9 / 1:1 | |
| avatars, image thumbs | `vertexai/nano-banana-2` | |
| `video-wan` thumbs | `kling/kling-3.0-turbo-t2v`, 4 s, 720p, 16:9 | |
| `video-ltx` thumbs | `ltx/ltx-2-5-t2v` (LTX-2.5 Fast), 4 s, 1280×720, 25 fps, no audio | |
| `video-hunyuan` thumbs | `minimax/hailuo-03-t2v`, 4 s, 768P, 16:9 | |

Workflow: `pnpm tsx scripts/art-prompts.ts [category]` prints the batch JSON; submit it through the MCP (the session's batch files live in `.tmp/batch-*.json`); save `get_batch_output` to a file and run `node scripts/art-collect.mjs <output.json>` to download each labelled result into `art-src/<category>/<id>.<ext>` (category from the label prefix; concurrency 4, `--force` to overwrite); then `pnpm art:post` (`scripts/art-postprocess.mjs`) resizes with sharp per category (`SIZES`: hardware 256, models 352×528 cover, ui 1024, badges 192, avatars 160, thumbs 512, map 128; webp quality 84 / alpha 90), re-encodes `.mp4` with ffmpeg when present (640 px wide, muted, libx264 crf 30, faststart; plain copy otherwise), optionally slices sprite sheets from `art-src/sheets/<sheet>.png + .json`, and rewrites `src/data/assetIndex.json` with every file under `public/art/`. `pnpm assets:check` (`scripts/check-assets.ts`) lists what is still missing (`--list` for ids). The current index holds 155 files, exactly the 155 manifest assets, and `public/art/` holds the same 155. **To add an asset**: add the id to the manifest, a subject line to the matching map in `art-prompts.ts`, generate, collect, post-process. **To regenerate**: delete the file in `art-src/`, re-submit that id, collect with `--force`, post-process.

## 12. Operations

**Scripts** (`package.json`): `dev`, `build`, `start`, `lint` (eslint), `test` (`vitest run`; two projects: node for game/data/server/scripts, jsdom for `src/components`), `test:watch`, `typecheck`, `assets:check`, `art:post`, `balance`, `commit` (`node scripts/backdate-commit.mjs`).

**Env vars** (`.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), `NEXT_PUBLIC_SITE_URL` (the origin confirmation emails should return to; blank falls back to `window.location.origin`), `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`; server only, the admin module throws if bundled for the browser), `CRON_SECRET`; `GITHUB_TOKEN` is read by the GitHub source but not listed. All optional: without Supabase the game is guest-only.

**Vercel**: `vercel.json` schedules `/api/feed/refresh` at `0 6 * * *` and `/api/hub/refresh` at `30 6 * * *`, once a day each, the Hobby plan's cron limit; Vercel adds the `Authorization: Bearer $CRON_SECRET` header. Feed freshness in between relies on the lazy refresh in `GET /api/feed` (any visit past 15 minutes triggers a background collection) and, if applied, the pg_cron job. `.vercelignore` drops `art-src`, `.tmp`, `node_modules`, `.next`.

**Supabase settings** (`supabase/config.md`, `docs/DEPLOY.md`): apply `0001`, then `0003` (required by hub runs, royalties and the daily route), `0004` (required by the username picker) and `0005` (the counter and rename hardening), `0002` optionally; enable email + password; add `<site>/auth/callback` (and localhost) to redirect URLs, and put the deployed URL in Site URL as well or confirmation emails keep pointing at localhost; email confirmation may stay on.

**Session refresh** (`src/proxy.ts`, Next 16's name for middleware): every request carrying an `sb-` cookie goes through `createSupabaseProxyClient` and `getUser()`, which validates the access token and writes a refreshed pair back onto the response, so server components, route handlers and the browser client all see a live session. Requests without an auth cookie and guest mode (no Supabase env) pass straight through, an unreachable auth server never blocks the page, and the matcher excludes `_next/static`, `_next/image`, the favicon and everything under `brand/`, `art/`, `sfx/` and `fonts/`.

**CI** (`.github/workflows/ci.yml`): on push to `main` and pull requests, `actions/checkout@v5` and `actions/setup-node@v5` on Node 24, with `pnpm/action-setup@v4` given **no** version so pnpm comes from `packageManager` in `package.json` (specifying both is the "Multiple versions of pnpm specified" error), then `pnpm install --frozen-lockfile`, `typecheck`, `test`, `build` with placeholder Supabase env.

**Commit conventions**: `scripts/backdate-commit.mjs "message" [iso-date]` commits with scheduled author/committer dates. The first slot is `2026-09-04T19:12:00+03:00`, later slots advance 15–75 minutes inside 10:00–24:00 local, 4–9 commits per day, rolling to the next morning, never past now, tracked in `.tmp/commit-clock.json`. Staged files only when something is staged, else `git add -A`. Per the project's memory notes: no AI attribution lines, commits go straight to `main`, no PRs.

**Local dev**: `pnpm install`, `cp .env.example .env.local`, `pnpm dev` (http://localhost:3000), `pnpm test`, `pnpm typecheck`, `pnpm balance`, `pnpm assets:check`. The store only touches `localStorage` in the browser; SSR renders a fresh state and the splash.

**Adding content, step by step**

- *Hardware unit*: insert a spec into `SPECS` in `src/data/hardware.ts` at the position its `baseCost` dictates (the index is the payback rank; `hardware-data.test.ts` pins strictly increasing cost, the payback shape and a `SPEED_TIERS` table, so update the test). A tail unit needs its family in `TAIL_PAYBACK_S` or an entry in `PAYBACK_OVERRIDE_S`. Add `hw-<id>` to `assetManifest.ts` and a subject in `art-prompts.ts`. Tier upgrades are generated.
- *Model*: add a row to `MODELS` in `src/data/models.ts` following the balance notes in the file header (`baseCost ≈ 10 × 1.6^rank` by VRAM rank, `baseLikes ≈ 15 × 1.35^rank`, `payoutRatio` inside the tested band), a `vendorIcon` that exists under `src/assets/brand/vendors`, 6–10 `thumbTags`, `model-<id>` in the manifest and a card prompt. A new `family` may want a `distill-<family>` node and a `thumbFamilyFor` mapping.
- *Upgrade*: add to `UPGRADES` in `src/data/upgrades.ts` with a `category`, `effects` (conventions at the top of `derived.ts`), an `unlock` and an icon; `upgrades-data.test.ts` checks the shape.
- *Map node*: add a spec to the right lane in `src/data/mapNodes.ts` with a free `col` on that row and a parent on that lane or the core; `map.test.ts` requires an acyclic graph, every node reachable from `core-root`, unique positions. Nodes read by id go in `MARKER_IDS`.
- *Hashtag*: add `{ id, tag, keywords, kind?, family? }` to `src/data/hashtags.ts` (`id === tag`) and a matching entry in `FEED_VOCAB_FALLBACK` in `src/server/feed/normalize.ts`; `models-data.test.ts` pins the count (30).

## 13. Known gaps and ideas for next steps

Everything below was re-checked against the code as it stands. The middleware, the unbounded `feed_items` table, the silent `settings.sfx` toggle and the stray test assets in the served art index were all on this list and are all fixed; they are documented above instead.

- **`settings.autosave` has no switch.** The field is in the state, the save schema and `autosaveDue`, and `SaveStatus` has an `Autosave off` branch, but `SettingsModal` renders only the four older toggles (`sfx`, `particles`, `reducedMotion`, `projector`) and nothing anywhere calls `toggleSetting('autosave')`. It reads the value into its selector and then never uses it. So the setting is permanently true, and both the amber chip state and the "off" path through `autosaveDue` are unreachable from the game.
- **Sound has no volume control.** `sfxEngine` reads `localStorage['comfy-clicker:sfx-volume']` (default `SFX_DEFAULT_VOLUME = 0.6`) and exports `getSfxVolume`/`setSfxVolume`, but no component imports either, so the only way to change it is the console. The sfx row in Settings is a bare on/off.
- **Level arrival times are not pinned.** `level.test.ts` covers the curve's shape, the reward and the watermark, and `models-data.test.ts` covers the `minLevel` invariants, but nothing asserts *when* a player reaches a level, so a hardware or upgrade rebalance can move the whole ladder without failing a test. `pacing.test.ts` already builds the simulated state a level assertion would need.
- **Cron documentation still disagrees with `vercel.json` in one place.** `supabase/config.md` says `/api/hub/refresh` runs "every 30 min"; `vercel.json` schedules it daily at 06:30 UTC (the Hobby plan's limit). `docs/DEPLOY.md` is correct about the crons now but lists only 0001, 0003 and 0004, so `0005_hardening.sql` is missing from its apply order.
- **Leaderboard false positives**: the plausibility rule measures from `profiles.created_at`, so a long guest run adopted at first sign-in can be flagged despite the 1e6 floor and ×12 headroom. (ComfyHub's own cap has the same shape but errs the other way, with orders of magnitude of headroom, so it never clips an honest run.)
- **Client-side runtime RNG**: the store passes `Math.random` to `tick` and actions, so the engine's "same seed → same events" property holds in tests and for the offline replay only.
- **`offlineClaims` counts short gaps ≥ 60 s** even though no report is shown below `SHORT_GAP_S` (300 s), so "Comfy Sleep Mode" can still be earned by a 61-second tab switch. The mismatch is now between two numbers rather than between the store and the engine, but it is the same gap.
- **RP-priced upgrades would behave differently from RP map nodes** (`actions.spend` deducts `state.rp`, the map never does); none exist today, but the asymmetry is worth resolving before adding one.
- **ComfyHub run reporting uses `post.cost`**, which for API models includes the 1.5× surcharge; the server cap uses `jobCost` with the same surcharge, so it is consistent, but royalties are paid on the surcharge too.
- **The click guard's ring is per `GameState` object.** It lives in a `WeakMap` keyed on the state, so `replaceState` (an import, a hard reset, adopting a cloud save) starts it empty. That is the right behaviour for a fresh run and a free reset of the cadence history for anyone who imports a code mid-lockout; only the persisted lockout survives.
- Ideas from the design notes (`.tmp/design-art.md`) not yet built: late-game auto-posting (App Mode / ComfyHub automation), noodles wired between hero → rack → studio → feed, milestone light sweeps, a mobile drawer layout (`smooth-drawer` is vendored and still unused), Lighthouse pass (the one item `.tmp/TASKS.md` still lists as remaining alongside the Supabase auth URL settings).
