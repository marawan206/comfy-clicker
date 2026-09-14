# Game core contract

Read this before writing any file under `src/game` or `src/data`. Everything here is pure TypeScript
(no React, no DOM, no `window`). Types come from `src/game/types.ts`; tunables from `src/game/constants.ts`.
Data enters every function through a `Catalog` so tests can pass small fixtures. Two documented
exceptions default to the shipped data when the argument is omitted: `save.ts` (`CATALOG`) and the
RP/CP balance helpers in `map.ts` (`MAP_NODES`). Everything else (`trendMult`, `matchedTrending`,
`claimContract` included) requires the catalog. `src/data` may import only `@/game/types` and
`@/game/constants` (enforced by `__tests__/data-boundaries.test.ts`).

Two behavioural exceptions are deliberate, both documented at the function that makes them and
both pinned by a test, because both read as bugs: `click` answers a refusal from the auto-clicker
guard with a `clickBlocked` **event** instead of the usual silent `error` (see actions.ts), and
`applySpin` moves `state.credits` only, never `lifetimeCredits` or `seasonCredits` (see gamble.ts).

## Catalog: `src/data/index.ts`
```ts
export interface Catalog {
  hardware: HardwareDef[]; models: ModelDef[]; precisions: Record<Precision, PrecisionDef>
  upgrades: UpgradeDef[]; mapNodes: MapNodeDef[]; achievements: AchievementDef[]
  hashtags: HashtagDef[]; contracts: ContractDef[]; events: EventDef[]
  gamble: GambleOutcomeDef[]        // seed roulette segments; weights are probabilities, summing to 1
}
export const CATALOG: Catalog          // assembled from the data files
```
`src/game/catalog.ts`: `indexById<T extends {id:string}>(arr: T[]): Record<string, T>`,
`buildIndex(catalog): CatalogIndex` with `hardwareById, modelById, upgradeById, mapNodeById, hashtagById, contractById, eventById`, memoised per catalog object (WeakMap).

Hardware ids are kebab-case (`pc-4c8t`, `rtx-3060`, `rtx-4090`, `rtx-pro-6000`, `h100-80`, `aws-p5`, `region-us-east`…), model ids too (`sd15`, `sdxl`, `flux-dev`, `wan22-5b`, `ltx2`…), hashtag ids equal the tag without `#`.
Tier upgrades are virtual upgrade ids `tier:<hardwareId>:<1..4>` produced by `generateTierUpgrades(hardware)` in `src/data/upgrades.ts` (thresholds `TIER_UPGRADE_THRESHOLDS = [5, 10, 25, 50]`, costs/effect from constants; effect `{kind:'rigMult', hardwareId, value: 2}`).

The skill tree is called **the Graph** in every user-facing string (lock reasons, action errors, hints).

### Hardware ladder shape (`src/data/hardware.ts`)
Units are ordered by `baseCost`; the index is the payback rank. Payback (`baseCost / baseCps`) falls
rung by rung up to the RTX PRO 6000 (`PAYBACK_PEAK_RANK = 19`, 125 s → 53 s) and then rises rung by
rung through the tail (`TAIL_PAYBACK_S`, per family: datacenter 1 → 4 min, cloud nodes 5 min → 4 h,
regions 12 → 48 h; `PAYBACK_OVERRIDE_S`: orbital 120 h, Dyson 240 h). Consumer Radeons are
×`AMD_PAYBACK_MULT` (0.92, ROCm-gated); the MI-series gets no discount; Apple is ×1.3. Regions,
the orbital datacenter and the Dyson swarm carry `max: 1`. Tail families grow ×1.15 per unit.

## rng.ts
`mulberry32(seed): Rng`, `hashString(s): number` (uint32), `uniform(rng, a, b)`, `pick(rng, arr)`, `weightedPick(rng, arr /* {weight} */)`, `chance(rng, p)`.

## format.ts
`formatInt(n)`: grouped integer, no suffix (prices and `9,120 / 10,000` pairs). `formatNum(n, digits = 2)`: `< 1000` → grouped integer; else 3 significant digits with suffixes `K M B T Qa Qi Sx Sp Oc No`; `formatCps(n)` (1 decimal below 10, else formatNum + "/s"), `formatDuration(sec)` (`0:42`, `3:50`, `1h 02m`, `2d 4h`), `formatPct(x)` (`+25%`), `formatWatts(w)` (`650 W`, `1.2 kW`, `3.4 MW`), `formatCompactDate(ts)`.

## state.ts
`createInitialState(now, guestId): GameState`: owns `pc-4c8t: 1`, `models.sd15 = { precisions: ['native'], setup: true }`, everything else empty/zero, `contracts.nextRotateAt = now`, `events.nextAt = now + EVENT_MIN_GAP_MS`, `daily = { lastClaimDay: null, streak: 0, claimed: [] }`, `gamble = { nextSpinAt: now, freeSpinDay: null, winStreak: 0, dryStreak: 0, pot: 0 }`, `stats.levelSeen = 1` with the other eleven counters at 0, `settings = { sfx, particles, autosave } true and { reducedMotion, projector } false`, `weekOverride: null`, `liveTrending: null`.
`statValue(state, key: StatKey, derived?): number`; `level` calls `playerLevel(state)`, `ratioed`, `dislikes` and `spins` read `state.stats`. `STAT_LABELS`, and `FAMILY_LABELS: Record<HardwareFamily, string>`, the one table of family words shared by lock reasons (`hardware.ts`) and unlock hints (`unlock.ts`); each label is the stem of the store tab label in `HARDWARE_FAMILIES` (`CPU`, `Apple`, `NVIDIA`, `AMD`, `workstation`, `datacenter`, `cloud node`, `region`).
`state.ts` imports `playerLevel` from `level.ts`, so `level.ts` may never import `state.ts`.

