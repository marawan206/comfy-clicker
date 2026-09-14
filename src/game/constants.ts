export const STEP_S = 0.05
export const AUTOSAVE_MS = 10_000
export const SAVE_KEY = 'comfy-clicker:save'
export const SAVE_VERSION = 1
/** In-game "week" length for trending hashtags. */
export const WEEK_MS = 10 * 60_000
export const TRENDING_COUNT = 3
export const TRENDING_WEIGHTS = [1.0, 0.4] as const
export const MAX_MATCHED_TRENDING = 2
export const EXTRA_KEYWORD_BONUS = 0.1
export const MAX_EXTRA_KEYWORDS = 3
export const REPOST_PENALTY = 0.5
export const POST_WINDOW_MS = 8_000
export const MAX_POSTS = 60
export const MAX_QUEUE = 8
export const GEN_TIME_MIN_S = 3
export const GEN_TIME_MAX_S = 15
export const TIER_DELTA_FACTOR = 1.3
export const ABOVE_TIER_FACTOR = 0.85
export const CLICK_JOB_BONUS_MS = 150
export const CLICK_JOB_BONUS_CAP = 0.5
/** API-node models bill someone else's GPU on top of yours: job cost ×1.5, payout on the pre-surcharge cost. */
export const API_COST_MULT = 1.5
/** Idle income: 8 h at half rate out of the box; upgrades and map nodes raise the cap to 48 h and the rate to 100%. */
export const OFFLINE_CAP_HOURS_BASE = 8
export const OFFLINE_EFFICIENCY = 0.5
export const SHORT_GAP_S = 300
export const POWER_BUDGET_BASE = 650
/**
 * Installing a model your best card can't hold costs this many × baseCost (the --lowvram tax).
 * Kept at 1 so "set up + quantize" always undercuts buying the native rig outright.
 */
export const SETUP_FEE_MULT = 1
export const SIGNUP_THRESHOLDS = [0, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000]
export const SIGNUP_GROWTH = 2
export const FOLLOW_RATE_BASE = 0.05
export const VIRAL_FOLLOW_MULT = 3
export const VIRAL_CHANCE_BASE = 0.05
export const FLOP_CHANCE_BASE = 0.15
export const FOUNDER_BOOST_CHANCE = 0.02
export const AUDIENCE_REF_DIVISOR = 50
export const CONTRACT_SLOTS = 3
export const CONTRACT_ROTATE_MS = 30 * 60_000
export const EVENT_MIN_GAP_MS = 3 * 60_000
export const EVENT_MAX_GAP_MS = 8 * 60_000
export const DAILY_BASE_SECS = 600
export const DAILY_MIN_CREDITS = 50
export const REBRAND_CP_DIVISOR = 1e8
export const REBRAND_CP_EXP = 0.45
export const CP_MULT_PER_POINT = 0.02
export const RP_MULT_PER_POINT = 0.01
export const ACHIEVEMENT_MULT = 0.01
/** Tier 1 waits for 5 owned so its 10× price pays back in ~2 unit paybacks, not ~10. */
export const TIER_UPGRADE_THRESHOLDS = [5, 10, 25, 50] as const
export const TIER_UPGRADE_COST_MULT = [10, 100, 1_000, 10_000] as const
export const TIER_UPGRADE_EFFECT = 2

/** Likes multiplier for a job run from a published ComfyHub workflow (the runner's reward). */
export const HUB_RUN_LIKES_BOOST = 1.15

// ---------------------------------------------------------------------------
// Player level (src/game/level.ts)
// ---------------------------------------------------------------------------
/**
 * XP needed for each level, indexed by `level - 1`. Strictly increasing, `LEVEL_XP[0] === 0`.
 * Levels 1 to 12 are hand-placed against the balance simulator (see the arrival table in
 * `docs/HOW-IT-WORKS.md`); 13 to 30 are a flat LEVEL_XP_TAIL_STEP per level.
 */
export const MAX_LEVEL = 30
const LEVEL_XP_HAND = [0, 500, 900, 1_550, 2_050, 2_450, 2_800, 3_150, 3_500, 3_850, 4_200, 4_550] as const
export const LEVEL_XP_TAIL_STEP = 400
export const LEVEL_XP: readonly number[] = [
  ...LEVEL_XP_HAND,
  ...Array.from(
    { length: MAX_LEVEL - LEVEL_XP_HAND.length },
    (_, i) => (LEVEL_XP_HAND[LEVEL_XP_HAND.length - 1] as number) + LEVEL_XP_TAIL_STEP * (i + 1),
  ),
]

/** XP weights. Credits are the backbone; posts are log-compressed so nothing can be farmed. */
export const XP_CREDITS = 150
export const XP_POSTS = 25
export const XP_ACHIEVEMENT = 20
export const XP_CONTRACT = 10
export const XP_MAP_NODE = 6
export const XP_QUANTIZE = 15
export const XP_LORA = 15
export const XP_REBRAND = 50

