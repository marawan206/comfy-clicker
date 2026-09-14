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
`applySpin` and `applyFlip` move `state.credits` only, never `lifetimeCredits` or `seasonCredits`
(see gamble.ts).

## Catalog: `src/data/index.ts`
```ts
export interface Catalog {
  hardware: HardwareDef[]; models: ModelDef[]; precisions: Record<Precision, PrecisionDef>
  upgrades: UpgradeDef[]; mapNodes: MapNodeDef[]; achievements: AchievementDef[]
  hashtags: HashtagDef[]; contracts: ContractDef[]; events: EventDef[]
  gamble: GambleOutcomeDef[]        // Lounge wheel segments; weights are probabilities, summing to 1
  citizens: CitizenFlavor           // handle pools for the players who run published workflows
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
Every unit also carries `minLevel` (a plain `HardwareDef` field, absent meaning 1, exactly like
`ModelDef.minLevel`): the level is the pace of the ladder, payback decides which unit inside a
level. The table, by level: 1 `pc-4c8t`, `pc-8c16t` · 2 `mac-mini-m4`, `rx-7600-xt`, `rtx-3060` ·
3 `rx-9070-xt`, `rtx-4070-ti-super`, `rtx-3090` · 4 `rx-7900-xtx`, `rtx-4090`, `rtx-5080`,
`mac-studio-m4-max` · 5 `rtx-5090`, `radeon-pro-w7900` · 6 `rtx-a6000`, `l4`, `rtx-6000-ada` ·
7 `a40`, `l40s`, `rtx-pro-6000` · 8 `a100-80`, `mi300x` · 9 `h100-80`, `mi325x`, `h200` · 10 `b200`,
`b300`, `aws-p4d`, `azure-nd-mi300x` · 11 `aws-p5`, `aws-p5e`, `aws-p6`, `runpod-8xb300` ·
12 `region-us-east` · 13 `region-eu-west` · 14 `region-ap-southeast` · 16 `orbital-dc` ·
20 `dyson-swarm`. `hardware-data.test.ts` pins the invariants: an integer in 1..MAX_LEVEL, the two
CPUs at 1, at least one unit at every level 2..12, never falling as `baseCost` rises along the main
chain, every `ownHardware` prerequisite at or under the unit that needs it, and every quantizable
local model's `nativeHardware` at or under the model's own `minLevel`.

## rng.ts
`mulberry32(seed): Rng`, `hashString(s): number` (uint32), `uniform(rng, a, b)`, `pick(rng, arr)`, `weightedPick(rng, arr /* {weight} */)`, `chance(rng, p)`.

## format.ts
`formatInt(n)`: grouped integer, no suffix (prices and `9,120 / 10,000` pairs). `formatNum(n, digits = 2)`: `< 1000` → grouped integer; else 3 significant digits with suffixes `K M B T Qa Qi Sx Sp Oc No`; `formatCps(n)` (1 decimal below 10, else formatNum + "/s"), `formatDuration(sec)` (`0:42`, `3:50`, `1h 02m`, `2d 4h`), `formatPct(x)` (`+25%`), `formatWatts(w)` (`650 W`, `1.2 kW`, `3.4 MW`), `formatCompactDate(ts)`.

## state.ts
`createInitialState(now, guestId): GameState`: owns `pc-4c8t: 1`, `models.sd15 = { precisions: ['native'], setup: true }`, everything else empty/zero, `contracts.nextRotateAt = now`, `events.nextAt = now + EVENT_MIN_GAP_MS`, `daily = { lastClaimDay: null, streak: 0, claimed: [] }`, `gamble = { freeSpinDay: null, winStreak: 0, dryStreak: 0, coinStreak: 0, pot: 0 }`, `citizens = { drops: [], feed: [] }`, `stats.levelSeen = 1` and `stats.xpBy = {}` (the activity XP ledger) with the other eleven counters at 0, `settings = { sfx, particles, autosave } true and { reducedMotion, projector } false`, `weekOverride: null`, `liveTrending: null`.
`statValue(state, key: StatKey, derived?): number`; `level` calls `playerLevel(state)`, `ratioed`, `dislikes` and `spins` read `state.stats`. `STAT_LABELS`, and `FAMILY_LABELS: Record<HardwareFamily, string>`, the one table of family words shared by lock reasons (`hardware.ts`) and unlock hints (`unlock.ts`); each label is the stem of the store tab label in `HARDWARE_FAMILIES` (`CPU`, `Apple`, `NVIDIA`, `AMD`, `workstation`, `datacenter`, `cloud node`, `region`).
`state.ts` imports `playerLevel` from `level.ts`, so `level.ts` may never import `state.ts`.

## level.ts
XP has two parts. The **credits term** is derived and never stored: `creditsXp(state) =
floor(XP_CREDITS × log10(1 + lifetimeCredits))`, 150 per decade. Everything else is the **activity
ledger** `stats.xpBy: Partial<Record<XpSource, number>>`, banked by `grantXp(state, amount, source)`
the moment the player does the thing: it floors the amount, does nothing for a grant that rounds to
zero or is not a number, adds to `stats.xpBy[source]` and returns `{ type: 'xp', amount, source }`
for the caller to push (every grant is announced, so the UI can float it). `activityXp(state)` sums
the ledger (finite, non-negative values only; a corrupt row reads as zero) and `playerXp = creditsXp
+ activityXp`. Lifetime credits and the ledger both survive a rebrand, so a prestige never demotes.
The other saved field is `stats.levelSeen`, the watermark that makes the reward idempotent across
reloads and cloud merges. This module may import only `@/game/types` and `@/game/constants`
(`LEVEL_TITLES` lives in constants.ts for that reason, not in `src/data/flavor.ts`).

`XpSource` (types.ts) is `post | viral | contract | achievement | mapNode | hardware | upgrade |
tier | setup | quantize | lora | daily | milestone | rebrand`, in display order; `XP_SOURCES` is that
list and `XP_SOURCE_LABELS` its labels (`posts`, `viral posts`, `contracts done`, `achievements`,
`Graph nodes`, `new cards`, `upgrades`, `tier upgrades`, `models set up`, `quantizations`, `LoRAs
trained`, `daily logins`, `income milestones`, `rebrands`). The weights live in constants.ts; where
each one lands:

| Source | Grant | Where |
|---|---|---|
| `post` / `viral` | `postXp(model, viral) = (XP_POST_BASE 4 + XP_POST_PER_LEVEL 3 × max(1, model.minLevel)) × (viral ? XP_VIRAL_MULT 2 : 1)`: 7 for SD 1.5, 16 for FLUX.1 dev, 32 for a viral FLUX post | `virality.settlePosts`, once, the moment the post is granted; a ratioed post pays nothing |
| `contract` | `XP_CONTRACT 60` | `contracts.claimContract` |
| `achievement` | `XP_ACHIEVEMENT 50` | `achievements.checkAchievements`, right behind each `achievement` event |
| `mapNode` | `XP_MAP_NODE 40` | `actions.unlockMapNode` |
| `hardware` | `XP_HARDWARE_FIRST 50` | `actions.buyHardware` and `grantGift`, only when `owned === 0` before the purchase: once per kind, whatever the count |
| `upgrade` / `tier` | `XP_UPGRADE 40` / `XP_TIER 60` | `actions.buyUpgrade`; a `tier:` id pays `tier` |
| `setup` | `XP_SETUP 20` | `actions.setupModel` |
| `quantize` | `XP_QUANTIZE 30` | `actions.quantize`, only when `stats.quantizations` moved (a new tier) |
| `lora` | `XP_LORA 40` | `actions.trainLora` |
| `daily` | `dailyXp(day) = XP_DAILY_PER_DAY 40 × clamp(day, 1, 7)`, so day 7 pays 280 | `daily.claimDaily` and `cloudActions.claimDailyFromServer` |
| `milestone` | `XP_MILESTONE 100` | `engine.tick`, once per crossed power of ten of cps |
| `rebrand` | `XP_REBRAND 500` | `prestige.rebrand`; stats survive the reset, so the ledger does too |

Never: clicks, the Lounge (the documented exception under gamble.ts), hub royalties, level rewards,
offline income. `applyOffline` pays post and achievement XP through the functions above and nothing
extra. `xp` is not in `DERIVED_EVENT_TYPES`, and `sfxMap` answers it with silence: the action that
earned it already sounded.

`xpBreakdown(state): XpRow[]` (`credits earned` first, then every source with XP banked, in `XP_SOURCES` order; every row is whole, so the rows sum to `playerXp` exactly), `playerXp(state)`, `levelForXp(xp)` / `xpForLevel(level)` (inverses at every threshold, clamped to 1..MAX_LEVEL), `playerLevel(state) = min(MAX_LEVEL, max(levelForXp(xp), stats.levelSeen))`, `levelProgress(state): { level, xp, floor, ceiling, fraction, xpToGo }`, `levelTitle(level)` (`LEVEL_TITLES[level - 1]`, last title beyond the table), `levelReward(level, cps) = max(LEVEL_REWARD_PER_LEVEL × level, round(LEVEL_REWARD_SECS × cps))` = `max(100 × level, round(90 × cps))`, `modelsUnlockedAt(level, catalog)` and `hardwareUnlockedAt(level, catalog)` (`minLevel` exactly `level`, catalog order; level 1 takes the ones with none), `modelLevelLock(model, state)` and `hardwareLevelLock(def, state): { need, have } | null` (null at `minLevel ≤ 1` or when the player is there), `featuresUnlockedAt(level)` (`['The Latent Lounge']` at `LOUNGE_MIN_LEVEL`, else `[]`), `levelRoadmap(catalog): LevelRung[]` (one `{ level, title, xp, models, hardware, features }` per level 1..MAX_LEVEL, built once per catalog object in a `WeakMap` and shared from then on: read it, never mutate it), `nextUnlocks(level, catalog): { models, hardware, features }` (the cached rung above, empty at MAX_LEVEL; `goals.nextGoal` calls it from a 20 Hz selector, which is why the roadmap is cached).
`settleLevelUps(state, derived, catalog): GameEvent[]`: loops while `stats.levelSeen < playerLevel(state)`, bounded by MAX_LEVEL, paying `levelReward` and emitting one `levelUp{level,credits,unlocked,hardware}` per level in order (`unlocked` the model ids and `hardware` the hardware ids whose `minLevel` is that level, catalog order). The three credit counters move inline here rather than through `addCredits`, because `engine.ts` imports `state.ts` which imports this module; keep them in step with `addCredits`. Paying credits raises lifetime credits and so can cross the next threshold on the same call, which the loop catches. A second call in the same state is silent.
`LEVEL_XP` (constants.ts, `MAX_LEVEL = 30`, `LEVEL_XP[0] = 0`, strictly increasing): levels 1 to 12 are the hand-placed `LEVEL_XP_HAND = 0, 700, 1 500, 2 200, 3 700, 6 600, 9 000, 11 500, 14 500, 18 500, 23 500, 32 000`; past them each step is the previous step × `LEVEL_XP_TAIL_GROWTH = 1.1`, rounded to the nearest hundred, so level 13 is 41 400, level 20 is 138 700 and level 30 is 457 200. Retune `LEVEL_XP_HAND` against `scripts/balance.ts`; the tail rule stays. `pacing.test.ts` pins the arrival windows from the design and, within 15 %, the arrivals measured when the rungs were last placed (`MEASURED_ARRIVAL_S`, the same seconds as the table in `docs/HOW-IT-WORKS.md`), so a retune of the hand rungs or of any `XP_*` weight has to keep that suite green and move both tables with it.
Level gating is a `minLevel` **field** on both `ModelDef` and `HardwareDef`, not an `UnlockCond`: a level-locked model or unit must stay visible in the store with its reason instead of vanishing. `lockReason` (hardware.ts) checks the model's first and `setupModel` refuses with the same string, `Needs level N · you are level M`; `canBuy` refuses a unit with the identical words after the family and unlock checks and before the cap; `createJob` deliberately does not check, so a model already set up stays usable if the table moves under it.

## unlock.ts
`isUnlocked(cond: UnlockCond | undefined, state, derived, catalog): boolean`: `undefined` = always. `describeUnlock(cond, catalog): string`.

## economy.ts
`unitCost(def, owned) = Math.ceil(def.baseCost * def.growth ** owned)`, after stripping float noise (a relative 1e-9 epsilon: 100 × 1.12 is 112, not 113); `scripts/balance.ts` imports this function rather than restating it. `bulkCost(def, owned, n)`, `maxAffordable(def, owned, credits)`, `paybackSec(def, derived, owned = 0)`.

## derived.ts
`activeEffects(state, catalog): Effect[]`: from owned upgrades (incl. virtual tier upgrades), unlocked map nodes, active events (see events.ts `eventEffects`).
`computeDerived(state, catalog): Derived`:
- `rawCps = Σ count × baseCps × rigMult[id] × familyMult[family]`; `globalMult = Π(1+globalMult effects) × (1 + RP_MULT_PER_POINT × rp) × (1 + ACHIEVEMENT_MULT × achievements) × cpMult`; `cpMult = 1 + CP_MULT_PER_POINT × cp × Π cpMult effects`; `cps = rawCps × globalMult × throttleMult(powerDraw, powerBudget)`.
- `powerDraw = Σ count × watts`, `powerBudget = POWER_BUDGET_BASE + Σ powerBudget effects`, `throttled = powerDraw > powerBudget`. The breaker is a **cliff**: `throttleMult = throttled ? 0 : 1` (power.ts), so past it every rig that needs watts stops and passive income is zero until the rack fits the circuit. `clickValue` keeps its flat part, so clicking is the way back out.
- `bestVram/bestTier` over owned units (regions = Infinity); `bestHardwareId` = the owned unit with the highest `hardware.speedScore` (effective tier minus the tiers its MPS ×2 / ROCm ×1.25 tax is worth), ties → VRAM → price; `hasGpu` = any owned unit that is not `cpuOnly` and not `mps`.
- `clickValue = ((1 + clickFlat) × Π clickMult × globalMult + clickCpsPct × cps)`.
- `concurrency = 1 + Σ concurrency`, `speedMult = Π speedMult`, `likesMult = Π likesMult`, `payoutBonus = Σ payoutRatio`, `followRate = FOLLOW_RATE_BASE × Π followRate`, `viralChance = VIRAL_CHANCE_BASE + Σ`, `flopChance = max(0.02, FLOP_CHANCE_BASE − Σ)`, `offlineCapHours = OFFLINE_CAP_HOURS_BASE + Σ` (Infinity if any Infinity), `offlineEfficiency = max(OFFLINE_EFFICIENCY, offlineEfficiency effects)`, flags from effect kinds, `unlockedFamilies` (cpu/apple/nvidia-consumer/workstation/datacenter/cloud-node/region always; `amd-consumer` needs `unlockFamily`), `tagLikes`, `familyGenTime`, `coolingTier`, `weekSpeed = Π weekSpeed`.

## power.ts
`powerDraw(state, catalog)`, `powerBudget(effects)`, `isThrottled(draw, budget)`, `throttleMult(draw, budget)` (1 within budget, 0 past it), `powerHeadroom`, `powerLoad`, `projectPurchase(def, n, derived): { draw, budget, throttled, trips, mult }`, `wouldThrottle`, `unitsWithinBudget`.

## hardware.ts
`canBuy(def, state, derived, catalog, n = 1): { ok: boolean; reason?: string }`: family locked (ROCm), unlock cond, player level (`hardwareLevelLock`, refused with `Needs level 5 · you are level 4`, the model string verbatim), max, credits.
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
**player level**, cap, credits); `explainRun(model, precision, state, derived, catalog): LockCause | null` in
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
`Needs level ${need} · you are level ${have}`, the same string `setupModel` refuses with and the
one `canBuy` prints for a unit under `hardwareLevelLock`, which is what makes every model and store
surface explain the level gate the same way.
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
(cheapest fee first, so free ones lead) → the level bar, when `levelBlocked(state, derived, catalog)`
→ `saveTarget` → the cheapest available Graph node already payable in its own currency → the level
bar anyway. Null only at max level with nothing outstanding. `levelBlocked` is true when some unit
passes the family, unlock and cap checks, fails only the level, and its next unit is already
affordable (`credits >= unitCost`): the moment the panel points at the bar instead of the shelf.
`Goal` is `claim | setup | buy | node | level`; the `buy` variant carries `pct`, `etaSec` and
`unlocksModel` (the biggest model the unit would newly run **natively**, level-locked models
skipped, so the hint never promises what the purchase cannot deliver); the `level` variant is
`{ level, pct, xpToGo, unlocks }`, `level` the current one plus one and `unlocks` up to
`LEVEL_GOAL_UNLOCKS = 3` names from `nextUnlocks`, hardware first, then models.
`goalKey(goal)` is the selector key the panel animates on (`claim:<index>:<title>` because claiming
splices the list); `isGoalDone(goal, state)` flips the row to its done state (a `buy` goal is done
when the credits are **banked**, not spent).
`saveTarget(state, derived, catalog): { def, cost, pct, etaSec } | null`: the cheapest visible,
purchasable-but-unaffordable unit, gated by `canBuy`'s non-credit checks in the same order (family
unlocked, unlock condition, player level, cap) and priced with `unitCost`, so the store's save-for bar and the
Next up panel can never quote different numbers. `storeHooks.useSaveTarget` is a thin wrapper and a
test pins that the two agree. `pct` is a whole number 0..100 and `etaSec` whole seconds
(`Infinity` at cps 0), so a bar re-renders at most a hundred times per target.

## gamble.ts
The Latent Lounge: two tables, one bank. **The wheel** is the KSampler spin; outcomes are
`Catalog.gamble` (`src/data/gamble.ts`), where `weight` **is** the probability and the table sums to
exactly 1, so `weightedPick` draws it directly and `spinEv = Σ weight × mult` = **0.954**. **The
coin** is one flip: your side pays `COIN_PAYOUT` and lands `COIN_WIN_CHANCE` of the time, so it
returns **0.96**.

| id | label | mult | weight |
|---|---|---|---|
| `nan` | NaN latent | 0 | 0.355 |
| `half` | Half denoised | 0.5 | 0.3 |
| `same` | Same seed, same image | 1 | 0.17 |
| `clean` | Clean sample | 2 | 0.12 |
| `batch` | Batch of four | 4 | 0.042 |
| `golden` | Golden seed | 10 | 0.01 |
| `s42` | Seed 42 | 42 | 0.003 |

There is **no cooldown and no ceiling on a bet**: any amount from `BET_MIN` up to the whole bank, as
often as the player likes. What keeps that safe is the only invariant that matters here, pinned by
`gamble.test.ts` over 50k simulated bets a table with the pity reroll, the hot sampler and the
minted pot included: **both tables pay back less than 1 per credit staked**. If a future table
crosses 1 the Lounge has become an income source and the change is wrong. The other rule is that
payouts move `state.credits` only.
Constants: `LOUNGE_MIN_LEVEL = 2`, `BET_MIN = 10`, `FREE_SPIN_SECS = 120`, `FREE_SPIN_MIN = 200`,
`SPIN_PITY_DRY = 3`, `SPIN_HOT_STREAK = 3`, `SPIN_HOT_MULT = 1.5`, `SPIN_POT_FRACTION = 0.02`,
`COIN_WIN_CHANCE = 0.48`, `COIN_PAYOUT = 2`.
`spinEv(outcomes)` (weighted mean, 0 for an empty table), `coinEv()`, `betBounds(state)`
(`{ min: BET_MIN, max: floor(credits) }`), `freeStake(derived) = max(200, round(120 × cps))`,
`freeSpinAvailable(state, now)` (UTC `dayKey`, the same clock as the daily reward), `isHot(state)`,
`pityDue(state)`, `canBet(state, derived, now, wager: number | 'free')`,
`rollOutcome(outcomes, rng, pity)`, `applySpin(state, derived, catalog, now, rng, wager)`,
`applyFlip(state, derived, now, rng, wager)`.
`canBet` checks in the order the copy reads: `Unlocks at level 2` · `Free spin already used today`
· `Bet at least 10 credits` · `Not enough credits`.
`applySpin` deducts the stake and adds `round(0.02 × wager)` to the pot (a free spin does neither,
only stamping `freeSpinDay`), pays `round(stake × mult × (hot ? 1.5 : 1))` plus, on `s42`, the whole
pot on top, updates `dryStreak` / `winStreak` (a result under ×2 breaks it, `same` included) /
`stats.spins` / `stats.spinNet`, raises `jackpot42`, `nanStreak3` or `hotSeed`, and emits exactly one
`spin` carrying the segment's **printed** multiplier (`hot` and `payout` carry the x1.5).
`rollOutcome` with `pity` converts a losing draw once into the cheapest winning segment, after
drawing, so the rng sequence is identical either way.
`applyFlip` takes no free stake and has no pity, no streak bonus and no jackpot: it deducts, feeds
the same pot, rolls `rng() < COIN_WIN_CHANCE`, pays `round(stake × COIN_PAYOUT)` on your side,
moves `gamble.coinStreak` / `stats.flips` / `stats.spinNet`, raises `coinFive` at
`COIN_STREAK_TARGET = 5`, and emits one `flip{side,wager,payout,streak}`.
**Documented exception.** Payouts move `state.credits` and nothing else. `lifetimeCredits` feeds XP
and therefore the player level, `seasonCredits` feeds prestige and the leaderboard; crediting either
here would make the Lounge an XP farm and let a lucky seed buy a rank. `applyOffline` never touches
`gamble`.

## citizens.ts
Invented players running the workflows this save has published. A publish (`recordHubPublish` with
the hub id and name) calls `addDrop`, which puts a *drop* on `state.citizens.drops`; every tick
`runCitizens` advances each one. A due run pays `runRoyalty = max(CITIZEN_ROYALTY_MIN,
round(CITIZEN_ROYALTY_SECS × cps × heat))` through `addCredits` (royalties are income, so lifetime
and season totals do move, exactly as a real hub run does), bumps `stats.hubRuns` and `hubRep` by
one, decays `heat` by `CITIZEN_HEAT_DECAY`, reschedules `nextRunAt = now + nextGapMs(heat, rng)` and
pushes a `CitizenVisit` onto `state.citizens.feed` (kept to `CITIZEN_FEED_MAX`). Handles come from
`Catalog.citizens` (`src/data/citizens.ts`).
Three rules hold the economy still: **one run per drop per tick**, so a tab closed for eight hours
comes back to one due run and never a backlog; **heat only ever falls**, by the decay and by the
`CITIZEN_TREND_MS` deadline, so a drop pays about 43 seconds of income over ~31 runs and ~43 minutes
and then is `cold` for good; and **royalties scale with cps**, so the feature reads the same at every
rig size. `hydrate` clamps a `nextRunAt` from a clock that ran ahead to `now + CITIZEN_TREND_MS`.
`citizenHandle(rng, catalog)`, `nextGapMs(heat, rng)`, `runRoyalty(derived, heat)`, `hotDrops(state)`,
`isCold(drop, now)`, `addDrop(state, now, rng, id, name)`, `runCitizens(state, derived, catalog, now, rng)`.

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
`settlePosts(state, derived, catalog, now): GameEvent[]`: pays `(newLikes − likes) × cpl` into credits/lifetime/season and `lifetimeLikes` (with `newLikes = max(post.likes, likesAt)`, so never negative); when complete and `!granted`: followers via social.ts, stats (videos/flops/virals/bestPostLikes), the landed streak (`stats.landedStreak` and `bestLandedStreak`: a post that neither flopped nor got ratioed extends it, anything else zeroes it), `granted = true`, emit `postResolved` carrying `ratioed`, then, for a post that was not ratioed, `grantXp(postXp(model, post.viral), post.viral ? 'viral' : 'post')`, so XP lands exactly once per post and the offline replay pays it too.
A ratioed post runs the same clock with the sign flipped: `state.credits = max(0, credits − delta × cpl)`, `post.creditsPaid` still accumulating the loss as a positive number so the card can render the minus, `stats.dislikes += delta`, and on completion `removeFollowers(floor(targetLikes × followRate))` (so `post.followersGained` is negative), `stats.flops += 1` and `stats.ratioed += 1`. `lifetimeLikes`, `lifetimeCredits`, `seasonCredits`, `lifetimeFollowers` and `bestPostLikes` never move for one: those feed XP, achievements and the leaderboard, and a ratio is not an accomplishment.

## social.ts
`addFollowers(state, n): GameEvent[]`: `followersFrac` accumulator; signups when `lifetimeFollowers` crosses `SIGNUP_THRESHOLDS` then ×SIGNUP_GROWTH beyond the table; each signup `rp += 1`, emit `signup`. `removeFollowers(state, n)`: the ratio path, floored at 0 and never touching `lifetimeFollowers`, so a ratio cannot undo a signup. `audienceMult(followers)`.

## contracts.ts / events.ts / daily.ts / prestige.ts / achievements.ts / offline.ts
- contracts: `rotateContracts(state, derived, catalog, now, rng)` keeps CONTRACT_SLOTS active (eligible by `minTier ≤ bestTier`, no duplicates), `rewardCredits = rewardSecs × cps` at acceptance (min 100); `progressContracts(state, events: GameEvent[], catalog)`; `claimContract(state, idx, catalog): GameEvent[]` (catalog required; a successful claim returns the `xp` event for `XP_CONTRACT`, and `[]` means there was nothing to claim).
- events: `maybeStartEvent(state, derived, catalog, now, rng): GameEvent[]` (gap uniform(EVENT_MIN_GAP_MS, EVENT_MAX_GAP_MS), weighted by `weight`, `minTier`); `expireEvents(...)`; `eventEffects(state, catalog): Effect[]` (modelDrop → tagLikes +1.0 on payload tag; cloudPromo → globalMult ×2; powerSurge → `powerBudget −0.4 × ownedPowerBudget(state, catalog)`, i.e. 40 % of the rig's *current* budget from the base circuit plus owned upgrades/map nodes; nodeBroke → ×0.5; spotReclaim → rigMult 0 unless reserved capacity); `resolveEvent(state, defId, now)` (nodeBroke fixed by click, trendingSpark caught → flag `sparkNext`, which is ×3 likes on the next post).
- daily: `dayKey(now) = YYYY-MM-DD UTC`; `canClaim(state, now)`; `claimDaily(state, derived, now): GameEvent[]`: streak continues if last claim was yesterday (or two days ago with `streakGrace`), else resets to 1; day n (1..7 cycle) reward `max(DAILY_MIN_CREDITS, cps × DAILY_BASE_SECS × n)` plus `dailyXp(n)` of XP as `daily` (`cloudActions.claimDailyFromServer` grants the same), day 3 `rp += 1`, day 7 `cp += 1`.
- prestige: `canRebrand(state, catalog)` (owns any `cloud-node` or `region`); `rebrandCp(lifetimeSeasonCredits) = floor((seasonCredits / REBRAND_CP_DIVISOR) ** REBRAND_CP_EXP)`; `creditsForCp(cp)` (inverse); `rebrand(state, catalog, now): GameEvent[]`: reset credits/seasonCredits/hardware/hardwareTiers/upgrades(non-prestige)/models(keep sd15)/queue/posts/**followers, followersFrac**/contracts/events; keep achievements, mapNodes (all), rp, cp, cpSpent, loras, hubRep, daily, flags, lifetimeFollowers/lifetimeLikes/signups; apply `startHardware` effects; `season += 1`, `stats.rebrands += 1`, then `XP_REBRAND` as `rebrand` (stats survive the reset, so the ledger does too). The Rebrand dialog must list followers among the losses.
- achievements: `checkAchievements(state, derived, catalog): GameEvent[]`, granting in catalog order and re-running while a pass granted something (up to 4 passes), so a count-based row lands in the same call. `AchievementDef.reward` is a one-off credit payout handed over on grant, moving the three credit counters inline (importing `addCredits` back would close a cycle; keep them in step with it), and the `achievement` event carries it as `reward` (0 when there is none). Every grant also banks `XP_ACHIEVEMENT` of XP, its `xp` event pushed right behind the `achievement` event.
- offline: `applyOffline(state, derived, catalog, now): { elapsedSec, gain, events }`: `elapsed = (now − lastTickAt)/1000`; if `≤ SHORT_GAP_S` full-rate catch-up without report; else `capped = min(elapsed, offlineCapHours × 3600)`, `gain = cps × capped × derived.offlineEfficiency` (`OFFLINE_EFFICIENCY = 0.5`; `Comfy Cloud: Always On` raises it to 1; the cap starts at 8 h and tops out at 48 h across every source); replay finishes jobs whose `endsAt ≤ now` sequentially, expiring random events as it passes their end; settle posts fully (their XP included, through `settlePosts`); **`progressContracts` on the resulting events**; `stats.offlineClaims += 1` only past `SHORT_GAP_S` (a tab switch never claims); emit `weekRollover` if the trending week changed while away (and `primeTickMemo` so the tick stays quiet); `checkAchievements`, then `settleLevelUps`. It never touches `state.gamble` or `state.citizens`, so eight hours away is one due citizen run, not a backlog.

## engine.ts / actions.ts
`tick(state, derived, catalog, dtSec, now, rng): GameEvent[]`: income `cps × dt`, `playedSec`, `advanceQueue`, `settlePosts`, `expireEvents`, `maybeStartEvent`, `progressContracts`, `rotateContracts` when due, achievements then `settleLevelUps` at most once per whole played second, week rollover detection (`weekRollover` event with new tags), cps power-of-10 milestones (`milestone`, each followed by an `xp` grant of `XP_MILESTONE`), breaker flip (`powerThrottle`), `lastTickAt = now`. `DERIVED_EVENT_TYPES` / `needsDerived(events)` tell the caller when to recompute `Derived`: the store should use `needsDerived` rather than its own list. `levelUp` and `xp` are **not** in that set: the reward is credits and XP is a number on a bar, and nothing `computeDerived` reads moves. `resetTickMemo(state)`, `primeTickMemo(state, derived, now)`.
`GameEvent` (types.ts) is the whole vocabulary the UI sees: `click{value,lucky?}`, `purchase`, `upgrade`, `mapUnlock`, `jobStarted`, `postCreated`, `postResolved{viral,flop,ratioed}`, `achievement{id,reward}`, `offline{gain,elapsedSec}`, `contractDone`, `eventStart`, `eventEnd`, `daily{day,credits}`, `rebrand{cp}`, `powerThrottle{on}`, `signup{total}`, `weekRollover{tags}`, `easterEgg{id}`, `milestone{cps}`, `xp{amount,source}`, `levelUp{level,credits,unlocked,hardware}`, `clickBlocked{reason,until}`, `spin{outcome,mult,wager,payout,free,hot}`, `flip{side,wager,payout,streak}`, `citizenRun{handle,workflowName,credits}`, `reward{id,credits}`. `src/audio/sfxMap.ts` switches over it with a `never` default, so a new member fails the build until someone decides what it sounds like.
`actions.ts`: every action is `(ctx: ActionContext, ...args) => ActionResult` with `ActionContext = { state, derived, catalog, now, rng }` and `ActionResult = { events: GameEvent[]; dirty: boolean; error?: string }` (`dirty` ⇒ caller recomputes derived; validation failures return `{ events: [], dirty: false, error }` and leave the state untouched):
`click(ctx)`, `buyHardware(ctx, id, n: BuyCount = 1)` with `BuyCount = 1 | 10 | 100 | 'max'`, `buyUpgrade(ctx, id)`, `unlockMapNode(ctx, id)`, `quantize(ctx, modelId, precision)`, `setupModel(ctx, modelId)` (the player level is the first gate after "already set up", and the only place it is checked), `trainLora(ctx, tagId)` (cost = 20 min of cps, min 500), `queueJob(ctx, input: QueueJobInput)` (re-exported `JobInput`; diffs `CREATE_JOB_FLAGS` around `createJob` and emits one `easterEgg` per newly raised prompt flag; also progresses contracts for any job it finishes on the way in), `claimContract(ctx, i)`, `claimDaily(ctx)`, `spin(ctx, wager: number | 'free')`, `flip(ctx, wager: number)`, `rebrand(ctx)`, `resolveEvent(ctx, defId)`, `toggleSetting(ctx, key: keyof GameSettings, value?: boolean)`, `setFlag(ctx, key)`, `upscalePost(ctx, postId)` (cost `UPSCALE_COST_FRACTION` = 30% of the post's **original** `post.cost`, adds a second wave of 40% likes at the post's own credits/like; refused on a ratio first, with its own reason, then on flops), `grantGift(ctx, kind)`, `declineGift(ctx, kind)`, `completeTutorial(ctx)`. `upscaleCost(post, ctx)`, `loraCost(derived)`, `clickRate(state, now)`.

**XP.** The actions that earn it push the `xp` event from `grantXp` onto their result: `buyHardware` banks `XP_HARDWARE_FIRST` when `owned === 0` before the purchase (one grant per kind, whatever the count, and `grantGift` follows the same rule), `buyUpgrade` `XP_TIER` for a `tier:` id and `XP_UPGRADE` otherwise, `unlockMapNode` `XP_MAP_NODE`, `setupModel` `XP_SETUP`, `quantize` `XP_QUANTIZE` only when `stats.quantizations` moved, `trainLora` `XP_LORA`, `claimContract`, `claimDaily` and `rebrand` whatever their engine functions return. A refused action grants nothing, and `click`, `spin` and `flip` never grant.

**`click`.** `evaluateClick` runs first. On an accepted click, one in `1 / LUCKY_CLICK_CHANCE` (0.005) pays `LUCKY_CLICK_MULT` (×10), bumps `stats.luckyClicks`, raises `luckySeed` and marks the `click` event `lucky: true`; the roll happens on accepted clicks only, so a refused click cannot burn the lucky seed. **Documented exception**: a refused click returns `{ events: [{ type: 'clickBlocked', reason, until }], dirty: false }` and **no** `error`, because the button has to be able to say why it went quiet. It must still move nothing: no credits, no `totalClicks`, no `recordClick`, no `applyClickToJobs` and above all no `click` event, so contracts, the combo meter and the click-frenzy egg all see a click that never happened.

**`spin` / `flip`.** `canBet` owns every rule and every rejection string; `applySpin` and `applyFlip` own the rolls. `dirty: false` (nothing in `Derived` reads a bet). Never reachable from the click path or a hotkey, so a wager is always a deliberate press, and neither calls `noteSpend`: a bank that lands on zero because a seed ate the wager is not "Out Of Credits, Not Ideas".

**`setFlag`.** UI discovery flags only. `UI_FLAGS = konami, ticker-seven, seed42, rickroll, title-25, grand-tour, night-shift, ctrl-enter` (other keys are still accepted; the list documents the ones nothing in `src/game` sets). Set once, emits `easterEgg`, then runs `checkAchievements` immediately so the egg, the achievement it unlocks and that achievement's credits land on the same click instead of up to a second later; `dirty` is true exactly when something was granted. A repeat is a validation failure, so nothing is announced twice.

**`grantGift` / `declineGift`** (`src/data/gifts.ts`). Everything in a gift is free: the hardware lands without `applyPurchase` touching the bank, unowned upgrades are pushed onto `state.upgrades`, credits go through `addCredits` so they count as earned. Every id is resolved before anything is written, so a gift naming hardware the catalog dropped leaves the state exactly as it found it; `def.max` is respected. The gift's flag makes the offer happen once, so a second call is a refusal. It emits `purchase` as well as `reward` so contracts see the hardware arrive. `declineGift` sets `gift:<kind>:declined` (`GIFT_DECLINED_SUFFIX`) and nothing else; it is idempotent, because Esc, the backdrop and the ghost button are the same answer.

**`completeTutorial`.** Sets `flags['tutorial-done']` (`TUTORIAL_FLAG`). Idempotent, silent, `dirty: false`. Deliberately **not** `setFlag`: that one is for discovery flags and announces an `easterEgg`, and a veteran save that never saw the tour gets the flag set quietly on boot, which must not fire a toast.

## save.ts / loop.ts
`serialize(state): string`; `loadSave(raw: string | null, now, guestId, catalog = CATALOG): { state, corrupt, migratedFrom }`: **this is how the caller learns about corruption**: the store must call `loadSave` and stash the raw blob under `SAVE_CORRUPT_KEY` (`SAVE_KEY + '.corrupt'`) when `corrupt` is true; `deserialize(raw, now, guestId, catalog = CATALOG): GameState` is the convenience wrapper that always returns a state. Zod schema (`saveSchema`), `MIGRATIONS: Record<number, (s: unknown) => unknown>` up to SAVE_VERSION, unknown ids dropped, missing or invalid fields filled from `createInitialState` (a record field that is not a record falls back whole, so the starter PC and SD 1.5 survive; `hydrate` additionally guarantees both). Hydration normalises queued jobs (a running job always has `endsAt = startedAt + durationMs`, a pending one has none, `clickBonusMs ≤ CLICK_JOB_BONUS_CAP × durationMs`) and pulls timestamps from a clock that ran ahead back to `now` (`lastTickAt`, `events.nextAt ≤ now + EVENT_MAX_GAP_MS`, `contracts.nextRotateAt ≤ now + CONTRACT_ROTATE_MS`, `stats.clickLockUntil ≤ now + CLICK_LOCKOUT_MAX_MS`, `citizens.drops[].nextRunAt ≤ now + CITIZEN_TREND_MS`, `liveTrending.fetchedAt`, post `createdAt`, job timestamps shifted together, active events). **Every new state field needs a schema entry with a fallback**, so an old blob still loads: `stats.xpBy` (`fallback(recordOf(money))`; absent altogether ⇒ `legacyXp(state, catalog)` seeds it from the counters the save already carries, under today's weights: achievements × XP_ACHIEVEMENT, contractsDone × XP_CONTRACT, mapNodes × XP_MAP_NODE, quantizations × XP_QUANTIZE, lorasTrained × XP_LORA, rebrands × XP_REBRAND, owned hardware kinds × XP_HARDWARE_FIRST, named upgrades × XP_UPGRADE, Σ hardwareTiers × XP_TIER, set-up models other than the starter × XP_SETUP and posts × `LEGACY_POST_XP = 10`, a flat estimate because the models they ran were never recorded; a ledger that is present keeps known sources only, each rounded down. A seeded ledger may add up to a level above the watermark, and the next `settleLevelUps` pays and announces it, on purpose. No `SAVE_VERSION` bump: the fallback handles it), `stats.levelSeen` (missing ⇒ set to `playerLevel(state)` after the ledger is seeded, the retroactive level with no back-pay and no toast storm), the ten other new counters, `settings.autosave` (fallback true), the whole `gamble` and `citizens` objects, and on a post `ratioed`, `mismatchedTags`, `nearViral` and a **signed** `followersGained` (a ratio drives followers away). `exportString(state)` = `'CC1|' + base64(utf8 json)` (chunked, no call-stack spread), `importString(s)`.
`startLoop({ tick, render, onLongGap }): () => void`: rAF accumulator, fixed STEP_S, `MAX_CATCHUP_S = 5`, beyond that calls `onLongGap(elapsedSec, now)`; the next frame is always requested (try/finally) so a throwing tick or listener cannot silently stop the loop.

## Tests (`src/game/__tests__`)
Vitest, node env. Use `CATALOG` for integration-style tests and tiny inline catalogs for unit tests. Required: economy (cost formulas; payback strictly decreasing up to the RTX PRO 6000 and strictly increasing after it along the non-Apple, non-Radeon ladder), pacing sim (`scripts/balance.ts` exports `simulate(strategy, seconds)` and `projectWeek(strategy)`, models the power throttle, the CP gates and the level; climb strategy reaches `rtx-3060` < 4 min, `rtx-4090` < 15 min, `rtx-pro-6000` < 60 min and a cloud node < 4 h, owns no region inside 3 h of continuous play and the 8×B300 pod by 8 h, never a unit above the level it held at purchase in any run, reaches every level inside its design window and within 15 % of the measured arrival, and neither the orbital datacenter nor the Dyson swarm by day 7 of a one-hour-a-day fortnight), virality EV bands (untagged native EV/cost in [1.05, 1.6] for local models and [0.95, 1.1] net of the surcharge for API models, over 20k rolls; viral rate 4–6%; reach multipliers leave credits unchanged), hardware gating (3060 can't run flux-dev native, can at fp8; cpu can't run sdxl; amd needs ROCm; api needs apiNodes; `bestRunnable` prefers the faster real gen time), power breaker (cps 0 past the budget), quantize fees (setup + FP8 always undercuts the native rig), hashtags (deterministic per week, rollover, spam rule), studio queue/concurrency, offline (cap, efficiency, contracts progressed, events expired, rollover announced once), save roundtrip + corrupt blob + normalisation, map graph (acyclic, every node reachable from `core-root`, unique positions), module boundaries, format.

Added with the level, goals, Lounge, guard and ratio work (27 files under `src/game/__tests__`, 52 across the repo):
- `level.test.ts`: `LEVEL_XP` strictly increasing with `LEVEL_XP[0] === 0`, hand-placed through 12 and then each step ×`LEVEL_XP_TAIL_GROWTH` in whole hundreds; `levelForXp` inverts `xpForLevel` at every threshold and one XP below it; a fresh state is level 1 at xp 0; the credits term is `XP_CREDITS` per decade, floored, never negative; the ledger sums as whole non-negative numbers and a corrupt row reads as zero; `xpBreakdown` lists credits first and sums to `playerXp`; `grantXp` floors, ignores zero and NaN, replaces a corrupt row and moves the level the moment the threshold is banked; `postXp` per model level and viral, never less for a higher-level model on the shipped table; `dailyXp` capped at the end of the cycle; `hardwareUnlockedAt`, `levelRoadmap` and `nextUnlocks` (one rung per level, every shipped unit and model on exactly one rung, the Lounge at its level and nowhere else, nothing above MAX_LEVEL); `settleLevelUps` pays `max(100 × L, round(90 × cps))` once per level in order, names the models and the hardware in catalog order, is silent on a second call and never runs past MAX_LEVEL; `tick` and `applyOffline` pay a crossed level; a rebrand keeps the level and the ledger and banks its own XP; a blob without `levelSeen` hydrates to the derived level and the next tick pays nothing; the ledger round-trips and a blob from before it is seeded.
- `xp.test.ts`: one grant per source through the real actions and engine, each asserting the `xp` event and the ledger: `buyHardware` first unit only (and nothing when the level refuses), `buyUpgrade` named against tier, `setupModel`, `quantize` new tier only, `grantGift`, `unlockMapNode`, `trainLora`, `claimContract` answering with the `xp` event alone, `claimDaily` on day 1 and day 7 and `claimDailyFromServer`, `rebrand` with the ledger surviving the reset, the milestone in `tick`, `checkAchievements`, `settlePosts` landed / viral / ratioed; a click, the wheel and the coin leave the ledger alone.
- `models-data.test.ts`: every model has an integer `minLevel` in 1..12; `sd15` is 1; every level 2 to 12 unlocks at least one model; every API model is ≥ 7; every video model is ≥ 5; `minLevel` never falls as VRAM rises within a local kind.
- `hardware-data.test.ts` (level gate): every unit has an integer `minLevel` in 1..MAX_LEVEL, absent reading as 1; the two CPUs are 1; the gate table, every unit on exactly one rung; at least one unit at every level 2 to 12; never lower as `baseCost` rises along the main chain; no prerequisite gated above the unit that needs it; no checkpoint unlocked before a card that holds it natively.
- `hardware.test.ts` / `guidance.test.ts`: `canBuy` on a level-locked unit prints the checkpoint string; `explainBuy` puts the level after the unlock condition and before the cap and the money, and `canBuy` prints it; `describeCause(explainRun(...))` still equals `lockReason(...)` for every model.
- `goals.test.ts`: `condProgress` per condition type (`all` as the minimum, `any` as the maximum, clamped, binary labels equal to `describeUnlock`); `nextAchievements` excludes hidden, earned and complete rows and ranks correctly; `nextGoal`'s priority order over fixture states, the `level` goal with its `unlocks` when the next rung is affordable but locked (capped at `LEVEL_GOAL_UNLOCKS`, hardware first), `levelBlocked` false when the unlock condition, family or cap also fails; `goalKey` and `isGoalDone` per kind; `saveTarget` skips a level-locked unit and agrees with the store hook at every scale and level.
- `save.test.ts` (the ledger): round-trips as written; an empty ledger stays empty; a blob from before it is seeded from its counters; a seeded ledger above the watermark is paid on the next settle; unknown sources are dropped and the rest rounded down.
- `gamble.test.ts`: weights sum to 1 and ids are unique; `spinEv()` is 0.954 and `coinEv()` 0.96, both under 1; 200k `mulberry32` rolls land on the analytic EV; the economic invariant, 50k simulated bets a table returning under 1 per credit staked; every rejection path with its exact copy; `applySpin` deducts, pays `round(wager × mult)` and emits exactly one `spin`; **`lifetimeCredits` and `seasonCredits` never move**; the free spin deducts nothing; pity converts the third NaN; hot pays ×1.5 after three wins; the coin pays double on your side at the measured rate and streaks to `coinFive`; a blob without `gamble` loads the defaults.
- `citizens.test.ts`: a handle is built from the catalog pools and is deterministic per rng; gaps grow as heat falls; a due run pays a royalty, a run and a point of rep and lands in the feed; at most one run per drop however long the tab was closed; a drop cools with every run, is cold past `CITIZEN_TREND_MS`, and pays out under 90 seconds of income over its whole life; the board keeps the newest drop and the feed keeps `CITIZEN_FEED_MAX` entries.
- `clickGuard.test.ts`: 15 clicks in a second pay and the 16th is refused with `rate` while moving nothing; 25 clicks at a flat 100 ms trip `cadence` with a 10 s lock and the flag; jittered human cadences trip nothing; 100 clicks at a flat 333 ms trip nothing (slow regularity is allowed); the 10 / 30 / 60 escalation and the decay; the click-frenzy egg still reachable; `cadence([])` is zeros; the hydrate clamp.
- `hashtags.test.ts` / `virality.test.ts`: `explicit` excludes keyword hits and `mismatchedTypeTags` returns catalog order; a ratioed roll has the flop band, no viral, trend 1, the dislike formula, the spark still armed and the flag set; `settlePosts` drains the bank, floors at 0, leaves the lifetime counters alone, bumps the three stats, drops followers without going negative and emits one `postResolved` with `ratioed: true`; a correctly typed tag pays exactly what an untagged post pays; `upscalePost` refuses a ratio.
- `actions-new.test.ts`: a blocked click moves nothing at all; the lucky seed tags the event and never burns on a refused click; `setupModel` refuses below `minLevel` with the exact string and `queueJob` does not re-check it; the spin rejection copy passes straight through; the founder card racks free without throttling and the Sonam credits go through the normal path; `completeTutorial` announces no easter egg; a rewarded achievement pays exactly once; the four `createJob` prompt eggs.
- `src/state/__tests__/autosave.test.ts`: the `autosaveDue` table, a burst of buys writing once, `click` never scheduling an action save, a throwing `setItem` raising and clearing `saveError`.
- `src/audio/__tests__/sfxMap.test.ts` (node): `cueForEvent` answers for every `GameEvent['type']`, the click limiter, `comboRate`, and a recipe plus a shipped file for every `SfxName`.
