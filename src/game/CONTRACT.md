# Game core contract

Read this before writing any file under `src/game` or `src/data`. Everything here is pure TypeScript
(no React, no DOM, no `window`). Types come from `src/game/types.ts`; tunables from `src/game/constants.ts`.
Data enters every function through a `Catalog` so tests can pass small fixtures.

## Catalog — `src/data/index.ts`
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

Hardware ids are kebab-case (`pc-4c8t`, `rtx-3060`, `rtx-4090`, `rtx-pro-6000`, `h100-80`, `aws-p5-8xh100`, `region-us-east`…), model ids too (`sd15`, `sdxl`, `flux-dev`, `wan22-5b`, `ltx2`…), hashtag ids equal the tag without `#`.
Tier upgrades are virtual upgrade ids `tier:<hardwareId>:<1..4>` produced by `generateTierUpgrades(hardware)` in `src/data/upgrades.ts` (thresholds/costs/effect from constants; effect `{kind:'rigMult', hardwareId, value: 2}`).

## rng.ts
`mulberry32(seed): Rng`, `hashString(s): number` (uint32), `uniform(rng, a, b)`, `pick(rng, arr)`, `weightedPick(rng, arr /* {weight} */)`, `chance(rng, p)`.

## format.ts
`formatNum(n, digits = 2)` — `< 1000` → grouped integer; else 3 significant digits with suffixes `K M B T Qa Qi Sx Sp Oc No`; `formatCps(n)` (1 decimal below 10, else formatNum + "/s"), `formatDuration(sec)` (`0:42`, `3:50`, `1h 02m`, `2d 4h`), `formatPct(x)` (`+25%`), `formatWatts(w)` (`650 W`, `1.2 kW`, `3.4 MW`), `formatCompactDate(ts)`.

## state.ts
`createInitialState(now, guestId): GameState` — owns `pc-4c8t: 1`, `models.sd15 = { precisions: ['native'], setup: true }`, everything else empty/zero, `contracts.nextRotateAt = now`, `events.nextAt = now + EVENT_MIN_GAP_MS`, `daily = { lastClaimDay: null, streak: 0, claimed: [] }`, `weekOverride: null`, `liveTrending: null`.
`statValue(state, key: StatKey, derived?): number`.

## unlock.ts
`isUnlocked(cond: UnlockCond | undefined, state, derived, catalog): boolean` — `undefined` = always.

## economy.ts
`unitCost(def, owned) = Math.ceil(def.baseCost * def.growth ** owned)`, `bulkCost(def, owned, n)`, `maxAffordable(def, owned, credits)`, `paybackSec(def, derived)`.

## derived.ts
`activeEffects(state, catalog): Effect[]` — from owned upgrades (incl. virtual tier upgrades), unlocked map nodes, active events (see events.ts `eventEffects`).
`computeDerived(state, catalog): Derived`:
- `rawCps = Σ count × baseCps × rigMult[id] × familyMult[family]`; `globalMult = Π(1+globalMult effects) × (1 + RP_MULT_PER_POINT × rp) × (1 + ACHIEVEMENT_MULT × achievements) × cpMult`; `cpMult = 1 + CP_MULT_PER_POINT × cp × Π cpMult effects`; `cps = rawCps × globalMult × (throttled ? POWER_THROTTLE : 1)`.
- `powerDraw = Σ count × watts`, `powerBudget = POWER_BUDGET_BASE + Σ powerBudget effects`, `throttled = powerDraw > powerBudget`.
- `bestVram/bestTier/bestHardwareId` over owned units (regions = Infinity); `hasGpu` = any owned unit that is not `cpuOnly` and not `mps`.
- `clickValue = ((1 + clickFlat) × Π clickMult × globalMult + clickCpsPct × cps)`.
- `concurrency = 1 + Σ concurrency`, `speedMult = Π speedMult`, `likesMult = Π likesMult`, `payoutBonus = Σ payoutRatio`, `followRate = FOLLOW_RATE_BASE × Π followRate`, `viralChance = VIRAL_CHANCE_BASE + Σ`, `flopChance = max(0.02, FLOP_CHANCE_BASE − Σ)`, `offlineCapHours = OFFLINE_CAP_HOURS_BASE + Σ` (Infinity if any Infinity), flags from effect kinds, `unlockedFamilies` (cpu/apple/nvidia-consumer/workstation/datacenter/cloud-node/region always; `amd-consumer` needs `unlockFamily`), `tagLikes`, `familyGenTime`, `coolingTier`, `weekSpeed = Π weekSpeed`.

