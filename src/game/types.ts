/**
 * Core contracts for Comfy Clicker. Pure TypeScript, no React imports here.
 * Balance numbers live in `src/data/*`; formulas live in the sibling modules.
 */

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------
export type Vendor = 'nvidia' | 'amd' | 'apple' | 'intel' | 'cpu' | 'aws' | 'azure' | 'runpod' | 'comfy'
export type HardwareFamily =
  | 'cpu'
  | 'apple'
  | 'nvidia-consumer'
  | 'amd-consumer'
  | 'workstation'
  | 'datacenter'
  | 'cloud-node'
  | 'region'

export interface HardwareDef {
  id: string
  name: string
  /** Short label for shelves/chips, e.g. "4090" */
  short: string
  family: HardwareFamily
  vendor: Vendor
  baseCost: number
  baseCps: number
  /** Per-unit price growth factor, e.g. 1.12 */
  growth: number
  /** Usable memory in GB for model gating. Infinity for regions. */
  vram: number
  /** Apple unified memory: images only, slow. */
  mps?: boolean
  /** CPU-class: runs only `cpuOk` models. */
  cpuOnly?: boolean
  /** AMD: family must be unlocked with the ROCm upgrade before purchase. */
  rocm?: boolean
  /** Watts drawn per unit (power system). */
  watts: number
  /** Generation speed tier 1..12 (higher = faster). */
  speedTier: number
  /** e.g. 8 for an 8x node (display only; VRAM is per card). */
  cardsPerUnit?: number
  /** Hard cap on owned units (e.g. regions). */
  max?: number
  /** Store visibility condition (defaults to "always"). */
  unlock?: UnlockCond
  /** Real-world reference for the tooltip, e.g. "$3.49/hr on Runpod". */
  realWorld?: string
  flavor: string
  /** Asset id in assetManifest. */
  art: string
}

// ---------------------------------------------------------------------------
// Models & precision
// ---------------------------------------------------------------------------
export type ModelKind = 'image' | 'video' | '3d' | 'audio'
export type Precision = 'native' | 'fp8' | 'q4'

export interface PrecisionDef {
  id: Precision
  label: string
  vramMult: number
  qualityMult: number
  costMult: number
  timeMult: number
  /** Fee as a fraction of the model's native rig base cost. */
  feeFraction: number
}

export interface ModelDef {
  id: string
  name: string
  /** Family key for distillation / tags, e.g. "flux", "wan". */
  family: string
  kind: ModelKind
  vendorIcon: string
  /** Native VRAM requirement in GB (0 for API models). */
  vram: number
  cpuOk?: boolean
  mpsOk?: boolean
  /** Runs on AMD without ZLUDA. Models with `needsZluda` require the ZLUDA map node on AMD. */
  rocmOk?: boolean
  needsZluda?: boolean
  /** API-node model: no VRAM, requires the API Nodes map node, pays an API surcharge. */
  api?: boolean
  baseCost: number
  /** Job cost in seconds of income: cost = max(baseCost, costSecs * cps). */
  costSecs: number
  payoutRatio: number
  baseLikes: number
  /** Base generation time in seconds at native tier. */
  baseTime: number
  quantizable?: boolean
  preinstalled?: boolean
  unlock?: UnlockCond
  flavor: string
  art: string
  /** Keyword pool used to pick a matching thumbnail for the prompt. */
  thumbTags: string[]
}

// ---------------------------------------------------------------------------
// Effects, unlock conditions, upgrades, map nodes, achievements
// ---------------------------------------------------------------------------
export type Effect =
  | { kind: 'clickFlat'; value: number }
  | { kind: 'clickMult'; value: number }
  | { kind: 'clickCpsPct'; value: number }
  | { kind: 'rigMult'; hardwareId: string; value: number }
  | { kind: 'familyMult'; family: HardwareFamily; value: number }
  | { kind: 'globalMult'; value: number }
  | { kind: 'likesMult'; value: number }
  | { kind: 'speedMult'; value: number }
  | { kind: 'concurrency'; value: number }
  | { kind: 'offlineCapHours'; value: number }
  /** Fraction of cps paid while away (the best owned value wins, floor OFFLINE_EFFICIENCY). */
  | { kind: 'offlineEfficiency'; value: number }
  | { kind: 'powerBudget'; value: number }
  | { kind: 'payoutRatio'; value: number }
  | { kind: 'followRate'; value: number }
  | { kind: 'viralChance'; value: number }
  | { kind: 'flopChance'; value: number }
  | { kind: 'unlockFamily'; family: HardwareFamily }
  | { kind: 'zluda' }
  | { kind: 'apiNodes' }
  | { kind: 'hashtagResearch' }
  | { kind: 'streakGrace' }
  | { kind: 'reservedCapacity' }
  | { kind: 'coolingTier'; family: HardwareFamily; value: number }
  | { kind: 'tagLikes'; tag: string; value: number }
  | { kind: 'familyGenTime'; family: string; value: number }
  | { kind: 'weekSpeed'; value: number }
  | { kind: 'startHardware'; hardwareId: string; count: number }
  | { kind: 'cpMult'; value: number }

