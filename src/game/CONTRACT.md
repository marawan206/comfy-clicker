# Game core contract

Read this before writing any file under `src/game` or `src/data`. Everything here is pure TypeScript
(no React, no DOM, no `window`). Types come from `src/game/types.ts`; tunables from `src/game/constants.ts`.
Data enters every function through a `Catalog` so tests can pass small fixtures. Two documented
exceptions default to the shipped data when the argument is omitted: `save.ts` (`CATALOG`) and the
RP/CP balance helpers in `map.ts` (`MAP_NODES`). Everything else (`trendMult`, `matchedTrending`,
`claimContract` included) requires the catalog. `src/data` may import only `@/game/types` and
`@/game/constants` (enforced by `__tests__/data-boundaries.test.ts`).

## Catalog: `src/data/index.ts`
```ts
export interface Catalog {
  hardware: HardwareDef[]; models: ModelDef[]; precisions: Record<Precision, PrecisionDef>
  upgrades: UpgradeDef[]; mapNodes: MapNodeDef[]; achievements: AchievementDef[]
  hashtags: HashtagDef[]; contracts: ContractDef[]; events: EventDef[]
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
`formatNum(n, digits = 2)`: `< 1000` → grouped integer; else 3 significant digits with suffixes `K M B T Qa Qi Sx Sp Oc No`; `formatCps(n)` (1 decimal below 10, else formatNum + "/s"), `formatDuration(sec)` (`0:42`, `3:50`, `1h 02m`, `2d 4h`), `formatPct(x)` (`+25%`), `formatWatts(w)` (`650 W`, `1.2 kW`, `3.4 MW`), `formatCompactDate(ts)`.

## state.ts
`createInitialState(now, guestId): GameState`: owns `pc-4c8t: 1`, `models.sd15 = { precisions: ['native'], setup: true }`, everything else empty/zero, `contracts.nextRotateAt = now`, `events.nextAt = now + EVENT_MIN_GAP_MS`, `daily = { lastClaimDay: null, streak: 0, claimed: [] }`, `weekOverride: null`, `liveTrending: null`.
`statValue(state, key: StatKey, derived?): number`. `STAT_LABELS`, and `FAMILY_LABELS: Record<HardwareFamily, string>`, the one table of family words shared by lock reasons (`hardware.ts`) and unlock hints (`unlock.ts`); each label is the stem of the store tab label in `HARDWARE_FAMILIES` (`CPU`, `Apple`, `NVIDIA`, `AMD`, `workstation`, `datacenter`, `cloud node`, `region`).

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

## hashtags.ts
`weekIndex(now, weekSpeed = 1) = floor(now / (WEEK_MS / weekSpeed))`; `trendingForWeek(week, catalog): string[]` (TRENDING_COUNT distinct ids via mulberry32(week), at least one non-type tag); `currentTrending(state, now, catalog, weekSpeed: number)`: `weekSpeed` is **required** and must be `derived.weekSpeed` (the Fast Weeks node halves the week) = `liveTrending.tags` if `now − fetchedAt < 30 min` else `trendingForWeek(weekOverride ?? weekIndex(now, weekSpeed))`; `msUntilRollover(now, weekSpeed)`: the UI passes `derived.weekSpeed` here too.
`matchTags(prompt, selected: string[], catalog): { matched: string[]; keywordHits: number }`: word-boundary keyword match (lowercase), literal `#tag`, plus explicitly selected ids; dedupe.
`trendMult(matched, trending, extraKeywordHits, kind, catalog)`: matched trending ids sorted by weight → `1 + TRENDING_WEIGHTS[i]` for first MAX_MATCHED_TRENDING; if > MAX_MATCHED_TRENDING matched → `1.0` (spam); type tags (`kind`) count as free +0.2 without occupying a slot; `+ EXTRA_KEYWORD_BONUS × min(MAX_EXTRA_KEYWORDS, extraKeywordHits)`. `matchedTrending(matched, trending, kind, catalog)`.