## level.ts
XP is **derived from lifetime stats and never stored**; the only saved field is `stats.levelSeen`,
the watermark that makes the reward idempotent across reloads and cloud merges. Everything XP reads
survives a rebrand, so a prestige never demotes. This module may import only `@/game/types` and
`@/game/constants` (`LEVEL_TITLES` lives in constants.ts for that reason, not in `src/data/flavor.ts`).
```
xp = floor(150 × log10(1 + lifetimeCredits)) + floor(25 × log2(1 + stats.posts))
   + floor(20 × achievements.length)        + floor(10 × stats.contractsDone)
   + floor(6  × mapNodes.length)            + floor(15 × stats.quantizations)
   + floor(15 × stats.lorasTrained)         + floor(50 × stats.rebrands)
```
Weights are `XP_CREDITS 150`, `XP_POSTS 25`, `XP_ACHIEVEMENT 20`, `XP_CONTRACT 10`, `XP_MAP_NODE 6`,
`XP_QUANTIZE 15`, `XP_LORA 15`, `XP_REBRAND 50`. Each row is floored on its own, so `xpBreakdown`
always sums to `playerXp` exactly.
`xpBreakdown(state): XpRow[]` (`credits, posts, achievements, contracts, mapNodes, quantizations, loras, rebrands`, in display order), `playerXp(state)`, `levelForXp(xp)` / `xpForLevel(level)` (inverses at every threshold, clamped to 1..MAX_LEVEL), `playerLevel(state) = min(MAX_LEVEL, max(levelForXp(xp), stats.levelSeen))`, `levelProgress(state): { level, xp, floor, ceiling, fraction, xpToGo }`, `levelTitle(level)` (`LEVEL_TITLES[level - 1]`, last title beyond the table), `levelReward(level, cps) = max(LEVEL_REWARD_PER_LEVEL × level, round(LEVEL_REWARD_SECS × cps))` = `max(100 × level, round(90 × cps))`, `modelsUnlockedAt(level, catalog)` (models whose `minLevel` is exactly `level`, catalog order), `modelLevelLock(model, state): { need, have } | null` (null at `minLevel ≤ 1` or when the player is there).
`settleLevelUps(state, derived, catalog): GameEvent[]`: loops while `stats.levelSeen < playerLevel(state)`, bounded by MAX_LEVEL, paying `levelReward` and emitting one `levelUp` per level in order. The three credit counters move inline here rather than through `addCredits`, because `engine.ts` imports `state.ts` which imports this module; keep them in step with `addCredits`. Paying credits raises lifetime credits and so can cross the next threshold on the same call, which the loop catches. A second call in the same state is silent.
`LEVEL_XP` (constants.ts, `MAX_LEVEL = 30`, `LEVEL_XP[0] = 0`, strictly increasing): levels 1–12 are hand-placed `0, 500, 900, 1550, 2050, 2450, 2800, 3150, 3500, 3850, 4200, 4550`; 13–30 add `LEVEL_XP_TAIL_STEP = 400` each, so level 30 is 11,950.
Level gating is a `ModelDef.minLevel` **field**, not an `UnlockCond`: a level-locked model must stay visible in the store with its reason instead of vanishing. `lockReason` (hardware.ts) checks it first and `setupModel` refuses with the same string, `Needs level N · you are level M`; `createJob` deliberately does not check, so a model already set up stays usable if the table moves under it.

## unlock.ts
`isUnlocked(cond: UnlockCond | undefined, state, derived, catalog): boolean`: `undefined` = always. `describeUnlock(cond, catalog): string`.

## economy.ts
`unitCost(def, owned) = Math.ceil(def.baseCost * def.growth ** owned)`, after stripping float noise (a relative 1e-9 epsilon: 100 × 1.12 is 112, not 113); `scripts/balance.ts` imports this function rather than restating it. `bulkCost(def, owned, n)`, `maxAffordable(def, owned, credits)`, `paybackSec(def, derived, owned = 0)`.

## derived.ts
`activeEffects(state, catalog): Effect[]`: from owned upgrades (incl. virtual tier upgrades), unlocked map nodes, active events (see events.ts `eventEffects`).
`computeDerived(state, catalog): Derived`:
- `rawCps = Σ count × baseCps × rigMult[id] × familyMult[family]`; `globalMult = Π(1+globalMult effects) × (1 + RP_MULT_PER_POINT × rp) × (1 + ACHIEVEMENT_MULT × achievements) × cpMult`; `cpMult = 1 + CP_MULT_PER_POINT × cp × Π cpMult effects`; `cps = rawCps × globalMult × throttleMult(powerDraw, powerBudget)`.
- `powerDraw = Σ count × watts`, `powerBudget = POWER_BUDGET_BASE + Σ powerBudget effects`, `throttled = powerDraw > powerBudget`. The throttle is **proportional**: `throttleMult = min(1, powerBudget / powerDraw)` (power.ts), so past the breaker a unit only adds income if its cps/W beats the rack's average.
- `bestVram/bestTier` over owned units (regions = Infinity); `bestHardwareId` = the owned unit with the highest `hardware.speedScore` (effective tier minus the tiers its MPS ×2 / ROCm ×1.25 tax is worth), ties → VRAM → price; `hasGpu` = any owned unit that is not `cpuOnly` and not `mps`.
- `clickValue = ((1 + clickFlat) × Π clickMult × globalMult + clickCpsPct × cps)`.
- `concurrency = 1 + Σ concurrency`, `speedMult = Π speedMult`, `likesMult = Π likesMult`, `payoutBonus = Σ payoutRatio`, `followRate = FOLLOW_RATE_BASE × Π followRate`, `viralChance = VIRAL_CHANCE_BASE + Σ`, `flopChance = max(0.02, FLOP_CHANCE_BASE − Σ)`, `offlineCapHours = OFFLINE_CAP_HOURS_BASE + Σ` (Infinity if any Infinity), `offlineEfficiency = max(OFFLINE_EFFICIENCY, offlineEfficiency effects)`, flags from effect kinds, `unlockedFamilies` (cpu/apple/nvidia-consumer/workstation/datacenter/cloud-node/region always; `amd-consumer` needs `unlockFamily`), `tagLikes`, `familyGenTime`, `coolingTier`, `weekSpeed = Π weekSpeed`.

## power.ts
`powerDraw(state, catalog)`, `powerBudget(effects)`, `isThrottled(draw, budget)`, `throttleMult(draw, budget) = min(1, budget / draw)` (1 within budget, 0 with no budget), `powerHeadroom`, `powerLoad`, `projectPurchase(def, n, derived): { draw, budget, throttled, trips, mult }`, `wouldThrottle`, `unitsWithinBudget`.