## hardware.ts
`canBuy(def, state, derived, catalog, n = 1): { ok: boolean; reason?: string }` — family locked (ROCm), unlock cond, max, credits.
`runsOn(model, precision, hw, derived, catalog): boolean` — `hw.vram ≥ model.vram × precisions[precision].vramMult`; `hw.cpuOnly → model.cpuOk`; `hw.mps → model.mpsOk && kind === 'image'`; `hw.rocm → model.rocmOk || (!model.needsZluda) || derived.zluda`; `model.api → derived.apiNodes` (any hardware).
`runnableHardware(...)`, `bestRunnable(...)` (highest speedTier, then vram), `nativeTier(model, catalog)` = speedTier of the cheapest non-cpu hardware that runs it natively, `lockReason(model, precision, state, derived, catalog): string | null` (e.g. `Needs 20 GB · your best card has 12 GB · quantize FP8 for 450 or buy an RTX 4090`).
`genTimeMs(model, precision, hw, derived, catalog)` = clamp(baseTime × TIER_DELTA_FACTOR^(nativeTier − hw.speedTier − cooling) for below, × ABOVE_TIER_FACTOR^Δ for above, GEN_TIME_MIN_S, GEN_TIME_MAX_S) × precision.timeMult × speedMult × familyGenTime[family] × (mps ? 2 : 1) × (rocm ? 1.25 : 1) → ms.

## quantize.ts
`nativeHardware(model, catalog): HardwareDef | null` (cheapest non-cpu unit that runs it at native).
`quantFee(model, precision, catalog) = round(feeFraction × nativeHardware.baseCost)`; `canQuantize(model, precision, state, catalog)`; `applyQuantize(state, modelId, precision, fee)`; `setupFee(model, derived, catalog) = model.vram > derived.bestVram ? SETUP_FEE_MULT × model.baseCost : 0`.

## hashtags.ts
`weekIndex(now, weekSpeed = 1) = floor(now / (WEEK_MS / weekSpeed))`; `trendingForWeek(week, catalog): string[]` (TRENDING_COUNT distinct ids via mulberry32(week), at least one non-type tag); `currentTrending(state, now, catalog)` = `liveTrending.tags` if `now − fetchedAt < 30 min` else `trendingForWeek(weekOverride ?? weekIndex(now, derived.weekSpeed))`; `msUntilRollover(now, weekSpeed)`.
`matchTags(prompt, selected: string[], catalog): { matched: string[]; keywordHits: number }` — word-boundary keyword match (lowercase), literal `#tag`, plus explicitly selected ids; dedupe.
`trendMult(matched, trending, extraKeywordHits, kind)`: matched trending ids sorted by weight → `1 + TRENDING_WEIGHTS[i]` for first MAX_MATCHED_TRENDING; if > MAX_MATCHED_TRENDING matched → `1.0` (spam); type tags (`kind`) count as free +0.2 without occupying a slot; `+ EXTRA_KEYWORD_BONUS × min(MAX_EXTRA_KEYWORDS, extraKeywordHits)`.