## studio.ts
`jobCost(model, precision, derived, catalog) = round(max(baseCost, costSecs × cps) × precisions[p].costMult × (model.api ? API_COST_MULT : 1))`. `API_COST_MULT = 1.5` lives in constants.ts (re-exported here).
`createJob(state, derived, catalog, input: {modelId, precision, prompt, tags, hubWorkflowId?}, now, rng): { ok: true; job: Job } | { ok: false; reason: string }`: model owned+setup, precision unlocked, runnable, credits, `queue.length < MAX_QUEUE`; deducts credits; `durationMs = genTimeMs(...)` for `bestRunnable`; pushes `startedAt: null`.
`advanceQueue(state, derived, catalog, now, rng): GameEvent[]`: start pending up to `concurrency`; finish when `endsAt − clickBonusMs ≤ now` → `rollPost` → unshift into `posts` (cap MAX_POSTS, dropping only `granted` posts).
`applyClickToJobs(state, now): boolean`: adds CLICK_JOB_BONUS_MS to the earliest running job up to `CLICK_JOB_BONUS_CAP × durationMs`.

## virality.ts
`rollPost(job, state, derived, catalog, now, rng): Post`:
- `M`: `chance(viralChance)` → uniform(3, 8) viral; else `chance(flopChance)` → uniform(0.3, 0.6) flop; else uniform(0.85, 1.35).
- `{matched, keywordHits} = matchTags(prompt, tags)`; `trending = currentTrending(…, derived.weekSpeed)`; `trend = trendMult(...)`; repost penalty ×REPOST_PENALTY if `stats.lastPostKey === repostKey(modelId, matched, prompt)` = `modelId + '|' + matched.sort().join(',') + '|' + normalizePromptText(prompt).trim()` (same model, tags *and* prompt; a fresh prompt with the same tags is a new post, not a repost).
- `quality = precisions[p].qualityMult`, `audience = 1 + log10(1 + followers / AUDIENCE_REF_DIVISOR)`, `tagBonus = Π (1 + tagLikes[tag])`, `eventBoost` from events, `founder = chance(FOUNDER_BOOST_CHANCE) || prompt mentions yoland/robin (once, flag) → ×3`.
- `targetLikes = max(1, round(M × trend × quality × baseLikes × audience × likesMult × tagBonus × eventBoost × founder))`.
- **Credits follow the roll, not the reach**: `credits = (payoutRatio + payoutBonus) × paid × M × quality` where `paid = job.cost / API_COST_MULT` for API models (the surcharge is a fee) and `job.cost` otherwise; `creditsPerLike = credits / targetLikes`, so the card's `likes × cpl = credits` still adds up while trend, audience, likesMult, tag bonuses, events and the founder boost move likes → followers → RP/contracts only. Untagged EV/cost = `E[M] × payoutRatio` ≈ 1.23 × payoutRatio regardless of upgrades.
- `cost = job.cost` (snapshot; upscales are priced off it), `windowMs = POST_WINDOW_MS`; `thumb = pickThumbTag(model, prompt)`, a keyword (overlap with `model.thumbTags`, else `hashString(prompt) % pool`), **not** an asset id: the UI resolves it with `assetManifest.pickThumb(thumbFamilyFor(post.modelId, post.kind), post.prompt, hashString(post.prompt))`.
`likesAt(post, now) = floor(targetLikes × (1 − (1 − p)³))`, `p = clamp((now − createdAt) / windowMs, 0, 1)`.
`settlePosts(state, derived, catalog, now): GameEvent[]`: pays `(newLikes − likes) × cpl` into credits/lifetime/season (with `newLikes = max(post.likes, likesAt)`, so never negative); when complete and `!granted`: followers via social.ts, stats (videos/flops/virals/bestPostLikes), `granted = true`, emit `postResolved`.

## social.ts
`addFollowers(state, n): GameEvent[]`: `followersFrac` accumulator; signups when `lifetimeFollowers` crosses `SIGNUP_THRESHOLDS` then ×SIGNUP_GROWTH beyond the table; each signup `rp += 1`, emit `signup`. `audienceMult(followers)`.