export type StatKey =
  | 'lifetimeCredits'
  | 'seasonCredits'
  | 'clicks'
  | 'posts'
  | 'videos'
  | 'likes'
  | 'followers'
  | 'signups'
  | 'flops'
  | 'virals'
  | 'quantizations'
  | 'playedSec'
  | 'offlineClaims'
  | 'rebrands'
  | 'contractsDone'
  | 'hubPublished'
  | 'hubRuns'
  | 'lorasTrained'
  | 'mapNodes'
  | 'achievements'
  | 'streak'

export type UnlockCond =
  | { type: 'always' }
  | { type: 'stat'; key: StatKey; value: number }
  | { type: 'ownHardware'; id: string; count?: number }
  | { type: 'ownFamily'; family: HardwareFamily; count?: number }
  | { type: 'ownModel'; id: string }
  | { type: 'precision'; modelId: string; precision: Precision }
  | { type: 'mapNode'; id: string }
  | { type: 'upgrade'; id: string }
  | { type: 'cps'; value: number }
  | { type: 'flag'; key: string }
  | { type: 'all'; conds: UnlockCond[] }
  | { type: 'any'; conds: UnlockCond[] }

export type Currency = 'credits' | 'rp' | 'cp'

export type UpgradeCategory =
  | 'click'
  | 'hardware'
  | 'global'
  | 'studio'
  | 'social'
  | 'power'
  | 'rocm'
  | 'offline'

export interface UpgradeDef {
  id: string
  name: string
  desc: string
  flavor?: string
  cost: number
  currency?: Currency
  category: UpgradeCategory
  effects: Effect[]
  unlock: UnlockCond
  icon: string
}

export type MapBranch =
  | 'core'
  | 'hardware'
  | 'models'
  | 'techniques'
  | 'infra'
  | 'social'
  | 'regions'
  | 'api'
  | 'prestige'
  | 'hidden'

export interface MapNodeDef {
  id: string
  title: string
  desc: string
  branch: MapBranch
  cost: number
  currency: Currency
  /** Parent node ids; at least one must be unlocked. */
  parents: string[]
  effects: Effect[]
  /** Hidden until discovered (easter eggs). */
  hidden?: boolean
  unlock?: UnlockCond
  position: { x: number; y: number }
  icon: string
}

export interface AchievementDef {
  id: string
  name: string
  desc: string
  icon: string
  cond: UnlockCond
  hidden?: boolean
}

export interface HashtagDef {
  id: string
  /** Without '#'. */
  tag: string
  keywords: string[]
  /** Type tag: matches any post of that kind. */
  kind?: ModelKind
  /** Family affinity (e.g. wan): extra +10% when matched with that family. */
  family?: string
}

export type ContractGoal =
  | { type: 'posts'; value: number; tag?: string; kind?: ModelKind }
  | { type: 'likes'; value: number }
  | { type: 'followers'; value: number }
  | { type: 'ownHardware'; id: string; count: number }
  | { type: 'clicks'; value: number }
  | { type: 'quantize'; value: number }
  | { type: 'virals'; value: number }

export interface ContractDef {
  id: string
  title: string
  desc: string
  client: string
  goal: ContractGoal
  /** Credits reward expressed in seconds of income at acceptance time. */
  rewardSecs: number
  rewardRp?: number
  rewardCp?: number
  /** Minimum best speedTier before this contract can roll. */
  minTier: number
  weight: number
}

export type EventKind =
  | 'modelDrop'
  | 'nodeBroke'
  | 'founderRepost'
  | 'spotReclaim'
  | 'powerSurge'
  | 'trendingSpark'
  | 'cloudPromo'