/** Level-up payout: `max(LEVEL_REWARD_PER_LEVEL × level, round(LEVEL_REWARD_SECS × cps))`. */
export const LEVEL_REWARD_PER_LEVEL = 100
export const LEVEL_REWARD_SECS = 90

/**
 * Level titles, indexed by `level - 1`. They live here rather than in `src/data/flavor.ts` because
 * `level.ts` may import only types and constants (`state.ts` imports it, so anything richer cycles).
 */
export const LEVEL_TITLES: readonly string[] = [
  'Fresh Install',
  'Queue Prompt',
  'Node Wrangler',
  'Guidance Scale',
  'Latent Explorer',
  'Sampler Sommelier',
  'VRAM Negotiator',
  'Custom Node Author',
  'Cluster Operator',
  'Region Owner',
  'Subgraph Architect',
  'Checkpoint Merger',
  'KSampler Whisperer',
  'Seed Oracle',
  'Cloud Native',
  'ControlNet Conductor',
  'LoRA Librarian',
  'Upscale Overlord',
  'Tensor Tamer',
  'Denoise Diplomat',
  'CFG Cardinal',
  'Attention Head',
  'Subgraph Sovereign',
  'Latent Lord',
  'Scheduler Sage',
  'Inference Infinite',
  'Weights Whisperer',
  'Diffusion Deity',
  'The Frontend Rewrite',
  'Honorary Maintainer',
]

// ---------------------------------------------------------------------------
// The Latent Lounge (src/game/gamble.ts)
// ---------------------------------------------------------------------------
/** Level at which the Lounge tile appears. */
export const LOUNGE_MIN_LEVEL = 2
/**
 * Smallest bet the table takes, in credits. There is no ceiling and no cooldown: the only limit
 * on a wager is the bank, which is what makes the house edge below the thing that has to be right.
 */
export const BET_MIN = 10
/** The house stake on the daily free spin. */
export const FREE_SPIN_SECS = 120
export const FREE_SPIN_MIN = 200
/** Consecutive NaN results after which the next one is rerolled once. */
export const SPIN_PITY_DRY = 3
/** Consecutive x2-or-better results that flip the sampler to "fixed". */
export const SPIN_HOT_STREAK = 3
export const SPIN_HOT_MULT = 1.5
/** Share of every paid wager that joins the x42 pot. Minted, not raked: the table pays for it. */
export const SPIN_POT_FRACTION = 0.02
/**
 * Coin flip. Your side pays double and lands a little under half the time; the gap is the house
 * edge, and the modal prints both numbers next to the button.
 */
export const COIN_WIN_CHANCE = 0.48
export const COIN_PAYOUT = 2

// ---------------------------------------------------------------------------
// Click guard (src/game/clickGuard.ts)
// ---------------------------------------------------------------------------
/**
 * Accepted clicks per trailing second, and the only cap there is. A refused click pays nothing and
 * is not a strike: there is no cadence detector and no lockout, so a fast hand is allowed and
 * simply stops paying past this.
 */
export const CLICK_CAP_PER_SEC = 20

// ---------------------------------------------------------------------------
// Ratioed posts (src/game/virality.ts)
// ---------------------------------------------------------------------------
/** A ratioed post collects this many times the likes it would have earned, as dislikes. */
export const RATIO_DISLIKE_MULT = 3
/** And costs another `RATIO_LOSS_MULT × paid × roll` on top of the sunk job cost. */
export const RATIO_LOSS_MULT = 1
export const RATIOED_FLAG = 'ratioed'

/** Lucky seed: one click in two hundred pays ten times. */
export const LUCKY_CLICK_CHANCE = 0.005
export const LUCKY_CLICK_MULT = 10

/** Debounce on the save written after a state-changing action. */
export const SAVE_DEBOUNCE_MS = 1_500

/** Cooldown on a save the player asks for by hand (the S key, the Save now button). */
export const MANUAL_SAVE_COOLDOWN_MS = 8_000

// ---------------------------------------------------------------------------
// Citizens (src/game/citizens.ts)
// ---------------------------------------------------------------------------
/** Gap between two citizen runs of the same workflow, before heat scales it. */
export const CITIZEN_MIN_GAP_MS = 12_000
export const CITIZEN_MAX_GAP_MS = 45_000
/** One run's royalty: seconds of income × heat, never below CITIZEN_ROYALTY_MIN credits. */
export const CITIZEN_ROYALTY_SECS = 3
export const CITIZEN_ROYALTY_MIN = 5
/** Heat left after a run, and the level at which the workflow stops trending for good. */
export const CITIZEN_HEAT_DECAY = 0.94
export const CITIZEN_COLD_HEAT = 0.15
/** A workflow goes cold on its own after this long, however few runs it collected. */
export const CITIZEN_TREND_MS = 45 * 60_000
/** Workflows tracked at once (oldest cold one drops first) and runs kept for the activity list. */
export const CITIZEN_MAX_DROPS = 6
export const CITIZEN_FEED_MAX = 14