## contracts.ts / events.ts / daily.ts / prestige.ts / achievements.ts / offline.ts
- contracts: `rotateContracts(state, derived, catalog, now, rng)` keeps CONTRACT_SLOTS active (eligible by `minTier ≤ bestTier`, no duplicates), `rewardCredits = rewardSecs × cps` at acceptance (min 100); `progressContracts(state, events: GameEvent[], catalog)`; `claimContract(state, idx, catalog): GameEvent[]` (catalog required).
- events: `maybeStartEvent(state, derived, catalog, now, rng): GameEvent[]` (gap uniform(EVENT_MIN_GAP_MS, EVENT_MAX_GAP_MS), weighted by `weight`, `minTier`); `expireEvents(...)`; `eventEffects(state, catalog): Effect[]` (modelDrop → tagLikes +1.0 on payload tag; cloudPromo → globalMult ×2; powerSurge → `powerBudget −0.4 × ownedPowerBudget(state, catalog)`, i.e. 40 % of the rig's *current* budget from the base circuit plus owned upgrades/map nodes; nodeBroke → ×0.5; spotReclaim → rigMult 0 unless reserved capacity); `resolveEvent(state, defId, now)` (nodeBroke fixed by click, trendingSpark caught → flag `sparkNext`, which is ×3 likes on the next post).
- daily: `dayKey(now) = YYYY-MM-DD UTC`; `canClaim(state, now)`; `claimDaily(state, derived, now): GameEvent[]`: streak continues if last claim was yesterday (or two days ago with `streakGrace`), else resets to 1; day n (1..7 cycle) reward `max(DAILY_MIN_CREDITS, cps × DAILY_BASE_SECS × n)`, day 3 `rp += 1`, day 7 `cp += 1`.
- prestige: `canRebrand(state, catalog)` (owns any `cloud-node` or `region`); `rebrandCp(lifetimeSeasonCredits) = floor((seasonCredits / REBRAND_CP_DIVISOR) ** REBRAND_CP_EXP)`; `creditsForCp(cp)` (inverse); `rebrand(state, catalog, now): GameEvent[]`: reset credits/seasonCredits/hardware/hardwareTiers/upgrades(non-prestige)/models(keep sd15)/queue/posts/**followers, followersFrac**/contracts/events; keep achievements, mapNodes (all), rp, cp, cpSpent, loras, hubRep, daily, flags, lifetimeFollowers/lifetimeLikes/signups; apply `startHardware` effects; `season += 1`, `stats.rebrands += 1`. The Rebrand dialog must list followers among the losses.
- achievements: `checkAchievements(state, derived, catalog): GameEvent[]`.
- offline: `applyOffline(state, derived, catalog, now): { elapsedSec, gain, events }`: `elapsed = (now − lastTickAt)/1000`; if `≤ SHORT_GAP_S` full-rate catch-up without report; else `capped = min(elapsed, offlineCapHours × 3600)`, `gain = cps × capped × derived.offlineEfficiency` (`OFFLINE_EFFICIENCY = 0.5`; `Comfy Cloud: Always On` raises it to 1; the cap starts at 8 h and tops out at 48 h across every source); replay finishes jobs whose `endsAt ≤ now` sequentially, expiring random events as it passes their end; settle posts fully; **`progressContracts` on the resulting events**; `stats.offlineClaims += 1` when `elapsed ≥ 60`; emit `weekRollover` if the trending week changed while away (and `primeTickMemo` so the tick stays quiet); `checkAchievements`.

## engine.ts / actions.ts
`tick(state, derived, catalog, dtSec, now, rng): GameEvent[]`: income `cps × dt`, `playedSec`, `advanceQueue`, `settlePosts`, `expireEvents`, `maybeStartEvent`, `progressContracts`, `rotateContracts` when due, achievements at most once per second, week rollover detection (`weekRollover` event with new tags), cps power-of-10 milestones (`milestone`), breaker flip (`powerThrottle`), `lastTickAt = now`. `DERIVED_EVENT_TYPES` / `needsDerived(events)` tell the caller when to recompute `Derived`: the store should use `needsDerived` rather than its own list. `resetTickMemo(state)`, `primeTickMemo(state, derived, now)`.
`actions.ts`: every action is `(ctx: ActionContext, ...args) => ActionResult` with `ActionContext = { state, derived, catalog, now, rng }` and `ActionResult = { events: GameEvent[]; dirty: boolean; error?: string }` (`dirty` ⇒ caller recomputes derived; validation failures return `{ events: [], dirty: false, error }` and leave the state untouched):
`click(ctx)`, `buyHardware(ctx, id, n: BuyCount = 1)` with `BuyCount = 1 | 10 | 100 | 'max'`, `buyUpgrade(ctx, id)`, `unlockMapNode(ctx, id)`, `quantize(ctx, modelId, precision)`, `setupModel(ctx, modelId)`, `trainLora(ctx, tagId)` (cost = 20 min of cps, min 500), `queueJob(ctx, input: QueueJobInput)` (re-exported `JobInput`; also progresses contracts for any job it finishes on the way in), `claimContract(ctx, i)`, `claimDaily(ctx)`, `rebrand(ctx)`, `resolveEvent(ctx, defId)`, `toggleSetting(ctx, key: keyof GameSettings, value?: boolean)`, `setFlag(ctx, key)` (UI discovery flags, `UI_FLAGS = konami, ticker-seven, seed42, rickroll`, set once, emits `easterEgg`, `dirty: false`), `upscalePost(ctx, postId)` (cost `UPSCALE_COST_FRACTION` = 30% of the post's **original** `post.cost`, adds a second wave of 40% likes at the post's own credits/like; refused on flops). `upscaleCost(post, ctx)`, `loraCost(derived)`, `clickRate(state, now)`.

## save.ts / loop.ts
`serialize(state): string`; `loadSave(raw: string | null, now, guestId, catalog = CATALOG): { state, corrupt, migratedFrom }`: **this is how the caller learns about corruption**: the store must call `loadSave` and stash the raw blob under `SAVE_CORRUPT_KEY` (`SAVE_KEY + '.corrupt'`) when `corrupt` is true; `deserialize(raw, now, guestId, catalog = CATALOG): GameState` is the convenience wrapper that always returns a state. Zod schema (`saveSchema`), `MIGRATIONS: Record<number, (s: unknown) => unknown>` up to SAVE_VERSION, unknown ids dropped, missing or invalid fields filled from `createInitialState` (a record field that is not a record falls back whole, so the starter PC and SD 1.5 survive; `hydrate` additionally guarantees both). Hydration normalises queued jobs (a running job always has `endsAt = startedAt + durationMs`, a pending one has none, `clickBonusMs ≤ CLICK_JOB_BONUS_CAP × durationMs`) and pulls timestamps from a clock that ran ahead back to `now` (`lastTickAt`, `events.nextAt ≤ now + EVENT_MAX_GAP_MS`, `contracts.nextRotateAt ≤ now + CONTRACT_ROTATE_MS`, `liveTrending.fetchedAt`, post `createdAt`, job timestamps shifted together, active events). `exportString(state)` = `'CC1|' + base64(utf8 json)` (chunked, no call-stack spread), `importString(s)`.
`startLoop({ tick, render, onLongGap }): () => void`: rAF accumulator, fixed STEP_S, `MAX_CATCHUP_S = 5`, beyond that calls `onLongGap(elapsedSec, now)`; the next frame is always requested (try/finally) so a throwing tick or listener cannot silently stop the loop.

## Tests (`src/game/__tests__`)
Vitest, node env. Use `CATALOG` for integration-style tests and tiny inline catalogs for unit tests. Required: economy (cost formulas; payback strictly decreasing up to the RTX PRO 6000 and strictly increasing after it along the non-Apple, non-Radeon ladder), pacing sim (`scripts/balance.ts` exports `simulate(strategy, seconds)` and `projectWeek(strategy)`, models the power throttle and the CP gates; climb strategy reaches `rtx-pro-6000` < 15 min and a cloud node < 25 min at 3 clicks/s, owns no region inside 3 h of continuous play, and neither the orbital datacenter nor the Dyson swarm by day 7 of a one-hour-a-day week), virality EV bands (untagged native EV/cost in [1.05, 1.6] for local models and [0.95, 1.1] net of the surcharge for API models, over 20k rolls; viral rate 4–6%; reach multipliers leave credits unchanged), hardware gating (3060 can't run flux-dev native, can at fp8; cpu can't run sdxl; amd needs ROCm; api needs apiNodes; `bestRunnable` prefers the faster real gen time), power throttle (proportional), quantize fees (setup + FP8 always undercuts the native rig), hashtags (deterministic per week, rollover, spam rule), studio queue/concurrency, offline (cap, efficiency, contracts progressed, events expired, rollover announced once), save roundtrip + corrupt blob + normalisation, map graph (acyclic, every node reachable from `core-root`, unique positions), module boundaries, format.
