# Comfy Clicker: how it works

An end-to-end explainer of the codebase for the project owner. Every number, path and table name below is taken from the files as they are today; where a value lives in a constant or a data row, the current value is quoted. Paths are relative to the repository root.

## 1. What the game is

Comfy Clicker is an incremental ("idle") game skinned as the life of a ComfyUI creator. The single currency is **credits**. You earn them three ways:

- **Clicking Generate** (the Comfy logo on the left). One click is one `store.click()` and pays `derived.clickValue`, which starts at 1.
- **Owning hardware.** Every rig in `src/data/hardware.ts` has a `baseCps`; the rack's credits-per-second (`derived.cps`) accrues every 50 ms tick.
- **Posting.** In the Studio you pay a job cost to render a prompt with a real model (SD 1.5, FLUX, Wan 2.2, LTX-2…). The job runs on your best owned card, becomes a post in the feed, collects likes over 8 seconds, and every like pays credits back.

The fantasy is "you are a ComfyUI person with a GPU problem": you start on a 4c/8t office PC running SD 1.5 on `--cpu`, buy a used 3060, a 4090 with a sagging connector, an RTX PRO 6000, 8×H100 cloud nodes, then Comfy Cloud regions, an orbital datacenter and a Dyson swarm. Models are gated by **VRAM** (your best owned card must hold the weights, or you quantize to FP8/Q4), by **backend** (CPU boxes only run `cpuOk` models, Apple silicon only `mpsOk` images, AMD needs ROCm and sometimes ZLUDA), and API models need the API Nodes graph node and pay a 50 % surcharge. Every unit draws watts; exceed the power budget and income is throttled proportionally.

What makes it not Cookie Clicker:

- **Two coupled loops, one currency.** The rack is passive income; the Studio is an active, positive-EV bet whose expected return is fixed by design at roughly 1.23 × `payoutRatio` of the job cost (see §4). Reach (trending tags, audience, likes multipliers) moves *likes*, and likes move followers → Comfy Cloud signups → Research Points, which multiply everything. Credits never inflate through reach.
- **Real-world trending.** Three hashtags trend every in-game "week" (10 minutes). When the server can reach the real ComfyUI community (X, LinkedIn, Reddit, HN, blog, GitHub releases, the node registry, YouTube), the trio is derived from what people are actually posting; otherwise it is a deterministic function of the week index.
- **A skill tree drawn as a ComfyUI workflow** (The Graph, `/map`), a **prestige loop** called Rebrand that banks Comfy Points, and **ComfyHub** (`/hub`), where signed-in players publish workflow recipes that other players run for royalties and rep.
- **The engine is pure TypeScript with no React**, driven by a catalog of data tables, unit-tested (26 test files) and paced by a simulator that the tests assert against.

## 2. Repository map

| Path | What lives there |
|---|---|
| `src/game/` | The engine: types, constants, tick, actions, derived stats, save/load, every formula. No React, no DOM. |
| `src/data/` | Balance data: hardware ladder, models, precisions, upgrades, map nodes, achievements, hashtags, contracts, events, flavor text, the asset manifest, `assetIndex.json`, the founder-post seed. May import only `@/game/types` and `@/game/constants`. |
| `src/state/` | The framework-agnostic `GameStore` singleton, React binding hooks, cloud-save sync, server-driven actions. |
| `src/components/` | All UI, by area: `layout`, `hero`, `store`, `studio`, `feed`, `rigs`, `map`, `hub`, `auth`, `overlays`, `fx`, `common`, `brand`, `kokonutui` (vendored Kokonut UI components), `ui` (shadcn base). |
| `src/app/` | Next.js App Router: `/` (`page.tsx` → `GameShell`), `/map`, `/hub`, `/leaderboard`, `/auth/callback`, `not-found.tsx`, and every `api/**/route.ts`. |
| `src/server/` | Server-only code: the live feed pipeline (`feed/`), Supabase clients and env (`supabase/`), ComfyHub (`hub.ts`), the leaderboard read model (`leaderboard.ts`). |
| `src/hooks/` | `useHotkeys`, `useEasterEggs`, `useNow`. |
| `src/assets/brand/` | SVGs copied from ComfyUI_frontend (logo, credits icon, vendor and node icons) via `scripts/copy-brand-assets.sh`. |
| `public/brand/`, `public/art/`, `public/fonts/` | Served brand SVGs, generated art (webp/mp4), Inter. |
| `scripts/` | `balance.ts` (pacing simulator), `art-prompts.ts`, `art-collect.mjs`, `art-postprocess.mjs`, `check-assets.ts`, `backdate-commit.mjs`, `copy-brand-assets.sh`. |
| `supabase/migrations/` | `0001_init.sql`, `0002_feed_cron.sql`, `0003_hub_integrity.sql`; `supabase/config.md` documents applying them. |
| `docs/` | `UI-SPEC.md`, `DEPLOY.md`, this file. |
| `art-src/`, `.tmp/` | Raw MCP art outputs and session scratch; both are gitignored and Vercel-ignored (`.vercelignore`). |

### The three contracts

- `src/game/CONTRACT.md` is the engine contract: the module list, every exported function's signature and semantics, the effect-folding conventions and the required tests. It states the two documented exceptions to "data enters through a `Catalog` argument": `save.ts` defaults to `CATALOG` and the RP/CP helpers in `map.ts` default to `MAP_NODES`.
- `docs/UI-SPEC.md` is the UI contract: state access (`useGame(selector, equals?)`, `useGameShallow`, `useGameStore`, `useGameLifecycle`, `useGameEvents`), the visual language (ComfyUI palette, slot-colour stripes, rounded-square radius 0.354), the three-column layout, the FX layer, performance rules and the Kokonut component list.
- `docs/DEPLOY.md` is the ops contract: Vercel env vars, Supabase auth settings, the smoke test.