## hardware.ts
`canBuy(def, state, derived, catalog, n = 1): { ok: boolean; reason?: string }`: family locked (ROCm), unlock cond, max, credits.
`runsOn(model, precision, hw, derived, catalog): boolean`: `hw.vram ≥ model.vram × precisions[precision].vramMult`; `hw.cpuOnly → model.cpuOk`; `hw.mps → model.mpsOk && kind === 'image'`; `hw.rocm → model.rocmOk || (!model.needsZluda) || derived.zluda`; `model.api → derived.apiNodes` (any hardware).
`runnableHardware(...)`, `bestRunnable(...)` = the owned unit with the **shortest `genTimeMs`** for that model and precision (so the MPS/ROCm taxes count), ties → VRAM → price; `speedScore(hw, derived)`, `isFasterUnit(a, b, derived)`, `backendTimeMult(hw)`; `nativeTier(model, catalog)` = speedTier of the cheapest CUDA unit (not cpuOnly, not mps, not rocm) that holds the native weights, 0 for API models; `lockReason(model, precision, state, derived, catalog): string | null` (e.g. `Needs 20 GB · your best card has 12 GB · quantize FP8 for 450 or buy an RTX 3090`).
`genTimeMs(model, precision, hw, derived, catalog)` = clamp(baseTime × TIER_DELTA_FACTOR^(nativeTier − hw.speedTier − cooling) for below, × ABOVE_TIER_FACTOR^Δ for above, GEN_TIME_MIN_S, GEN_TIME_MAX_S) × precision.timeMult × speedMult × familyGenTime[family] × (mps ? 2 : 1) × (rocm ? 1.25 : 1) → ms. API models skip the tier and backend terms (their `baseTime` is 10 s for images, 12 s for video).

## quantize.ts
`nativeHardware(model, catalog): HardwareDef | null`: the cheapest CUDA unit (not cpuOnly, not mps, not rocm) that holds the native weights; null for API models.
`quantFee(model, precision, catalog) = round(feeFraction × nativeHardware.baseCost)`; `canQuantize(model, precision, state, catalog)`; `applyQuantize(state, modelId, precision, fee)`; `setupFee(model, derived, catalog) = model.vram > derived.bestVram ? SETUP_FEE_MULT × model.baseCost : 0` with `SETUP_FEE_MULT = 1`, so `setupFee + quantFee(fp8) < nativeHardware.baseCost` for every quantizable model (models-data test).

## guidance.ts
The structured reason anything is locked, and the one place the wording lives. `LockCause` is a
discriminated union (`credits`, `currency`, `ownHardware`, `ownFamily`, `ownModel`, `upgrade`,
`mapNode`, `parent`, `stat`, `cps`, `level`, `vram`, `backend`, `apiNodes`, `setup`, `precision`,
`family`, `max`, `flag`).
`explainUnlock(cond, state, derived, catalog): LockCause[]` (`all` concatenates its unmet children,
`any` returns the branch with the fewest unmet leaves, a met condition returns `[]`);
`explainBuy(def, state, derived, catalog, n = 1): LockCause[]` in `canBuy`'s order (family, unlock,
cap, credits); `explainRun(model, precision, state, derived, catalog): LockCause | null` in
`lockReason`'s order (**player level**, API Nodes, backend, VRAM);
`explainQuantize(model, precision, state, catalog)`; `explainSetup(model, state, derived, catalog)`;
`setupCause(model, derived, catalog)`; `explainMapNode(def, state, derived, catalog): LockCause[]`
(locked parents, then the node's own condition, then the price);
`describeCause(cause, catalog): string`; `causeEta(cause, derived): number` (whole seconds for a
`credits` cause at the current rate, `Infinity` for everything else).
`lockReason`, `canBuy().reason` and `canQuantize().reason` are thin formatters over this layer and
their strings are unchanged; the condition kinds delegate to `describeUnlock`, so a cause and the
tooltip for the same requirement can never drift. Two `describeCause` outputs are tails rather than
sentences, because that is how the store prints them: `family` follows `Locked · ` and `max` is the
whole line. `hardware.ts` and `quantize.ts` import back into this module; every call is inside a
function body, never at module scope, so the cycle resolves.
`lockReason` checks `modelLevelLock(model, state)` first and returns
`Needs level ${need} · you are level ${have}`, the same string `setupModel` refuses with, which is
what makes every model surface explain the level gate.
Test: `__tests__/guidance.test.ts` asserts `describeCause(explainRun(...)) === lockReason(...)` for
every model, every precision and three fixture states, plus the exact strings per cause.

## goals.ts
"What should I do next" and "which achievement am I closest to", in one module. It invents no game
math: prices come from economy.ts, gates from unlock.ts and hardware.ts, fees from quantize.ts, node
availability and balances from map.ts, the XP bar from level.ts. Everything here is called from
20 Hz selectors, so each function is one pass over the catalog returning primitives or one small
flat object.
`condProgress(cond, state, derived, catalog): { current, target, fraction, label }`: `stat` and `cps`
divide by the threshold; `ownHardware` and `ownFamily` add the share of the next unit already banked
(`min(1, credits / unitCost)`, against the cheapest unlocked unit for a family), so a near miss
shows as one; `ownModel`, `precision`, `mapNode`, `upgrade` and `flag` are 0 or 1 with
`describeUnlock` as the label; `all` reports its furthest child, `any` its closest; `fraction` is
clamped to [0, 1]; a measurable label is `9,120 / 10,000 likes` (`level 3 / 5` for the level stat,
which is the one key whose unit goes first).
`nextAchievements(state, derived, catalog, n = 3): NextAchievement[]`: not hidden (those stay `???`),
not earned, `fraction < 1`; ranked by fraction descending, then the smaller target, then catalog
order, with yes/no conditions sunk to the bottom. Inserted into a list of `n` rather than sorting
the catalog.
`nextGoal(state, derived, catalog): Goal | null`, first match wins: a done and unclaimed contract →
a model at or under the player's level that is not set up and whose setup fee is affordable
(cheapest fee first, so free ones lead) → `saveTarget` → the cheapest available Graph node already
payable in its own currency → the level bar. Null only at max level with nothing outstanding.
`Goal` is `claim | setup | buy | node | level`; the `buy` variant carries `pct`, `etaSec` and
`unlocksModel` (the biggest model the unit would newly run **natively**, level-locked models
skipped, so the hint never promises what the purchase cannot deliver).
`goalKey(goal)` is the selector key the panel animates on (`claim:<index>:<title>` because claiming
splices the list); `isGoalDone(goal, state)` flips the row to its done state (a `buy` goal is done
when the credits are **banked**, not spent).
`saveTarget(state, derived, catalog): { def, cost, pct, etaSec } | null`: the cheapest visible,
purchasable-but-unaffordable unit, gated by `canBuy`'s non-credit checks in the same order (family
unlocked, unlock condition, cap) and priced with `unitCost`, so the store's save-for bar and the
Next up panel can never quote different numbers. `storeHooks.useSaveTarget` is a thin wrapper and a
test pins that the two agree. `pct` is a whole number 0..100 and `etaSec` whole seconds
(`Infinity` at cps 0), so a bar re-renders at most a hundred times per target.