export interface EventDef {
  id: string
  kind: EventKind
  title: string
  desc: string
  durationSec: number
  weight: number
  minTier: number
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
export interface Job {
  id: string
  modelId: string
  precision: Precision
  prompt: string
  tags: string[]
  hardwareId: string
  cost: number
  durationMs: number
  createdAt: number
  startedAt: number | null
  endsAt: number | null
  /** Milliseconds shaved off by clicking. */
  clickBonusMs: number
  hubWorkflowId?: string
}

export interface Post {
  id: string
  createdAt: number
  modelId: string
  kind: ModelKind
  precision: Precision
  prompt: string
  tags: string[]
  matchedTrending: string[]
  thumb: string
  /** Credits the job cost when it was queued; upscales are priced off this, not today's cps. */
  cost: number
  targetLikes: number
  likes: number
  creditsPerLike: number
  creditsPaid: number
  windowMs: number
  viral: boolean
  flop: boolean
  founderBoost: boolean
  followersGained: number
  granted: boolean
  upscaled?: boolean
  hubWorkflowId?: string
  /** Multiplier snapshot for the card breakdown. */
  roll: number
  trendMult: number
}

export interface ActiveContract {
  defId: string
  acceptedAt: number
  progress: number
  target: number
  rewardCredits: number
  done: boolean
  claimed: boolean
}

export interface ActiveEvent {
  defId: string
  kind: EventKind
  startedAt: number
  endsAt: number
  /** e.g. hashtag id for modelDrop, hardware id for spotReclaim. */
  payload?: string
  resolved?: boolean
}

export interface DailyState {
  lastClaimDay: string | null
  streak: number
  /** Day keys already claimed (max 7 kept). */
  claimed: string[]
}

export interface GameSettings {
  sfx: boolean
  particles: boolean
  reducedMotion: boolean
  projector: boolean
}

export interface GameStats {
  posts: number
  videos: number
  flops: number
  virals: number
  quantizations: number
  offlineClaims: number
  rebrands: number
  contractsDone: number
  hubPublished: number
  hubRuns: number
  lorasTrained: number
  bestPostLikes: number
  lastPrompt: string
  lastPostKey: string
  bestCps: number
  clicksWindow: number[]
}

export interface GameState {
  v: number
  meta: {
    createdAt: number
    lastTickAt: number
    lastSavedAt: number
    playedSec: number
    guestId: string
    season: number
  }
  credits: number
  lifetimeCredits: number
  seasonCredits: number
  totalClicks: number
  hardware: Record<string, number>
  /** Tier upgrades bought per hardware id (0..4). */
  hardwareTiers: Record<string, number>
  upgrades: string[]
  models: Record<string, { precisions: Precision[]; setup: boolean }>
  /** Trained LoRAs by hashtag id. */
  loras: string[]
  mapNodes: string[]
  achievements: string[]
  posts: Post[]
  queue: Job[]
  followers: number
  followersFrac: number
  lifetimeFollowers: number
  lifetimeLikes: number
  signups: number
  rp: number
  cp: number
  cpSpent: number
  hubRep: number
  contracts: { active: ActiveContract[]; nextRotateAt: number }
  events: { active: ActiveEvent[]; nextAt: number }
  daily: DailyState
  stats: GameStats
  settings: GameSettings
  flags: Record<string, boolean>
  /** Trending override for demos (week index); null = live. */
  weekOverride: number | null
  /** Server-provided trending tags (ids) with weights; null = deterministic fallback. */
  liveTrending: { tags: string[]; fetchedAt: number } | null
}

// ---------------------------------------------------------------------------
// Derived (recomputed on events, never per tick)
// ---------------------------------------------------------------------------
export interface Derived {
  cps: number
  rawCps: number
  clickValue: number
  bestVram: number
  bestTier: number
  bestHardwareId: string | null
  hasGpu: boolean
  powerDraw: number
  powerBudget: number
  throttled: boolean
  concurrency: number
  speedMult: number
  likesMult: number
  payoutBonus: number
  followRate: number
  viralChance: number
  flopChance: number
  offlineCapHours: number
  /** Share of cps paid for long gaps: OFFLINE_EFFICIENCY unless an `offlineEfficiency` effect raises it. */
  offlineEfficiency: number
  globalMult: number
  cpMult: number
  familyMult: Partial<Record<HardwareFamily, number>>
  rigMult: Record<string, number>
  familyGenTime: Record<string, number>
  coolingTier: Partial<Record<HardwareFamily, number>>
  tagLikes: Record<string, number>
  unlockedFamilies: HardwareFamily[]
  zluda: boolean
  apiNodes: boolean
  hashtagResearch: boolean
  streakGrace: boolean
  reservedCapacity: boolean
  weekSpeed: number
  /** Hardware ids runnable per model+precision are computed on demand in hardware.ts. */
}

// ---------------------------------------------------------------------------
// Events emitted by the engine for the UI/FX layer
// ---------------------------------------------------------------------------
export type GameEvent =
  | { type: 'click'; value: number }
  | { type: 'purchase'; hardwareId: string; count: number }
  | { type: 'upgrade'; id: string }
  | { type: 'mapUnlock'; id: string }
  | { type: 'jobStarted'; jobId: string }
  | { type: 'postCreated'; postId: string }
  | { type: 'postResolved'; postId: string; viral: boolean; flop: boolean }
  | { type: 'achievement'; id: string }
  | { type: 'offline'; gain: number; elapsedSec: number }
  | { type: 'contractDone'; defId: string }
  | { type: 'eventStart'; defId: string; kind: EventKind }
  | { type: 'eventEnd'; defId: string; kind: EventKind }
  | { type: 'daily'; day: number; credits: number }
  | { type: 'rebrand'; cp: number }
  | { type: 'powerThrottle'; on: boolean }
  | { type: 'signup'; total: number }
  | { type: 'weekRollover'; tags: string[] }
  | { type: 'easterEgg'; id: string }
  | { type: 'milestone'; cps: number }

export type Rng = () => number

// ---------------------------------------------------------------------------
// Catalog lives in src/data/index.ts (it is assembled from the data files). Re-exported here so
// UI code can import every game type from one module; type-only, so there is no runtime cycle.
// ---------------------------------------------------------------------------
export type { Catalog } from '@/data'