### How balance is separated from logic

`src/data/index.ts` assembles a `Catalog` (`hardware, models, precisions, upgrades, mapNodes, achievements, hashtags, contracts, events`). Every engine function takes the catalog as an argument (`buildIndex(catalog)` in `src/game/catalog.ts` memoises id maps per catalog object in a `WeakMap`), so tests pass tiny fixtures via `createCatalog({...})`. The boundary is enforced by `src/game/__tests__/data-boundaries.test.ts`, which scans imports in both directions.

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
| `stats` | posts, videos, flops, virals, quantizations, offlineClaims, rebrands, contractsDone, hubPublished, hubRuns, lorasTrained, bestPostLikes, lastPrompt, lastPostKey, bestCps, clicksWindow. |
| `settings` | `sfx, particles, reducedMotion, projector` (all booleans). |
| `flags` | Discovery flags (`konami`, `spaghetti`, `speedrun`, `sparkNext`…). |
| `weekOverride` | Pin the trending week for demos; `null` = live. |
| `liveTrending` | `{ tags, fetchedAt }` pushed by the feed client; trusted for `LIVE_TRENDING_TTL_MS` (30 min). |

### Derived (`src/game/derived.ts`)

Recomputed only when something structural changes, never per tick. `activeEffects` gathers `Effect`s from owned upgrades, reached hardware tiers (virtual `tier:<hw>:<n>` upgrades, each `rigMult ×2`), unlocked map nodes and running events, then folds them:

- `rawCps = Σ count × baseCps × rigMult[id] × familyMult[family]`
- `cpMult = 1 + CP_MULT_PER_POINT (0.02) × cp × Π cpMult effects`
- `globalMult = Π(1 + globalMult) × (1 + RP_MULT_PER_POINT (0.01) × rp) × (1 + ACHIEVEMENT_MULT (0.01) × achievements) × cpMult`
- `cps = rawCps × globalMult × throttleMult(powerDraw, powerBudget)`
- `clickValue = (1 + clickFlat) × Π clickMult × globalMult + clickCpsPct × cps`
- `bestVram`, `bestTier`, `bestHardwareId` (highest `speedScore`, ties → VRAM → price), `hasGpu`
- `concurrency = 1 + Σ`, `speedMult = Π`, `likesMult = Π`, `payoutBonus = Σ payoutRatio`, `followRate = 0.05 × Π`, `viralChance = 0.05 + Σ`, `flopChance = max(0.02, 0.15 − Σ)`, `offlineCapHours = 8 + Σ`, `offlineEfficiency = max(0.5, effects)`, `weekSpeed = Π`
- flags `zluda, apiNodes, hashtagResearch, streakGrace, reservedCapacity`; `unlockedFamilies` (everything except `amd-consumer`, which needs an `unlockFamily` effect); `tagLikes` (LoRAs add `LORA_TAG_LIKES = 0.25` on their tag), `familyGenTime`, `coolingTier`.

### The loop (`src/game/loop.ts`)

`startLoop({ tick, render, onLongGap })` runs on `requestAnimationFrame`, accumulates wall-clock time and drains it in fixed `STEP_S = 0.05` s slices (20 Hz), stamping each step with the wall time at which it ends. A frame gap above `MAX_CATCHUP_S = 5` s is not simulated; it is handed to `onLongGap`, and the store answers with `applyOffline`. The next frame is requested in a `finally`, so a throwing listener cannot stop income. Outside a browser `startLoop` is a no-op.

### A tick (`src/game/engine.ts`)

`tick(state, derived, catalog, dtSec, now, rng)` does, in order: (1) `addCredits(cps × dt)` and `playedSec += dt`; (2) `advanceQueue` (finish due jobs into posts, start pending ones up to `concurrency`) then `settlePosts` (pay newly arrived likes, grant completed posts); (3) `expireEvents`, `maybeStartEvent`; (4) `progressContracts` on this tick's events and `rotateContracts` when `contractsDue`; (5) `checkAchievements` once per whole played second; (6) trending-week rollover detection → `weekRollover`; (7) power-of-ten cps milestones → `milestone`; (8) breaker flip → `powerThrottle`; then `lastTickAt = now`. Per-state bookkeeping (last week, last throttle flag) lives in a `WeakMap`, not the save. `DERIVED_EVENT_TYPES` (`purchase, upgrade, mapUnlock, achievement, eventStart, eventEnd, signup, rebrand, daily`) tells the store when to recompute `Derived`; `GameStore.tick` uses `needsDerived(events)`.

### Actions and `ActionContext` (`src/game/actions.ts`)

Every action is `(ctx: ActionContext, ...args) => ActionResult` with `ctx = { state, derived, catalog, now, rng }` and `ActionResult = { events, dirty, error? }`. Validation failures return `{ events: [], dirty: false, error }` and leave the state untouched; `dirty` makes the store recompute `Derived`. `GameStore.run(fn)` snapshots one context per call so `now` and `rng` are consistent inside an action. The actions: `click`, `buyHardware(id, 1|10|100|'max')`, `buyUpgrade`, `unlockMapNode`, `quantize`, `setupModel`, `trainLora`, `queueJob`, `claimContract`, `claimDaily`, `rebrand`, `resolveEvent`, `toggleSetting`, `setFlag` (UI discovery flags, idempotent, emits `easterEgg`), `upscalePost`. Server-driven actions (`claimDailyFromServer`, `markDailyClaimed`, `recordHubPublish`, `applyHubRoyalties`) follow the same contract from `src/state/cloudActions.ts`.

### Events emitted to the UI