## studio.ts
`jobCost(model, precision, derived, catalog) = round(max(baseCost, costSecs × cps) × precisions[p].costMult × (model.api ? 1.5 : 1))`.
`createJob(state, derived, catalog, input: {modelId, precision, prompt, tags, hubWorkflowId?}, now, rng): { ok: true; job: Job } | { ok: false; reason: string }` — model owned+setup, precision unlocked, runnable, credits, `queue.length < MAX_QUEUE`; deducts credits; `durationMs = genTimeMs(...)` for `bestRunnable`; pushes `startedAt: null`.
`advanceQueue(state, derived, catalog, now, rng): GameEvent[]` — start pending up to `concurrency`; finish when `endsAt − clickBonusMs ≤ now` → `rollPost` → unshift into `posts` (cap MAX_POSTS, dropping only `granted` posts).
`applyClickToJobs(state, now): boolean` — adds CLICK_JOB_BONUS_MS to the earliest running job up to `CLICK_JOB_BONUS_CAP × durationMs`.

## virality.ts
`rollPost(job, state, derived, catalog, now, rng): Post`:
- `M`: `chance(viralChance)` → uniform(3, 8) viral; else `chance(flopChance)` → uniform(0.3, 0.6) flop; else uniform(0.85, 1.35).
- `{matched, keywordHits} = matchTags(prompt, tags)`; `trending = currentTrending`; `trend = trendMult(...)`; repost penalty ×REPOST_PENALTY if `stats.lastPostKey === modelId + '|' + matched.sort().join(',')`.
- `quality = precisions[p].qualityMult`, `audience = 1 + log10(1 + followers / AUDIENCE_REF_DIVISOR)`, `tagBonus = Π (1 + tagLikes[tag])`, `eventBoost` from events, `founder = chance(FOUNDER_BOOST_CHANCE) || prompt mentions yoland/robin (once, flag) → ×3`.
- `targetLikes = round(M × trend × quality × baseLikes × audience × likesMult × tagBonus × eventBoost × founder)`.
- `creditsPerLike = (payoutRatio + payoutBonus) × job.cost / (baseLikes × audienceRef)` where `audienceRef = audience` at post time (so the card shows `likes × cpl = credits`).
- `windowMs = POST_WINDOW_MS`; `thumb = pickThumb(model, prompt)` — keyword overlap with `model.thumbTags` else `hashString(prompt) % pool`.
`likesAt(post, now) = floor(targetLikes × (1 − (1 − p)³))`, `p = clamp((now − createdAt) / windowMs, 0, 1)`.
`settlePosts(state, derived, catalog, now): GameEvent[]` — pays `(newLikes − likes) × cpl` into credits/lifetime/season; when complete and `!granted`: followers via social.ts, stats (videos/flops/virals/bestPostLikes), `granted = true`, emit `postResolved`.

## social.ts
`addFollowers(state, n): GameEvent[]` — `followersFrac` accumulator; signups when `lifetimeFollowers` crosses `SIGNUP_THRESHOLDS` then ×SIGNUP_GROWTH beyond the table; each signup `rp += 1`, emit `signup`. `audienceMult(followers)`.

## contracts.ts / events.ts / daily.ts / prestige.ts / achievements.ts / offline.ts
- contracts: `rotateContracts(state, derived, catalog, now, rng)` keeps CONTRACT_SLOTS active (eligible by `minTier ≤ bestTier`, no duplicates), `rewardCredits = rewardSecs × cps` at acceptance (min 100); `progressContracts(state, events: GameEvent[], catalog)`; `claimContract(state, idx): GameEvent[]`.
- events: `maybeStartEvent(state, derived, catalog, now, rng): GameEvent[]` (gap uniform(EVENT_MIN_GAP_MS, EVENT_MAX_GAP_MS), weighted by `weight`, `minTier`); `expireEvents(...)`; `eventEffects(state, catalog): Effect[]` (modelDrop → tagLikes +1.0 on payload tag; cloudPromo → globalMult ×2 … encode as Effect); `resolveEvent(state, defId, now)` (nodeBroke fixed by click, trendingSpark caught → flag `sparkNext`).
- daily: `dayKey(now) = YYYY-MM-DD UTC`; `canClaim(state, now)`; `claimDaily(state, derived, now): GameEvent[]` — streak continues if last claim was yesterday (or two days ago with `streakGrace`), else resets to 1; day n (1..7 cycle) reward `max(DAILY_MIN_CREDITS, cps × DAILY_BASE_SECS × n)`, day 3 `rp += 1`, day 7 `cp += 1`.
- prestige: `canRebrand(state, catalog)` (owns any `cloud-node` or `region`); `rebrandCp(lifetimeSeasonCredits) = floor((seasonCredits / REBRAND_CP_DIVISOR) ** REBRAND_CP_EXP)`; `rebrand(state, catalog, now): GameEvent[]` — reset credits/seasonCredits/hardware/hardwareTiers/upgrades(non-prestige)/models(keep sd15)/queue/posts/contracts/events; keep achievements, mapNodes (branch !== 'core' & not `hidden`? keep all), rp, cp, loras, hubRep, daily, flags; apply `startHardware` effects; `season += 1`, `stats.rebrands += 1`.
- achievements: `checkAchievements(state, derived, catalog): GameEvent[]`.
- offline: `applyOffline(state, derived, catalog, now): { elapsedSec, gain, events }` — `elapsed = (now − lastTickAt)/1000`; if `≤ SHORT_GAP_S` full-rate catch-up without report; else `capped = min(elapsed, offlineCapHours × 3600)`, `gain = cps × capped × OFFLINE_EFFICIENCY`; finish jobs whose `endsAt ≤ now` sequentially; settle posts fully; `stats.offlineClaims += 1` when `elapsed ≥ 60`.