## gamble.ts
Seed Roulette: the KSampler spin. Outcomes are `Catalog.gamble` (`src/data/gamble.ts`), where
`weight` **is** the probability and the table sums to exactly 1, so `weightedPick` draws it directly
and `spinEv = Σ weight × mult` = **1.038** (something back 66 %, a profit 18.8 %).

| id | label | mult | weight |
|---|---|---|---|
| `nan` | NaN latent | 0 | 0.34 |
| `half` | Half denoised | 0.5 | 0.3 |
| `same` | Same seed, same image | 1 | 0.172 |
| `clean` | Clean sample | 2 | 0.12 |
| `batch` | Batch of four | 4 | 0.05 |
| `golden` | Golden seed | 10 | 0.015 |
| `s42` | Seed 42 | 42 | 0.003 |

Three rules keep it unfarmable: the cooldown is a single timestamp in the save
(`gamble.nextSpinAt`), so eight hours away still yields exactly one ready spin; the wager is priced
in seconds of income, so it scales with the rig rather than with patience; and payouts move
`state.credits` only.
Constants: `SPIN_MIN_LEVEL = 2`, `SPIN_COOLDOWN_MS = 180_000`, `SPIN_MIN_SECS = 30`,
`SPIN_MAX_SECS = 300`, `SPIN_MIN_WAGER = 50`, `SPIN_FREE_SECS = 120`, `SPIN_FREE_MIN = 200`,
`SPIN_PITY_DRY = 3`, `SPIN_HOT_STREAK = 3`, `SPIN_HOT_MULT = 1.5`, `SPIN_POT_FRACTION = 0.02`.
`spinEv(outcomes)` (weighted mean, 0 for an empty table), `wagerBounds(state, derived)`
(`min = max(50, round(30 × cps))`, `max = min(floor(credits), max(min, round(300 × cps)))`),
`freeStake(derived) = max(200, round(120 × cps))`, `freeSpinAvailable(state, now)` (UTC `dayKey`,
the same clock as the daily reward), `msUntilSpin(state, now)`, `isHot(state)`, `pityDue(state)`,
`canSpin(state, derived, now, wager: number | 'free')`, `rollOutcome(outcomes, rng, pity)`,
`applySpin(state, derived, catalog, now, rng, wager): GameEvent[]`.
`canSpin` checks in the order the copy reads, and the balance **before** the ceiling (the ceiling is
already capped by the balance, so a broke player must be told they cannot afford it rather than told
to bet less): `Unlocks at level 2` · `Free spin already used today` · `Sampler is cooling down · 2:41`
· `Bet at least 50 credits` · `Not enough credits` · `Bet at most 1,200 credits right now`.
`applySpin` deducts the stake, sets `nextSpinAt = now + SPIN_COOLDOWN_MS` and adds
`round(0.02 × wager)` to the pot (a free spin does none of those three, only stamping `freeSpinDay`),
pays `round(stake × mult × (hot ? 1.5 : 1))` plus, on `s42`, the whole pot on top, updates `dryStreak` /
`winStreak` (a result under ×2 breaks it, `same` included) / `stats.spins` / `stats.spinNet`, raises `jackpot42`, `nanStreak3` or `hotSeed`, and
emits exactly one `spin` carrying the segment's **printed** multiplier (`hot` and `payout` carry the
x1.5). `rollOutcome` with `pity` converts a losing draw once into the cheapest winning segment,
after drawing, so the rng sequence is identical either way.
**Documented exception.** Payouts move `state.credits` and nothing else. `lifetimeCredits` feeds XP
and therefore the player level, `seasonCredits` feeds prestige and the leaderboard; crediting either
here would make the roulette an XP farm and let a lucky seed buy a rank. `applyOffline` never
touches `gamble`, and `hydrate` clamps `nextSpinAt` to `now + SPIN_COOLDOWN_MS`.

## clickGuard.ts
Layers two and three of the auto-clicker guard (layer one is `src/lib/input.ts`: an untrusted event
is not a click).
1. A hard cap of `CLICK_CAP_PER_SEC = 15` **accepted** clicks over a trailing
   `CLICK_RATE_WINDOW_MS = 1_000`. A refused click pays nothing and is **not** a strike.
2. A cadence check over the last `CADENCE_INTERVALS = 24` **attempted** intervals (`CLICK_RING = 25`
   timestamps): a strike when `mean < CADENCE_MAX_MEAN_MS = 200` **and**
   `cv < CADENCE_MAX_CV = 0.05`. Attempted includes the ones the cap refused, so a 25/s tool cannot
   hide under the cap. Fast plus regular is the only combination that trips: slow regularity is
   allowed, and a human hand sits at cv 0.15 to 0.35 where a timer sits under 0.02.
`cadence(intervals): { mean, cv }` (population stddev over the mean; `[]` is `{0, 0}`),
`evaluateClick(state, now): ClickVerdict` (`{ ok: true }` or `{ ok: false, reason: 'locked' | 'rate' | 'cadence', until }`),
`resetClickGuard(state)`.
`evaluateClick` **records the attempt**, so it must be called exactly once per attempt. Order: a
lockout short-circuits (nothing is recorded while paused, so the ring is clean when it lifts), then
the ring, then the cadence check once the ring is full, then the cap. A clock that steps backwards
clears both ledgers. A strike escalates the lockout through `CLICK_LOCKOUT_MS = [10_000, 30_000, 60_000]`
(capped at `CLICK_LOCKOUT_MAX_MS = 60_000`), raises `flags.clickGuard` (hidden achievement
"Suspiciously Regular") and empties the ring; strikes decay after `CLICK_STRIKE_DECAY_MS = 5 min`
without a new one. The ring lives in a `WeakMap` side table (the tick-memo pattern) because it is
session bookkeeping; the lockout is persisted in `stats.clickLockUntil / clickStrikes / clickStrikeAt`
so a reload does not wash it away, and `hydrate` clamps `clickLockUntil` to `now + CLICK_LOCKOUT_MAX_MS`.
Income from hardware is never touched, and nothing here is permanent.