`GameEvent` (types.ts): `click, purchase, upgrade, mapUnlock, jobStarted, postCreated, postResolved{viral,flop}, achievement, offline{gain,elapsedSec}, contractDone, eventStart, eventEnd, daily{day,credits}, rebrand{cp}, powerThrottle{on}, signup{total}, weekRollover{tags}, easterEgg{id}, milestone{cps}`. The store fans them out through `onEvent`; React consumes them with `useGameEvents`.

### Save format, migrations, export (`src/game/save.ts`)

`serialize` is `JSON.stringify({...state, v: SAVE_VERSION})`, stored under `SAVE_KEY = 'comfy-clicker:save'`, autosaved every `AUTOSAVE_MS = 10 000` ms and on `visibilitychange`/`pagehide`. `loadSave(raw, now, guestId)` runs `MIGRATIONS[n]` up to `SAVE_VERSION` (only `0 → 1`, which stamps `v`), validates with a forgiving Zod `saveSchema` (unknown keys stripped, invalid fields fall back to fresh-state values, arrays and records drop only broken entries), then `hydrate` drops ids the catalog no longer knows, normalises jobs, pulls timestamps from a clock that ran ahead back to `now`, and guarantees the starter PC and SD 1.5. Only an unparseable blob is corrupt; the store stashes it under `SAVE_CORRUPT_KEY` (`comfy-clicker:save.corrupt`). Export codes are `'CC1|' + base64(utf8 json)` (`exportString`/`importString`, which also accepts raw JSON).

### Offline progress (`src/game/offline.ts`)

`applyOffline` runs on `start()` and on every long gap. `elapsed = (now − lastTickAt)/1000`. If `elapsed ≤ SHORT_GAP_S` (300 s) the gain is `cps × elapsed` at full rate with no report (the short-gap rule: a tab switch never shows the welcome-back card). Otherwise `paidSec = min(elapsed, offlineCapHours × 3600)` and `gain = cps × paidSec × offlineEfficiency` (base cap 8 h, base efficiency 0.5; `Comfy Cloud: Always On` raises efficiency to 1 and the cap by 8 h; map nodes push the cap to 48 h). Then `replayQueue` finishes jobs at their real end times with a deterministic RNG seeded from `guestId|lastTickAt|now`, `settlePosts` pays them out, `progressContracts` credits them, `offlineClaims` increments when `elapsed ≥ 60`, a `weekRollover` is announced once if the week changed, `primeTickMemo` keeps the next tick quiet about it, and `checkAchievements` runs. The store shows the WelcomeBack modal only when `elapsedSec ≥ 60 && gain > 0`.

## 4. The economy, with the real numbers

### Click value

Base 1 credit. `src/data/upgrades.ts` click category: Better Prompts +1 flat (100 credits, after 10 clicks), Batch Size 2/4/8 each ×2 (1 000 / 10 000 / 100 000 credits at 300 / 1 500 / 5 000 clicks), Comfy Desktop +1 % of cps per click and +4 h offline cap (100 000, 3 000 clicks), Ctrl+Enter +2 % (1 000 000, 10 000 clicks), Queue Front +4 % (10 000 000, 20 000 clicks). Graph: `core-readme` and `core-paste` ×1.25 each, `core-templates` and `core-linear` +1 % cps each, `prestige-muscle-memory` ×2. A click also shaves `CLICK_JOB_BONUS_MS = 150` ms off the earliest running job, up to `CLICK_JOB_BONUS_CAP = 0.5` of its duration.

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

`powerDraw = Σ count × watts`; `powerBudget = POWER_BUDGET_BASE (650 W) + Σ powerBudget effects`; `throttleMult = draw > budget ? budget / draw : 1` (`src/game/power.ts`), proportional, so past the breaker a unit only helps if its cps/W beats the rack's average. Budget comes from the six power upgrades (850 W PSU +300 W for 200 credits up to Fusion Reactor +200 MW for 30 000 000) and the Graph's infra lane (Undervolt +200 W for 5 000 up to Orbital Solar +1 GW for 2e9, plus Antarctic Datacenter +1 MW). Cooling upgrades and nodes add `coolingTier` (+1 speed tier per family). The `powerSurge` event subtracts 40 % of the rig's own budget.

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

