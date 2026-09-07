/**
 * Initial game state and stat lookups.
 */
import { EVENT_MIN_GAP_MS, SAVE_VERSION } from '@/game/constants'
import type { Derived, GameState, HardwareFamily, StatKey } from '@/game/types'

/** The rig everyone starts on: a 4-core desktop, `--cpu`, patience. */
export const STARTER_HARDWARE_ID = 'pc-4c8t'
/** Preinstalled model. It is 2022 in here forever. */
export const STARTER_MODEL_ID = 'sd15'

/**
 * A brand-new save: one CPU box, SD 1.5 at native precision, nothing else.
 * Contracts rotate immediately; the first random event waits one minimum gap.
 */
export function createInitialState(now: number, guestId: string): GameState {
  return {
    v: SAVE_VERSION,
    meta: {
      createdAt: now,
      lastTickAt: now,
      lastSavedAt: now,
      playedSec: 0,
      guestId,
      season: 1,
    },
    credits: 0,
    lifetimeCredits: 0,
    seasonCredits: 0,
    totalClicks: 0,
    hardware: { [STARTER_HARDWARE_ID]: 1 },
    hardwareTiers: {},
    upgrades: [],
    models: { [STARTER_MODEL_ID]: { precisions: ['native'], setup: true } },
    loras: [],
    mapNodes: [],
    achievements: [],
    posts: [],
    queue: [],
    followers: 0,
    followersFrac: 0,
    lifetimeFollowers: 0,
    lifetimeLikes: 0,
    signups: 0,
    rp: 0,
    cp: 0,
    cpSpent: 0,
    hubRep: 0,
    contracts: { active: [], nextRotateAt: now },
    events: { active: [], nextAt: now + EVENT_MIN_GAP_MS },
    daily: { lastClaimDay: null, streak: 0, claimed: [] },
    stats: {
      posts: 0,
      videos: 0,
      flops: 0,
      virals: 0,
      quantizations: 0,
      offlineClaims: 0,
      rebrands: 0,
      contractsDone: 0,
      hubPublished: 0,
      hubRuns: 0,
      lorasTrained: 0,
      bestPostLikes: 0,
      lastPrompt: '',
      lastPostKey: '',
      bestCps: 0,
      clicksWindow: [],
    },
    settings: {
      sfx: true,
      particles: true,
      reducedMotion: false,
      projector: false,
    },
    flags: {},
    weekOverride: null,
    liveTrending: null,
  }
}

/**
 * Human labels for hardware families in lock reasons and unlock hints ("Own any cloud node unit",
 * "install ROCm to buy AMD cards"). Singular, and each one is the stem of the store tab label in
 * `HARDWARE_FAMILIES` (src/data/hardware.ts) so the two never disagree.
 */
export const FAMILY_LABELS: Record<HardwareFamily, string> = {
  cpu: 'CPU',
  apple: 'Apple',
  'nvidia-consumer': 'NVIDIA',
  'amd-consumer': 'AMD',
  workstation: 'workstation',
  datacenter: 'datacenter',
  'cloud-node': 'cloud node',
  region: 'region',
}

/** Human labels for stat keys (achievement/unlock hints). */
export const STAT_LABELS: Record<StatKey, string> = {
  lifetimeCredits: 'lifetime credits',
  seasonCredits: 'credits this season',
  clicks: 'clicks',
  posts: 'posts',
  videos: 'videos',
  likes: 'likes',
  followers: 'followers',
  signups: 'signups',
  flops: 'flops',
  virals: 'viral posts',
  quantizations: 'quantizations',
  playedSec: 'seconds played',
  offlineClaims: 'offline claims',
  rebrands: 'rebrands',
  contractsDone: 'contracts done',
  hubPublished: 'workflows published',
  hubRuns: 'workflow runs',
  lorasTrained: 'LoRAs trained',
  mapNodes: 'map nodes',
  achievements: 'achievements',
  streak: 'day streak',
}

/**
 * Read a stat by key. `derived` is accepted for signature stability (no current key needs it);
 * `cps`-style thresholds use the `cps` unlock condition instead.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- contract signature; reserved for derived-backed stats
export function statValue(state: GameState, key: StatKey, _derived?: Derived): number {
  switch (key) {
    case 'lifetimeCredits':
      return state.lifetimeCredits
    case 'seasonCredits':
      return state.seasonCredits
    case 'clicks':
      return state.totalClicks
    case 'posts':
      return state.stats.posts
    case 'videos':
      return state.stats.videos
    case 'likes':
      return state.lifetimeLikes
    case 'followers':
      return state.followers
    case 'signups':
      return state.signups
    case 'flops':
      return state.stats.flops
    case 'virals':
      return state.stats.virals
    case 'quantizations':
      return state.stats.quantizations
    case 'playedSec':
      return state.meta.playedSec
    case 'offlineClaims':
      return state.stats.offlineClaims
    case 'rebrands':
      return state.stats.rebrands
    case 'contractsDone':
      return state.stats.contractsDone
    case 'hubPublished':
      return state.stats.hubPublished
    case 'hubRuns':
      return state.stats.hubRuns
    case 'lorasTrained':
      return state.stats.lorasTrained
    case 'mapNodes':
      return state.mapNodes.length
    case 'achievements':
      return state.achievements.length
    case 'streak':
      return state.daily.streak
    default: {
      // Exhaustiveness guard: a new StatKey without a branch fails to compile.
      const never: never = key
      return never
    }
  }
}