## hashtags.ts
`weekIndex(now, weekSpeed = 1) = floor(now / (WEEK_MS / weekSpeed))`; `trendingForWeek(week, catalog): string[]` (TRENDING_COUNT distinct ids via mulberry32(week), at least one non-type tag); `currentTrending(state, now, catalog, weekSpeed: number)`: `weekSpeed` is **required** and must be `derived.weekSpeed` (the Fast Weeks node halves the week) = `liveTrending.tags` if `now − fetchedAt < 30 min` else `trendingForWeek(weekOverride ?? weekIndex(now, weekSpeed))`; `msUntilRollover(now, weekSpeed)`: the UI passes `derived.weekSpeed` here too.
`matchTags(prompt, selected: string[], catalog): { matched: string[]; keywordHits: number; explicit: string[] }`: word-boundary keyword match (lowercase), literal `#tag`, plus explicitly selected ids; dedupe. `explicit` is the subset the player put there on purpose, literal `#tags` then selected ids, with keyword hits deliberately left out: "a cat in motion" matches the `videogen` keyword `motion`, and prose is not a claim about what the post is.
`mismatchedTypeTags(explicit, kind, catalog): string[]`: the explicit ids whose `HashtagDef.kind` is set and differs from the post's kind, in catalog order. Only these ratio a post, so prose can never cost anybody credits.
`trendMult(matched, trending, extraKeywordHits, kind, catalog)`: matched trending ids sorted by weight → `1 + TRENDING_WEIGHTS[i]` for first MAX_MATCHED_TRENDING; if > MAX_MATCHED_TRENDING matched → `1.0` (spam); type tags (`kind`) count as free +0.2 without occupying a slot; `+ EXTRA_KEYWORD_BONUS × min(MAX_EXTRA_KEYWORDS, extraKeywordHits)`. `matchedTrending(matched, trending, kind, catalog)`.

## studio.ts
`jobCost(model, precision, derived, catalog) = round(max(baseCost, costSecs × cps) × precisions[p].costMult × (model.api ? API_COST_MULT : 1))`. `API_COST_MULT = 1.5` lives in constants.ts (re-exported here).
`createJob(state, derived, catalog, input: {modelId, precision, prompt, tags, hubWorkflowId?}, now, rng): { ok: true; job: Job } | { ok: false; reason: string }`: model owned+setup, precision unlocked, runnable, credits, `queue.length < MAX_QUEUE`; deducts credits; `durationMs = genTimeMs(...)` for `bestRunnable`; pushes `startedAt: null`.
`advanceQueue(state, derived, catalog, now, rng): GameEvent[]`: start pending up to `concurrency`; finish when `endsAt − clickBonusMs ≤ now` → `rollPost` → unshift into `posts` (cap MAX_POSTS, dropping only `granted` posts).
`applyClickToJobs(state, now): boolean`: adds CLICK_JOB_BONUS_MS to the earliest running job up to `CLICK_JOB_BONUS_CAP × durationMs`.

## virality.ts
`rollPost(job, state, derived, catalog, now, rng): Post`:
- `{matched, keywordHits, explicit} = matchTags(prompt, tags)`; `mismatched = mismatchedTypeTags(explicit, model.kind)`. A non-empty `mismatched` makes the post **ratioed** and settles the band before anything is drawn (see below).
- `M`: one draw `u = rng()` settles the viral band, so a roll that missed it by a hair is knowable instead of indistinguishable from a normal day. `u < viralChance` → `uniform(VIRAL_ROLL = 3, 8)` viral; else `nearViral = u < NEAR_VIRAL_BAND (2) × viralChance` and then `chance(flopChance)` → `uniform(FLOP_ROLL = 0.3, 0.6)` flop, else `uniform(NORMAL_ROLL = 0.85, 1.35)`. `Post.nearViral` is set for the card; it changes no number.
- `trending = currentTrending(…, derived.weekSpeed)`; `trend = trendMult(...)`; repost penalty ×REPOST_PENALTY if `stats.lastPostKey === repostKey(modelId, matched, prompt)` = `modelId + '|' + matched.sort().join(',') + '|' + normalizePromptText(prompt).trim()` (same model, tags *and* prompt; a fresh prompt with the same tags is a new post, not a repost).
- `quality = precisions[p].qualityMult`, `audience = 1 + log10(1 + followers / AUDIENCE_REF_DIVISOR)`, `tagBonus = Π (1 + tagLikes[tag]) × (1 + FAMILY_AFFINITY_BONUS)` per matched tag whose `family` is the model's, `eventBoost` from events, `founder = chance(FOUNDER_BOOST_CHANCE) || prompt mentions yoland/robin (once, flag) → ×3`, `hubMult = HUB_RUN_LIKES_BOOST` for a job run from a ComfyHub recipe, `streakMult = 1 + min(LANDED_STREAK_MAX 0.25, LANDED_STREAK_STEP 0.025 × stats.landedStreak)`.
- `targetLikes = max(1, round(M × trend × quality × baseLikes × audience × likesMult × tagBonus × eventBoost × founder × hubMult × streakMult))`. The streak moves likes only, so the EV bands are exactly what they were.
- **Ratioed** (`mismatched.length > 0`): `flop = true`, `M = uniform(FLOP_ROLL)`, `trend = 1` flat (so the repost penalty is moot), no founder roll, no spark consumed and no hub boost, the spark and the name-drop surviving for the next honest post. `targetLikes = max(1, round(RATIO_DISLIKE_MULT (3) × M × baseLikes × audience × likesMult))` and `credits = RATIO_LOSS_MULT (1) × paid × M`, stored **positive**: the sign lives in `post.ratioed`, and `settlePosts` subtracts. `post.mismatchedTags` records the offending ids and `flags.ratioed` (`RATIOED_FLAG`) is raised.
- **Credits follow the roll, not the reach**: `credits = (payoutRatio + payoutBonus) × paid × M × quality` where `paid = job.cost / API_COST_MULT` for API models (the surcharge is a fee) and `job.cost` otherwise; `creditsPerLike = credits / targetLikes`, so the card's `likes × cpl = credits` still adds up while trend, audience, likesMult, tag bonuses, events and the founder boost move likes → followers → RP/contracts only. Untagged EV/cost = `E[M] × payoutRatio` ≈ 1.23 × payoutRatio regardless of upgrades.
- `cost = job.cost` (snapshot; upscales are priced off it), `windowMs = POST_WINDOW_MS`; `thumb = pickThumbTag(model, prompt)`, a keyword (overlap with `model.thumbTags`, else `hashString(prompt) % pool`), **not** an asset id: the UI resolves it with `assetManifest.pickThumb(thumbFamilyFor(post.modelId, post.kind), post.prompt, hashString(post.prompt))`.
`likesAt(post, now) = floor(targetLikes × (1 − (1 − p)³))`, `p = clamp((now − createdAt) / windowMs, 0, 1)`.
`settlePosts(state, derived, catalog, now): GameEvent[]`: pays `(newLikes − likes) × cpl` into credits/lifetime/season and `lifetimeLikes` (with `newLikes = max(post.likes, likesAt)`, so never negative); when complete and `!granted`: followers via social.ts, stats (videos/flops/virals/bestPostLikes), the landed streak (`stats.landedStreak` and `bestLandedStreak`: a post that neither flopped nor got ratioed extends it, anything else zeroes it), `granted = true`, emit `postResolved` carrying `ratioed`.
A ratioed post runs the same clock with the sign flipped: `state.credits = max(0, credits − delta × cpl)`, `post.creditsPaid` still accumulating the loss as a positive number so the card can render the minus, `stats.dislikes += delta`, and on completion `removeFollowers(floor(targetLikes × followRate))` (so `post.followersGained` is negative), `stats.flops += 1` and `stats.ratioed += 1`. `lifetimeLikes`, `lifetimeCredits`, `seasonCredits`, `lifetimeFollowers` and `bestPostLikes` never move for one: those feed XP, achievements and the leaderboard, and a ratio is not an accomplishment.