## engine.ts / actions.ts
`tick(state, derived, catalog, dtSec, now, rng): GameEvent[]` — income `cps × dt`, `playedSec`, `advanceQueue`, `settlePosts`, `expireEvents`, `maybeStartEvent`, `rotateContracts` when due, achievements at most once per second, week rollover detection (`weekRollover` event with new tags), cps power-of-10 milestones (`milestone`), `lastTickAt = now`.
`actions.ts` — each returns `{ events: GameEvent[]; dirty: boolean }` (dirty ⇒ caller recomputes derived): `click`, `buyHardware(id, n)`, `buyUpgrade(id)`, `unlockMapNode(id)`, `quantize(modelId, precision)`, `setupModel(modelId)`, `trainLora(tagId)` (cost = 20 min of cps, min 500), `queueJob(input)`, `claimContract(i)`, `claimDaily`, `rebrand`, `resolveEvent(defId)`, `toggleSetting`, `upscalePost(postId)` (cost 30% of original job cost, adds a second wave of 40% likes). Validation failures return `{ events: [], dirty: false, error: string }`.

## save.ts / loop.ts
`serialize(state): string`; `deserialize(raw: string | null, now, guestId): GameState` — zod schema (`saveSchema`), `MIGRATIONS: Record<number, (s: unknown) => unknown>` up to SAVE_VERSION, unknown ids dropped, missing fields filled from `createInitialState`; corrupt input → fresh state (caller keeps the raw blob under `SAVE_KEY + '.corrupt'`). `exportString(state)` = `'CC1|' + base64(utf8 json)` (chunked, no call-stack spread), `importString(s)`.
`startLoop({ tick, render, onLongGap }): () => void` — rAF accumulator, fixed STEP_S, `MAX_CATCHUP = 5 s`, beyond that calls `onLongGap(elapsedSec, now)`.

## Tests (`src/game/__tests__`)
Vitest, node env. Use `CATALOG` for integration-style tests and tiny inline catalogs for unit tests. Required: economy (cost formulas, payback strictly decreasing across the NVIDIA/workstation/datacenter ladder), pacing sim (`scripts/balance.ts` exports `simulate(strategy, seconds)`; climb strategy reaches `rtx-pro-6000` < 15 min and a cloud node < 25 min at 3 clicks/s), virality EV bands (untagged native EV/cost in [1.05, 1.6] per model over 20k rolls, viral rate 4–6%), hardware gating (3060 can't run flux-dev native, can at fp8; cpu can't run sdxl; amd needs ROCm; api needs apiNodes), power throttle, quantize fees, hashtags (deterministic per week, rollover, spam rule), studio queue/concurrency, offline cap, save roundtrip + corrupt blob, map graph (acyclic, every node reachable from `core-root`, unique positions), format.