- **M**: with `viralChance` (base 0.05) → `uniform(3, 8)` viral; else with `flopChance` (base 0.15) → `uniform(0.3, 0.6)` flop; else `uniform(0.85, 1.35)`. E[M] ≈ 1.23.
- **trend** = `trendMult(matched, trending, keywordHits, kind)` (`src/game/hashtags.ts`): matched trending tags hottest first get `1 + TRENDING_WEIGHTS[rank]` with weights `[1.0, 0.4]` (one match 2.0, two 2.4); more than `MAX_MATCHED_TRENDING = 2` matched → flat 1.0 (the spam rule); a trending type tag (`#videogen`, `#3dgen`, `#musicgen`) whose kind matches the post adds `TYPE_TAG_BONUS = 0.2` without using a slot; plus `EXTRA_KEYWORD_BONUS = 0.1` per distinct keyword hit up to `MAX_EXTRA_KEYWORDS = 3`. A repost (same model, matched tags and normalised prompt as the previous post, `repostKey`) multiplies trend by `REPOST_PENALTY = 0.5`.
- **audience** = `1 + log10(1 + followers / AUDIENCE_REF_DIVISOR (50))`; **tagBonus** = Π(1 + tagLikes[tag]) × (1 + `FAMILY_AFFINITY_BONUS` 0.1 when a matched tag's `family` equals the model family); **eventBoost** = ×3 during a founder repost and ×3 once for a caught spark; **founder** = ×3 with `FOUNDER_BOOST_CHANCE = 0.02` or, once per save, when the prompt name-drops `yoland*`, `robin`, `robinjhuang` or `comfyanonymous`; **hubMult** = `HUB_RUN_LIKES_BOOST = 1.15` for a job run from a ComfyHub recipe.
- `targetLikes = max(1, round(M × trend × quality × baseLikes × audience × likesMult × tagBonus × eventBoost × founder × hubMult))`.
- **Credits follow the roll, not the reach**: `credits = (payoutRatio + payoutBonus) × paid × M × quality`, where `paid = job.cost / 1.5` for API models; `creditsPerLike = credits / targetLikes`, so the card's `likes × credits/like = credits` identity always holds. Untagged native EV/cost ≈ 1.23 × payoutRatio regardless of upgrades; the virality test pins EV bands of [1.05, 1.6] for local models and [0.95, 1.1] net of surcharge for API models over 20 k rolls.
- Likes arrive over `POST_WINDOW_MS = 8 000` ms as `likesAt = floor(targetLikes × (1 − (1 − p)³))`; `settlePosts` pays `(newLikes − likes) × creditsPerLike` per tick and, when complete, grants followers `targetLikes × followRate × (viral ? 3 : 1)`, updates stats, sets `granted` and emits `postResolved`. `upscalePost` costs 30 % of the post's original cost for +40 % likes at the same credits/like (refused on flops).

### Followers, signups, RP (`src/game/social.ts`)

`addFollowers` banks fractions; each time `lifetimeFollowers` crosses `signupThreshold(k)` (`SIGNUP_THRESHOLDS = [0, 100, 250, 500, 1 000, 2 500, 5 000, 10 000, 25 000, 50 000, 100 000]`, then ×`SIGNUP_GROWTH = 2` per step), one Comfy Cloud signup happens and `rp += 1`. RP raises `globalMult` by 1 % per point forever; spending RP on the Graph never deducts it (`rpAvailable = rp − rpSpent(nodes)`).

### Contracts (`src/game/contracts.ts`, `src/data/contracts.ts`)

30 contracts across seven goal types (`posts` plain/by kind/by tag, `likes`, `followers`, `ownHardware`, `clicks`, `quantize`, `virals`). `CONTRACT_SLOTS = 3` stay filled by weighted pick among defs whose `minTier ≤ derived.bestTier` and that are not already active or already satisfied. Reward = `max(100, rewardSecs × cps)` at acceptance, plus optional `rewardRp`/`rewardCp`. An unfinished contract expires `CONTRACT_ROTATE_MS = 30 min` after acceptance; a done one waits to be claimed; a claim sets `nextRotateAt = 0` for an immediate refill; an unfillable slot retries after 60 s. Examples: "Wedding Slideshow" (5 posts, 300 s, tier 1), "Kontext Friday" (10 posts tagged `fluxkontext`, 720 s, tier 3), "Global Campaign" (2 000 000 likes, 3 600 s, +1 CP, tier 9).

### Random events (`src/game/events.ts`, `src/data/events.ts`)

One event rolls every `uniform(3, 8)` minutes, weighted among defs with `minTier ≤ bestTier` whose kind is not already running. Durations (`EVENT_DURATION_S`): modelDrop 300 s (`tagLikes +1.0` on a random subject tag), nodeBroke 120 s (`globalMult −0.5` until the player clicks Fix), founderRepost 60 s (×3 likes), spotReclaim 60 s (a cloud node's `rigMult` → 0 unless `reservedCapacity`), powerSurge 90 s (budget −40 %), trendingSpark 8 s (catch it → `flags.sparkNext` → ×3 likes on the next post), cloudPromo 77 s (`globalMult +1`). Ten defs, e.g. `ev-cloud-promo` weight 1 minTier 5, `ev-spot-reclaim` weight 2 minTier 8.

### Daily bonus (`src/game/daily.ts`)

UTC day keys. Streak continues if the last claim was yesterday (or two days ago with `streakGrace`), else restarts at 1. Day `n` of a 7-day cycle pays `max(DAILY_MIN_CREDITS (50), cps × DAILY_BASE_SECS (600) × n)`; day 3 adds 1 RP, day 7 adds 1 CP.

### Rebrand / prestige (`src/game/prestige.ts`)

Available once you own any `cloud-node` or `region`. `rebrandCp = floor((seasonCredits / 1e8) ^ 0.45)` (1e8 → 1 CP, 1e10 → 7, 1e12 → 63); `creditsForCp` inverts it. Each CP is +2 % income forever (`cpMult`, further multiplied by the five Season Income nodes ×1.1 each). **Resets**: credits, seasonCredits, hardware (back to the starter PC plus any `startHardware` effects: a 4090, a PRO 6000, an H100 from prestige nodes), hardwareTiers, credit-bought upgrades, models (SD 1.5 kept), queue, posts, followers and followersFrac, contracts, events, `lastPostKey`. **Kept**: achievements, every map node, rp, cp, cpSpent, loras, hubRep, daily, flags, lifetime followers/likes/signups, lifetime stats. `season += 1`, `stats.rebrands += 1`.

### Achievements (`src/data/achievements.ts`)

84 achievements, 12 hidden; each adds `ACHIEVEMENT_MULT = 0.01` to `globalMult`. `checkAchievements` runs once per played second and cascades up to 4 passes so "Achievement Achieved" (25 achievements) lands in the same call. Conditions use the shared `UnlockCond` language (`stat`, `ownHardware`, `ownFamily`, `ownModel`, `precision`, `mapNode`, `upgrade`, `cps`, `flag`, `all`, `any`).

### The pacing simulator (`scripts/balance.ts`, `src/game/__tests__/pacing.test.ts`)

`simulate(strategy, seconds)` replays a greedy buyer against the shipped ladder using the game's own `unitCost`, `throttleMult` and `creditsForCp`, with a modelled click schedule (3/s for 3 min, 2/s to 10 min, 1/s to 30 min, then 0.5/s), a +30 % content bonus after 3 minutes, global +10 % upgrades at lifetime 1e3…1e9, tier upgrades, and the power ladder (a unit that would trip the breaker is also offered bundled with the PSU steps needed). `naive` buys the best affordable payback every second; `climb` saves for the best payback reachable within 45 s of income. `projectWeek` runs 7 days of one active hour plus 12 offline hours (capped at 8 h × 50 %). The tests pin: 3060 < 3 min, 4090 < 8 min, PRO 6000 < 15 min, a cloud node < 25 min (climb); first purchases in ladder order and through the workstation on-ramp; AMD never bought without ROCm; no region inside 3 h of continuous play but a Runpod 8×B300 pod owned; the orbital datacenter and Dyson swarm beyond a one-hour-a-day week while `region-us-east` lands after day 1; naive slower than climb at every milestone and forced to buy power once the breaker trips. `pnpm balance` prints the tables.

## 5. The UI

### App structure

`src/app/layout.tsx` wraps everything in `GameProvider`, whose `useGameLifecycle` calls `store.start()` once; the store is a module singleton (`getGameStore()` in `src/state/store.ts`), so income keeps ticking on `/map`, `/hub` and `/leaderboard`. `/` renders `GameShell` (`src/components/layout/GameShell.tsx`): a 350–600 ms splash with rotating `LOADING_LINES`, then `Header` (64 px), `NewsTicker` (32 px), the three-column `Workbench` (`minmax(320px,1fr) | minmax(0,2fr) | minmax(300px,1fr)`), `FxCanvas` and `Overlays`, all inside `FeedProvider`. Left column: `HeroPanel` (GenerateButton, counter, combo meter with `COMBO_GAP_MS = 400`), `FlagshipRig`, `PowerMeter`, `QueueMini`. Centre: `RackPanel` plus `CenterTabs` (Studio | Feed | Contracts, persisted in `localStorage['comfy-clicker:center-tab']`) with `TrendingStrip` above Studio and Feed. Right: `StorePanel` (Hardware | Upgrades | Models | Power, persisted under `comfy-clicker:store-tab`). `/map` mounts `GraphMap` under its own header; `/hub` and `/leaderboard` reuse `Header` and `Overlays`.

### The external store and selectors (why)

`GameStore` mutates `state` in place, bumps a monotonic `version` in a microtask (`notify`) and exposes `subscribe`/`getVersion`. `useGame(selector, equals)` (`src/state/useGame.ts`) binds through `useSyncExternalStore`: the selector runs on every version bump (≈20 Hz) but the cached value is returned unless `equals` says the slice changed, so a component re-renders only when its slice does. `useGameShallow` compares small objects key by key. The performance rules in `UI-SPEC.md` follow from this: selectors return primitives or `|`-joined id strings (`usePostIds`, `useMapSets`, `eventKey`), lists memoise rows by id, `content-visibility: auto` on long lists, feed capped at 60 cards, no `Date.now()` in render (countdowns use `useNow(250)`), and no mapping over `state.posts` inside the 20 Hz counter.

### FX canvas (`src/components/fx/FxCanvas.tsx`, `fxBus.ts`)

One full-viewport `<canvas>` (`z-50`, pointer-events none, DPR ≤ 2) with plain arrays for sprites (diamonds, rain, confetti; `MAX_SPRITES = 300`), floating texts (`MAX_FLOATS = 80`) and flashes. The credits glyph is rasterised once to an offscreen canvas at 12 px amber. Rain density is `clamp(log10(cps + 1) × 8, 0, 60)` sprites in the left 30 % of the viewport at 25 % alpha. Components talk to it through `fx.floatText / burst / confetti / flash / rain` on a tiny pub/sub; engine events map to `postResolved viral → confetti`, `achievement → electric flash`, `milestone → amber flash`, `easterEgg → confetti`. Paused when `document.hidden`; disabled by `settings.particles = false`, `settings.reducedMotion` or the OS preference.

### Hotkeys (`src/hooks/useHotkeys.ts`)

`Space` → one Generate click (ignored in inputs and on focused buttons unless they carry `data-generate-hotkey`; never repeats while held), `S` → `store.save()` + `comfy:saved` toast, `Esc` → `comfy:close-modals`. The Graph adds `/` (search), Enter, Esc, `+`/`-`, `0` (fit all), `F` (fit the frontier).

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

### Overlays and the event bus

`Overlays` (`src/components/overlays/Overlays.tsx`) mounts `AchievementToast` (headless bridge from engine events to toasts), `EventBanner` (bottom-centre stack, collapses to a pill after 6 s), `TrendingSpark`, `EasterEggs`, `WelcomeBackModal`, the four modals and `ToastHost` (`TOAST_MAX_VISIBLE = 4`, 5 s). Window `CustomEvent`s used across the UI: `comfy:open-modal` (detail `settings | stats | daily | rebrand | auth | hub-publish`), `comfy:close-modals`, `comfy:saved`, `comfy:cloud-merge`, `comfy:store-tab`, `comfy:center-tab`, `comfy:pick-hashtag`, `comfy:studio-load`, `comfy:hub-changed`, `comfy:hub-run-recorded`, `comfy:hub-royalties`, `comfy:auth-tab`. Settings offers export/import codes, hard reset (hold 2 s) and the four toggles; `projector` and `reducedMotion` are mirrored onto `<html>` classes.

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

Dedupe by id, collapse whitespace, clamp text to 600 chars, drop adult-content text, ISO dates (fallback `now`), non-negative integer likes, `verified` for official handles (`OFFICIAL_HANDLES`), and tag by keyword: a compiled regex per vocabulary entry (word-bounded keywords plus literal `#tag`), hits capped at 5 per tag, at most 6 tags per item. The vocabulary is the game's 30 hashtag ids with feed-tuned keywords (`FEED_VOCAB_FALLBACK` wins where both define an id).

### Trending derivation (`trending.ts`)

Over social items from the last 14 days (`TRENDING_WINDOW_DAYS`), each item weighs `1 + ln(1 + likes)`; score per tag = Σ hits × weight; tags present on more than 70 % of items are background and skipped; `comfyui` is always excluded; fewer than 5 items → `[]`. The top 3 are returned with at least one non-type tag guaranteed.

### The store (`store.ts`): DB → memory → seed

`readFeed()` tries Supabase (`feed_items` newest 120, latest `trending_tags` row, `feed_meta['feed']`), then a process-memory cache, then the committed seed; every snapshot is topped up with the seed. `stale` is true past `FEED_TTL_MS = 15 min`. `refreshFeed()` coalesces concurrent callers, runs `collectFeed`, upserts `feed_items` in batches of 100, inserts a `trending_tags` row and upserts `feed_meta`.

### Routes and auth

- `GET /api/feed` returns the snapshot and, when stale, schedules `refreshFeed` with Next's `after()` so callers never wait on the network (lazy refresh). Cache `s-maxage=60`.
- `GET /api/trending` returns `{ tags, updatedAt, origin }`.
- `GET|POST /api/feed/refresh` requires `Authorization: Bearer $CRON_SECRET` (`isCronAuthorized` in `src/server/supabase/env.ts`, constant-time compare; closed when the secret is unset). Scheduled by `vercel.json` daily at 06:00 UTC and, optionally, by `0002_feed_cron.sql` every 15 minutes through `pg_cron` + `pg_net`.

### How trending reaches the game

`src/components/feed/feedClient.ts` polls `/api/feed` every 10 minutes (and on tab return) and, when the payload carries exactly `TRENDING_COUNT = 3` tags, calls `store.setLiveTrending(tags)`. `currentTrending(state, now, catalog, weekSpeed)` uses `liveTrending.tags` while `now − fetchedAt < 30 min`, otherwise the deterministic board: `weekIndex = floor(now / (WEEK_MS / weekSpeed))` with `WEEK_MS = 10 min`, and `trendingForWeek` picks 3 distinct ids by a partial Fisher–Yates shuffle seeded with `mulberry32(week)`. The `Fast Weeks` prestige node sets `weekSpeed = 2`. The TrendingStrip shows a live/seeded/pinned marker and a countdown ring to `msUntilRollover`.

## 7. Accounts and cloud saves

**Guest mode** is the default: the save lives in `localStorage` under `comfy-clicker:save`, the guest id under `comfy-clicker:guest`. Without `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` (`hasSupabase()` false) auth status is `unavailable` and every cloud action returns a friendly error.

**Auth** (`src/components/auth/useAuth.ts`): email + password through the cookie-backed browser client (`@supabase/ssr`), one `onAuthStateChange` subscription, a `profiles.handle` lookup after sign-in. Sign-up redirects confirmation links to `/auth/callback`, which exchanges a PKCE `code` or verifies a `token_hash` and bounces to `next` with `?auth=ok|error`. A trigger creates the `profiles` row with `handle = 'comfy-' || left(id, 6)`.

**Cloud saves** (`src/state/persistence.ts`): the local autosave is always written first; the cloud row (`saves`) is a copy carrying `version, state, cps, lifetime_credits, followers, season, saved_at`. On sign-in: no row → upload; the row is this device's last upload (a `localStorage['comfy-clicker:cloud']` receipt with the same `saved_at`) → upload; the local run is fresh (`lifetimeCredits < 500 && playedSec < 120 && totalClicks < 50 && season === 1`) → adopt the cloud save silently; both real and different → `comfy:cloud-merge` opens `CloudMergeModal` with the higher-lifetime side preselected. Adopting runs `applyOffline` from the cloud's `lastTickAt`. Afterwards uploads happen every `CLOUD_SYNC_MS = 60 s` while a fingerprint changes and on hide/unload. **Conditional updates**: every `update` is `.eq('saved_at', cloudSavedAt)`; zero rows written means another device wrote in between, so the row is re-read and either silently re-based (same run within 5 s of income) or the merge question is asked again.

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
4. *Royalty*: when that post resolves, `ensureHubRoyaltyBridge` POSTs `{ workflowId, creditsPaid: post.cost }` to `/api/hub/run`. The server rate-limits `HUB_RUNS_PER_MINUTE = 40` per runner, clamps `creditsPaid` to `runCostCap` (the game's `jobCost` at the runner's last uploaded `cps × HUB_CPS_HEADROOM (4)`), computes `royalty = round(paid × 0.05)` (0 on self-runs) and `rep = 1 + floor(log10(1 + royalty))`, and inserts the run; the `hub_runs_after_insert` trigger bumps all four counters atomically.
5. *Collect*: the author's game polls `POST /api/hub/royalties` on sign-in, every `HUB_ROYALTY_POLL_MS = 120 s` and on tab return; `claim_hub_royalties(author)` marks unclaimed runs and returns `{ runs, royalty, rep }`, applied through `applyHubRoyalties` (credits via `addCredits`, `hubRep`, `stats.hubRuns`).

**Refresh**: `refresh_hub_runs_24h()` recomputes the rolling window; called by `GET /api/hub/refresh` (cron-authorised, `vercel.json` daily 06:30 UTC) and by the `comfy-clicker-hub-runs-24h` pg_cron job every 15 minutes when the extension is installed.

## 10. Database

All tables have RLS enabled; "service role only" means no anon/authenticated policy exists.

| Table / view | Columns | Read | Write |
|---|---|---|---|
| `profiles` | `id (uuid, → auth.users)`, `handle` (unique, `^[a-z0-9][a-z0-9_-]{2,31}$`), `avatar_seed`, `created_at` | everyone | owner insert/update |
| `saves` | `user_id` (pk), `version`, `state` (jsonb), `cps`, `lifetime_credits`, `followers`, `season`, `saved_at`; index on `lifetime_credits desc` | owner | owner insert/update/delete |
| `daily_logins` | `(user_id, day)` pk, `streak ≥ 1` | owner | service role only (0003 dropped owner insert/update) |
| `hub_workflows` | `id`, `author_id`, `name`, `model_id`, `precision ∈ native/fp8/q4`, `lora_tag`, `upscaler`, `hashtags text[] ≤ 8`, `runs_24h`, `runs_total`, `rep`, `royalties_total`, `created_at`; indexes on author, `runs_24h desc`, `created_at desc`, GIN on hashtags | everyone | author insert/update/delete; counters server-owned by trigger |
| `hub_runs` | `id`, `workflow_id`, `runner_id`, `credits_paid`, `royalty`, `rep`, `claimed_at`, `created_at`; partial index on unclaimed | everyone | service role only (0003 dropped runner insert) |
| `feed_items` | `id text` pk, `source`, `author`, `handle`, `avatar_url`, `url`, `text`, `date`, `likes`, `media_url`, `tags text[]`, `verified`, `fetched_at` | everyone | service role |
| `trending_tags` | `id serial`, `tags text[]`, `computed_at` | everyone | service role |
| `feed_meta` | `key` pk, `updated_at`, `errors jsonb` | everyone | service role |
| `leaderboard` (view, `security_invoker = false`) | `user_id, handle, cps, lifetime_credits, followers, season`: top 100 by lifetime credits; never exposes `state` | everyone | none |

**Functions and triggers**: `handle_new_user()` (security definer, `search_path = ''`) on `auth.users` insert creates the profile, retrying with longer uuid prefixes on handle collision; `hub_workflows_protect_counters()` (before update) restores the four counters when `auth.role()` is `authenticated`/`anon` and `pg_trigger_depth() ≤ 1`; `hub_runs_after_insert()` (security definer, after insert) bumps `runs_total`, `runs_24h`, `royalties_total`, `rep`; `refresh_hub_runs_24h()` recomputes `runs_24h` from the last 24 h (service role only); `claim_hub_royalties(uuid)` marks and sums the author's unclaimed runs from other players (service role only).

**Migrations**: `0001_init.sql` creates every table, policy, grant, the view, the first three functions and triggers. `0002_feed_cron.sql` (optional, placeholders `__DEPLOY_URL__`/`__CRON_SECRET__`) installs `pg_cron` + `pg_net` and schedules `comfy-clicker-feed-refresh` every 15 minutes to POST `/api/feed/refresh`. `0003_hub_integrity.sql` adds `hub_runs.rep`, `hub_runs.claimed_at`, `hub_workflows.royalties_total` (backfilled), drops the runner-insert and daily owner-write policies, upgrades the two hub triggers, adds `claim_hub_royalties`, and schedules `comfy-clicker-hub-runs-24h` every 15 minutes when `pg_cron` is present. `src/server/supabase/__tests__/schema.test.ts` checks the SQL text of 0001 (RLS on every table, policies present, no destructive statements, view shape, `search_path` pinned).

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

Workflow: `pnpm tsx scripts/art-prompts.ts [category]` prints the batch JSON; submit it through the MCP (the session's batch files live in `.tmp/batch-*.json`); save `get_batch_output` to a file and run `node scripts/art-collect.mjs <output.json>` to download each labelled result into `art-src/<category>/<id>.<ext>` (category from the label prefix; concurrency 4, `--force` to overwrite); then `pnpm art:post` (`scripts/art-postprocess.mjs`) resizes with sharp per category (`SIZES`: hardware 256, models 352×528 cover, ui 1024, badges 192, avatars 160, thumbs 512, map 128; webp quality 84 / alpha 90), re-encodes `.mp4` with ffmpeg when present (640 px wide, muted, libx264 crf 30, faststart; plain copy otherwise), optionally slices sprite sheets from `art-src/sheets/<sheet>.png + .json`, and rewrites `src/data/assetIndex.json` with every file under `public/art/`. `pnpm assets:check` (`scripts/check-assets.ts`) lists what is still missing (`--list` for ids). The current index holds 157 files: all 155 manifest assets plus two `tests/hw-rtx-4090-*.webp` experiments. **To add an asset**: add the id to the manifest, a subject line to the matching map in `art-prompts.ts`, generate, collect, post-process. **To regenerate**: delete the file in `art-src/`, re-submit that id, collect with `--force`, post-process.

## 12. Operations

**Scripts** (`package.json`): `dev`, `build`, `start`, `lint` (eslint), `test` (`vitest run`; two projects: node for game/data/server/scripts, jsdom for `src/components`), `test:watch`, `typecheck`, `assets:check`, `art:post`, `balance`, `commit` (`node scripts/backdate-commit.mjs`).

**Env vars** (`.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`; server only, the admin module throws if bundled for the browser), `CRON_SECRET`; `GITHUB_TOKEN` is read by the GitHub source but not listed. All optional: without Supabase the game is guest-only.

**Vercel**: `vercel.json` schedules `/api/feed/refresh` at `0 6 * * *` and `/api/hub/refresh` at `30 6 * * *`, once a day each, the Hobby plan's cron limit; Vercel adds the `Authorization: Bearer $CRON_SECRET` header. Feed freshness in between relies on the lazy refresh in `GET /api/feed` (any visit past 15 minutes triggers a background collection) and, if applied, the pg_cron job. `.vercelignore` drops `art-src`, `.tmp`, `node_modules`, `.next`.

**Supabase settings** (`supabase/config.md`, `docs/DEPLOY.md`): apply `0001`, then `0003` (required by hub runs, royalties and the daily route), `0002` optionally; enable email + password; add `<site>/auth/callback` (and localhost) to redirect URLs; email confirmation may stay on.

**CI** (`.github/workflows/ci.yml`): on push to `main` and pull requests, Node 24 + pnpm 10, `pnpm install --frozen-lockfile`, `typecheck`, `test`, `build` with placeholder Supabase env.

**Commit conventions**: `scripts/backdate-commit.mjs "message" [iso-date]` commits with scheduled author/committer dates. The first slot is `2026-09-04T19:12:00+03:00`, later slots advance 15–75 minutes inside 10:00–24:00 local, 4–9 commits per day, rolling to the next morning, never past now, tracked in `.tmp/commit-clock.json`. Staged files only when something is staged, else `git add -A`. Per the project's memory notes: no AI attribution lines, commits go straight to `main`, no PRs.

**Local dev**: `pnpm install`, `cp .env.example .env.local`, `pnpm dev` (http://localhost:3000), `pnpm test`, `pnpm typecheck`, `pnpm balance`, `pnpm assets:check`. The store only touches `localStorage` in the browser; SSR renders a fresh state and the splash.

**Adding content, step by step**

- *Hardware unit*: insert a spec into `SPECS` in `src/data/hardware.ts` at the position its `baseCost` dictates (the index is the payback rank; `hardware-data.test.ts` pins strictly increasing cost, the payback shape and a `SPEED_TIERS` table, so update the test). A tail unit needs its family in `TAIL_PAYBACK_S` or an entry in `PAYBACK_OVERRIDE_S`. Add `hw-<id>` to `assetManifest.ts` and a subject in `art-prompts.ts`. Tier upgrades are generated.
- *Model*: add a row to `MODELS` in `src/data/models.ts` following the balance notes in the file header (`baseCost ≈ 10 × 1.6^rank` by VRAM rank, `baseLikes ≈ 15 × 1.35^rank`, `payoutRatio` inside the tested band), a `vendorIcon` that exists under `src/assets/brand/vendors`, 6–10 `thumbTags`, `model-<id>` in the manifest and a card prompt. A new `family` may want a `distill-<family>` node and a `thumbFamilyFor` mapping.
- *Upgrade*: add to `UPGRADES` in `src/data/upgrades.ts` with a `category`, `effects` (conventions at the top of `derived.ts`), an `unlock` and an icon; `upgrades-data.test.ts` checks the shape.
- *Map node*: add a spec to the right lane in `src/data/mapNodes.ts` with a free `col` on that row and a parent on that lane or the core; `map.test.ts` requires an acyclic graph, every node reachable from `core-root`, unique positions. Nodes read by id go in `MARKER_IDS`.
- *Hashtag*: add `{ id, tag, keywords, kind?, family? }` to `src/data/hashtags.ts` (`id === tag`) and a matching entry in `FEED_VOCAB_FALLBACK` in `src/server/feed/normalize.ts`; `models-data.test.ts` pins the count (30).

## 13. Known gaps and ideas for next steps

- **No `proxy.ts`/middleware exists.** `src/server/supabase/server.ts` documents `createSupabaseProxyClient` "for `proxy.ts` (Next 16's middleware)" that refreshes auth cookies, but no such file is in `src/`. Server-side session refresh therefore never runs; long-lived sessions may expire until the browser client refreshes.
- **Cron documentation disagrees with `vercel.json`.** `docs/DEPLOY.md` says the feed refreshes every 6 hours and `supabase/config.md` says `/api/hub/refresh` runs every 30 minutes; both are daily in `vercel.json`. `DEPLOY.md` also omits the required `0003` migration.
- **`settings.sfx` does nothing.** The toggle exists in Settings and the initial state, but no audio code (no `AudioContext`) exists anywhere.
- **`feed_items` grows without bound**: `persist` only upserts; nothing prunes old rows (reads are limited to 120).
- **Leaderboard false positives**: the plausibility rule measures from `profiles.created_at`, so a long guest run adopted at first sign-in can be flagged despite the 1e6 floor and ×12 headroom.
- **Client-side runtime RNG**: the store passes `Math.random` to `tick` and actions, so the engine's "same seed → same events" property holds in tests and for the offline replay only.
- **Test assets in the served index**: `public/art/tests/hw-rtx-4090-*.webp` and the raw `art-src/` (gitignored) are only on the local disk; regenerating art requires the MCP again.
- **`offlineClaims` counts short gaps ≥ 60 s** even when no report is shown, so "Comfy Sleep Mode" can be earned by a 61-second tab switch.
- **RP-priced upgrades would behave differently from RP map nodes** (`actions.spend` deducts `state.rp`, the map never does); none exist today, but the asymmetry is worth resolving before adding one.
- **HUB run reporting uses `post.cost`**, which for API models includes the 1.5× surcharge; the server cap uses `jobCost` with the same surcharge, so it is consistent, but royalties are paid on the surcharge too.
- Ideas from the design notes (`.tmp/design-art.md`) not yet built: late-game auto-posting (App Mode / ComfyHub automation), noodles wired between hero → rack → studio → feed, milestone light sweeps, click sounds, a mobile drawer layout (`smooth-drawer` is vendored but unused), Lighthouse pass (listed as remaining in `.tmp/TASKS.md`).