## social.ts
`addFollowers(state, n): GameEvent[]`: `followersFrac` accumulator; signups when `lifetimeFollowers` crosses `SIGNUP_THRESHOLDS` then ×SIGNUP_GROWTH beyond the table; each signup `rp += 1`, emit `signup`. `removeFollowers(state, n)`: the ratio path, floored at 0 and never touching `lifetimeFollowers`, so a ratio cannot undo a signup. `audienceMult(followers)`.

## contracts.ts / events.ts / daily.ts / prestige.ts / achievements.ts / offline.ts
- contracts: `rotateContracts(state, derived, catalog, now, rng)` keeps CONTRACT_SLOTS active (eligible by `minTier ≤ bestTier`, no duplicates), `rewardCredits = rewardSecs × cps` at acceptance (min 100); `progressContracts(state, events: GameEvent[], catalog)`; `claimContract(state, idx, catalog): GameEvent[]` (catalog required).
- events: `maybeStartEvent(state, derived, catalog, now, rng): GameEvent[]` (gap uniform(EVENT_MIN_GAP_MS, EVENT_MAX_GAP_MS), weighted by `weight`, `minTier`); `expireEvents(...)`; `eventEffects(state, catalog): Effect[]` (modelDrop → tagLikes +1.0 on payload tag; cloudPromo → globalMult ×2; powerSurge → `powerBudget −0.4 × ownedPowerBudget(state, catalog)`, i.e. 40 % of the rig's *current* budget from the base circuit plus owned upgrades/map nodes; nodeBroke → ×0.5; spotReclaim → rigMult 0 unless reserved capacity); `resolveEvent(state, defId, now)` (nodeBroke fixed by click, trendingSpark caught → flag `sparkNext`, which is ×3 likes on the next post).
- daily: `dayKey(now) = YYYY-MM-DD UTC`; `canClaim(state, now)`; `claimDaily(state, derived, now): GameEvent[]`: streak continues if last claim was yesterday (or two days ago with `streakGrace`), else resets to 1; day n (1..7 cycle) reward `max(DAILY_MIN_CREDITS, cps × DAILY_BASE_SECS × n)`, day 3 `rp += 1`, day 7 `cp += 1`.
- prestige: `canRebrand(state, catalog)` (owns any `cloud-node` or `region`); `rebrandCp(lifetimeSeasonCredits) = floor((seasonCredits / REBRAND_CP_DIVISOR) ** REBRAND_CP_EXP)`; `creditsForCp(cp)` (inverse); `rebrand(state, catalog, now): GameEvent[]`: reset credits/seasonCredits/hardware/hardwareTiers/upgrades(non-prestige)/models(keep sd15)/queue/posts/**followers, followersFrac**/contracts/events; keep achievements, mapNodes (all), rp, cp, cpSpent, loras, hubRep, daily, flags, lifetimeFollowers/lifetimeLikes/signups; apply `startHardware` effects; `season += 1`, `stats.rebrands += 1`. The Rebrand dialog must list followers among the losses.
- achievements: `checkAchievements(state, derived, catalog): GameEvent[]`, granting in catalog order and re-running while a pass granted something (up to 4 passes), so a count-based row lands in the same call. `AchievementDef.reward` is a one-off credit payout handed over on grant, moving the three credit counters inline (importing `addCredits` back would close a cycle; keep them in step with it), and the `achievement` event carries it as `reward` (0 when there is none).
- offline: `applyOffline(state, derived, catalog, now): { elapsedSec, gain, events }`: `elapsed = (now − lastTickAt)/1000`; if `≤ SHORT_GAP_S` full-rate catch-up without report; else `capped = min(elapsed, offlineCapHours × 3600)`, `gain = cps × capped × derived.offlineEfficiency` (`OFFLINE_EFFICIENCY = 0.5`; `Comfy Cloud: Always On` raises it to 1; the cap starts at 8 h and tops out at 48 h across every source); replay finishes jobs whose `endsAt ≤ now` sequentially, expiring random events as it passes their end; settle posts fully; **`progressContracts` on the resulting events**; `stats.offlineClaims += 1` only past `SHORT_GAP_S` (a tab switch never claims); emit `weekRollover` if the trending week changed while away (and `primeTickMemo` so the tick stays quiet); `checkAchievements`, then `settleLevelUps`. It never touches `state.gamble`, so eight hours away is one ready spin, not a backlog.

## engine.ts / actions.ts
`tick(state, derived, catalog, dtSec, now, rng): GameEvent[]`: income `cps × dt`, `playedSec`, `advanceQueue`, `settlePosts`, `expireEvents`, `maybeStartEvent`, `progressContracts`, `rotateContracts` when due, achievements then `settleLevelUps` at most once per whole played second, week rollover detection (`weekRollover` event with new tags), cps power-of-10 milestones (`milestone`), breaker flip (`powerThrottle`), `lastTickAt = now`. `DERIVED_EVENT_TYPES` / `needsDerived(events)` tell the caller when to recompute `Derived`: the store should use `needsDerived` rather than its own list. `levelUp` is **not** in that set: the reward is credits, and nothing `computeDerived` reads moves. `resetTickMemo(state)`, `primeTickMemo(state, derived, now)`.
`GameEvent` (types.ts) is the whole vocabulary the UI sees: `click{value,lucky?}`, `purchase`, `upgrade`, `mapUnlock`, `jobStarted`, `postCreated`, `postResolved{viral,flop,ratioed}`, `achievement{id,reward}`, `offline{gain,elapsedSec}`, `contractDone`, `eventStart`, `eventEnd`, `daily{day,credits}`, `rebrand{cp}`, `powerThrottle{on}`, `signup{total}`, `weekRollover{tags}`, `easterEgg{id}`, `milestone{cps}`, `levelUp{level,credits,unlocked}`, `clickBlocked{reason,until}`, `spin{outcome,mult,wager,payout,free,hot}`, `reward{id,credits}`. `src/audio/sfxMap.ts` switches over it with a `never` default, so a new member fails the build until someone decides what it sounds like.
`actions.ts`: every action is `(ctx: ActionContext, ...args) => ActionResult` with `ActionContext = { state, derived, catalog, now, rng }` and `ActionResult = { events: GameEvent[]; dirty: boolean; error?: string }` (`dirty` ⇒ caller recomputes derived; validation failures return `{ events: [], dirty: false, error }` and leave the state untouched):
`click(ctx)`, `buyHardware(ctx, id, n: BuyCount = 1)` with `BuyCount = 1 | 10 | 100 | 'max'`, `buyUpgrade(ctx, id)`, `unlockMapNode(ctx, id)`, `quantize(ctx, modelId, precision)`, `setupModel(ctx, modelId)` (the player level is the first gate after "already set up", and the only place it is checked), `trainLora(ctx, tagId)` (cost = 20 min of cps, min 500), `queueJob(ctx, input: QueueJobInput)` (re-exported `JobInput`; diffs `CREATE_JOB_FLAGS` around `createJob` and emits one `easterEgg` per newly raised prompt flag; also progresses contracts for any job it finishes on the way in), `claimContract(ctx, i)`, `claimDaily(ctx)`, `spin(ctx, wager: number | 'free')`, `rebrand(ctx)`, `resolveEvent(ctx, defId)`, `toggleSetting(ctx, key: keyof GameSettings, value?: boolean)`, `setFlag(ctx, key)`, `upscalePost(ctx, postId)` (cost `UPSCALE_COST_FRACTION` = 30% of the post's **original** `post.cost`, adds a second wave of 40% likes at the post's own credits/like; refused on a ratio first, with its own reason, then on flops), `grantGift(ctx, kind)`, `declineGift(ctx, kind)`, `completeTutorial(ctx)`. `upscaleCost(post, ctx)`, `loraCost(derived)`, `clickRate(state, now)`.

**`click`.** `evaluateClick` runs first. On an accepted click, one in `1 / LUCKY_CLICK_CHANCE` (0.005) pays `LUCKY_CLICK_MULT` (×10), bumps `stats.luckyClicks`, raises `luckySeed` and marks the `click` event `lucky: true`; the roll happens on accepted clicks only, so a refused click cannot burn the lucky seed. **Documented exception**: a refused click returns `{ events: [{ type: 'clickBlocked', reason, until }], dirty: false }` and **no** `error`, because the button has to be able to say why it went quiet. It must still move nothing: no credits, no `totalClicks`, no `recordClick`, no `applyClickToJobs` and above all no `click` event, so contracts, the combo meter and the click-frenzy egg all see a click that never happened.

**`spin`.** `canSpin` owns every rule and every rejection string; `applySpin` owns the roll, the pity meter, the hot streak and the pot. `dirty: false` (nothing in `Derived` reads a spin). Never reachable from the click path or a hotkey, so a wager is always a deliberate press, and it does **not** call `noteSpend`: a bank that lands on zero because a seed ate the wager is not "Out Of Credits, Not Ideas".

**`setFlag`.** UI discovery flags only. `UI_FLAGS = konami, ticker-seven, seed42, rickroll, title-25, grand-tour, night-shift, ctrl-enter` (other keys are still accepted; the list documents the ones nothing in `src/game` sets). Set once, emits `easterEgg`, then runs `checkAchievements` immediately so the egg, the achievement it unlocks and that achievement's credits land on the same click instead of up to a second later; `dirty` is true exactly when something was granted. A repeat is a validation failure, so nothing is announced twice.

**`grantGift` / `declineGift`** (`src/data/gifts.ts`). Everything in a gift is free: the hardware lands without `applyPurchase` touching the bank, unowned upgrades are pushed onto `state.upgrades`, credits go through `addCredits` so they count as earned. Every id is resolved before anything is written, so a gift naming hardware the catalog dropped leaves the state exactly as it found it; `def.max` is respected. The gift's flag makes the offer happen once, so a second call is a refusal. It emits `purchase` as well as `reward` so contracts see the hardware arrive. `declineGift` sets `gift:<kind>:declined` (`GIFT_DECLINED_SUFFIX`) and nothing else; it is idempotent, because Esc, the backdrop and the ghost button are the same answer.

**`completeTutorial`.** Sets `flags['tutorial-done']` (`TUTORIAL_FLAG`). Idempotent, silent, `dirty: false`. Deliberately **not** `setFlag`: that one is for discovery flags and announces an `easterEgg`, and a veteran save that never saw the tour gets the flag set quietly on boot, which must not fire a toast.

## save.ts / loop.ts
`serialize(state): string`; `loadSave(raw: string | null, now, guestId, catalog = CATALOG): { state, corrupt, migratedFrom }`: **this is how the caller learns about corruption**: the store must call `loadSave` and stash the raw blob under `SAVE_CORRUPT_KEY` (`SAVE_KEY + '.corrupt'`) when `corrupt` is true; `deserialize(raw, now, guestId, catalog = CATALOG): GameState` is the convenience wrapper that always returns a state. Zod schema (`saveSchema`), `MIGRATIONS: Record<number, (s: unknown) => unknown>` up to SAVE_VERSION, unknown ids dropped, missing or invalid fields filled from `createInitialState` (a record field that is not a record falls back whole, so the starter PC and SD 1.5 survive; `hydrate` additionally guarantees both). Hydration normalises queued jobs (a running job always has `endsAt = startedAt + durationMs`, a pending one has none, `clickBonusMs ≤ CLICK_JOB_BONUS_CAP × durationMs`) and pulls timestamps from a clock that ran ahead back to `now` (`lastTickAt`, `events.nextAt ≤ now + EVENT_MAX_GAP_MS`, `contracts.nextRotateAt ≤ now + CONTRACT_ROTATE_MS`, `gamble.nextSpinAt ≤ now + SPIN_COOLDOWN_MS`, `stats.clickLockUntil ≤ now + CLICK_LOCKOUT_MAX_MS`, `liveTrending.fetchedAt`, post `createdAt`, job timestamps shifted together, active events). **Every new state field needs a schema entry with a fallback**, so an old blob still loads: `stats.levelSeen` (missing ⇒ set to `playerLevel(state)`, the retroactive level with no back-pay and no toast storm), the ten other new counters, `settings.autosave` (fallback true), the whole `gamble` object, and on a post `ratioed`, `mismatchedTags`, `nearViral` and a **signed** `followersGained` (a ratio drives followers away). `exportString(state)` = `'CC1|' + base64(utf8 json)` (chunked, no call-stack spread), `importString(s)`.
`startLoop({ tick, render, onLongGap }): () => void`: rAF accumulator, fixed STEP_S, `MAX_CATCHUP_S = 5`, beyond that calls `onLongGap(elapsedSec, now)`; the next frame is always requested (try/finally) so a throwing tick or listener cannot silently stop the loop.

## Tests (`src/game/__tests__`)
Vitest, node env. Use `CATALOG` for integration-style tests and tiny inline catalogs for unit tests. Required: economy (cost formulas; payback strictly decreasing up to the RTX PRO 6000 and strictly increasing after it along the non-Apple, non-Radeon ladder), pacing sim (`scripts/balance.ts` exports `simulate(strategy, seconds)` and `projectWeek(strategy)`, models the power throttle and the CP gates; climb strategy reaches `rtx-pro-6000` < 15 min and a cloud node < 25 min at 3 clicks/s, owns no region inside 3 h of continuous play, and neither the orbital datacenter nor the Dyson swarm by day 7 of a one-hour-a-day week), virality EV bands (untagged native EV/cost in [1.05, 1.6] for local models and [0.95, 1.1] net of the surcharge for API models, over 20k rolls; viral rate 4–6%; reach multipliers leave credits unchanged), hardware gating (3060 can't run flux-dev native, can at fp8; cpu can't run sdxl; amd needs ROCm; api needs apiNodes; `bestRunnable` prefers the faster real gen time), power throttle (proportional), quantize fees (setup + FP8 always undercuts the native rig), hashtags (deterministic per week, rollover, spam rule), studio queue/concurrency, offline (cap, efficiency, contracts progressed, events expired, rollover announced once), save roundtrip + corrupt blob + normalisation, map graph (acyclic, every node reachable from `core-root`, unique positions), module boundaries, format.

Added with the level, goals, roulette, guard and ratio work (25 files under `src/game/__tests__`, 48 across the repo):
- `level.test.ts`: `LEVEL_XP` strictly increasing with `LEVEL_XP[0] === 0`; `levelForXp` inverts `xpForLevel` at every threshold and one XP below it; a fresh state is level 1 at xp 0; `xpBreakdown` sums to `playerXp`; `settleLevelUps` pays `max(100 × L, round(90 × cps))` once per level in order, is silent on a second call and never runs past MAX_LEVEL; a blob without `levelSeen` hydrates to the derived level and the next tick pays nothing; a rebrand never demotes.
- `models-data.test.ts`: every model has an integer `minLevel` in 1..12; `sd15` is 1; every level 2 to 12 unlocks at least one model; every API model is ≥ 7; every video model is ≥ 5; `minLevel` never falls as VRAM rises within a local kind.
- `goals.test.ts`: `condProgress` per condition type (`all` as the minimum, `any` as the maximum, clamped, binary labels equal to `describeUnlock`); `nextAchievements` excludes hidden, earned and complete rows and ranks correctly; `nextGoal`'s priority order over fixture states; `goalKey` and `isGoalDone` per kind; `saveTarget` agrees with the store hook.
- `gamble.test.ts`: weights sum to 1 and ids are unique; `spinEv()` is in [1.02, 1.06]; 200k `mulberry32` rolls land on the analytic EV; the economic invariant `(3600 / SPIN_COOLDOWN_MS × 1000) × (spinEv() − 1) × SPIN_MAX_SECS ≤ 0.07 × 3600`; every rejection path with its exact copy; `applySpin` deducts, pays `round(wager × mult)`, sets the cooldown and emits exactly one `spin`; **`lifetimeCredits` and `seasonCredits` never move**; the free spin deducts nothing and leaves the cooldown alone; pity converts the third NaN; hot pays ×1.5 after three wins; eight offline hours leave exactly one ready spin; `hydrate` clamps a far-future `nextSpinAt`; a blob without `gamble` loads the defaults.
- `clickGuard.test.ts`: 15 clicks in a second pay and the 16th is refused with `rate` while moving nothing; 25 clicks at a flat 100 ms trip `cadence` with a 10 s lock and the flag; jittered human cadences trip nothing; 100 clicks at a flat 333 ms trip nothing (slow regularity is allowed); the 10 / 30 / 60 escalation and the decay; the click-frenzy egg still reachable; `cadence([])` is zeros; the hydrate clamp.
- `hashtags.test.ts` / `virality.test.ts`: `explicit` excludes keyword hits and `mismatchedTypeTags` returns catalog order; a ratioed roll has the flop band, no viral, trend 1, the dislike formula, the spark still armed and the flag set; `settlePosts` drains the bank, floors at 0, leaves the lifetime counters alone, bumps the three stats, drops followers without going negative and emits one `postResolved` with `ratioed: true`; a correctly typed tag pays exactly what an untagged post pays; `upscalePost` refuses a ratio.
- `actions-new.test.ts`: a blocked click moves nothing at all; the lucky seed tags the event and never burns on a refused click; `setupModel` refuses below `minLevel` with the exact string and `queueJob` does not re-check it; the spin rejection copy passes straight through; the founder card racks free without throttling and the Sonam credits go through the normal path; `completeTutorial` announces no easter egg; a rewarded achievement pays exactly once; the four `createJob` prompt eggs.
- `src/state/__tests__/autosave.test.ts`: the `autosaveDue` table, a burst of buys writing once, `click` never scheduling an action save, a throwing `setItem` raising and clearing `saveError`.
- `src/audio/__tests__/sfxMap.test.ts` (node): `cueForEvent` answers for every `GameEvent['type']`, the click limiter, `comboRate`, and a recipe plus a shipped file for every `SfxName`.
