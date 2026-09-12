/**
 * Upgrade catalog: named upgrades plus the virtual per-hardware tier upgrades
 * (`tier:<hardwareId>:<1..4>`). Pure data. No React, no DOM.
 *
 * Icon strings are either a file stem from `src/assets/brand/nodes` (e.g. `lora-loader`)
 * or a kebab-case lucide icon name (e.g. `zap`).
 */
import type { HardwareDef, HardwareFamily, StatKey, UnlockCond, UpgradeDef } from '@/game/types'
import { TIER_UPGRADE_COST_MULT, TIER_UPGRADE_EFFECT, TIER_UPGRADE_THRESHOLDS } from '@/game/constants'

// ---------------------------------------------------------------------------
// Unlock helpers
// ---------------------------------------------------------------------------
const stat = (key: StatKey, value: number): UnlockCond => ({ type: 'stat', key, value })
const clicks = (n: number): UnlockCond => stat('clicks', n)
/** Global upgrades appear once you've earned half their price. */
const lifetime = (cost: number): UnlockCond => stat('lifetimeCredits', cost / 2)
const after = (id: string): UnlockCond => ({ type: 'upgrade', id })
const ownFamily = (family: HardwareFamily): UnlockCond => ({ type: 'ownFamily', family })
const ownHardware = (id: string): UnlockCond => ({ type: 'ownHardware', id })

// ---------------------------------------------------------------------------
// Named upgrades
// ---------------------------------------------------------------------------
export const UPGRADES: UpgradeDef[] = [
  // ---- click -------------------------------------------------------------
  {
    id: 'better-prompts',
    name: 'Better Prompts',
    desc: '+1 credit per click.',
    flavor: 'Removed "masterpiece, best quality". Added a comma. Somehow better.',
    cost: 100,
    category: 'click',
    effects: [{ kind: 'clickFlat', value: 1 }],
    unlock: clicks(10),
    icon: 'text-to-image',
  },
  {
    id: 'batch-size-2',
    name: 'Batch Size 2',
    desc: 'Clicks are worth ×2.',
    flavor: 'Two images per queue. Twice the disappointment, half the time.',
    cost: 1_000,
    category: 'click',
    effects: [{ kind: 'clickMult', value: 2 }],
    unlock: clicks(300),
    icon: 'image-batch',
  },
  {
    id: 'batch-size-4',
    name: 'Batch Size 4',
    desc: 'Clicks are worth ×2.',
    flavor: 'The VRAM graph now looks like a cliff.',
    cost: 10_000,
    category: 'click',
    effects: [{ kind: 'clickMult', value: 2 }],
    unlock: clicks(1_500),
    icon: 'image-batch',
  },
  {
    id: 'batch-size-8',
    name: 'Batch Size 8',
    desc: 'Clicks are worth ×2.',
    flavor: 'One of the eight is always the good one. Never the first.',
    cost: 100_000,
    category: 'click',
    effects: [{ kind: 'clickMult', value: 2 }],
    unlock: clicks(5_000),
    icon: 'image-batch',
  },
  {
    id: 'comfy-desktop',
    name: 'Comfy Desktop',
    desc: 'Each click also earns 1% of your credits/s. Offline cap +4 h.',
    flavor: 'It installs Python for you. You will never know which one.',
    cost: 100_000,
    category: 'click',
    effects: [
      { kind: 'clickCpsPct', value: 0.01 },
      { kind: 'offlineCapHours', value: 4 },
    ],
    unlock: clicks(3_000),
    icon: 'app-window',
  },
  {
    id: 'ctrl-enter',
    name: 'Ctrl+Enter',
    desc: 'Each click also earns 2% of your credits/s.',
    flavor: 'The Queue button was always optional. Nobody told you.',
    cost: 1_000_000,
    category: 'click',
    effects: [{ kind: 'clickCpsPct', value: 0.02 }],
    unlock: clicks(10_000),
    icon: 'keyboard',
  },
  {
    id: 'queue-front',
    name: 'Queue Front',
    desc: 'Each click also earns 4% of your credits/s.',
    flavor: 'Ctrl+Shift+Enter. Your prompt now cuts in line. Ethically.',
    cost: 10_000_000,
    category: 'click',
    effects: [{ kind: 'clickCpsPct', value: 0.04 }],
    unlock: clicks(20_000),
    icon: 'list-ordered',
  },

  // ---- global ------------------------------------------------------------
  {
    id: 'comfyui-manager',
    name: 'ComfyUI-Manager',
    desc: 'All production +10%.',
    flavor: 'Install Missing Custom Nodes. Restart. Install Missing Custom Nodes.',
    cost: 2_000,
    category: 'global',
    effects: [{ kind: 'globalMult', value: 0.1 }],
    unlock: lifetime(2_000),
    icon: 'extensions-blocks',
  },
  {
    id: 'custom-node-pack',
    name: 'Custom Node Pack',
    desc: 'All production +10%.',
    flavor: '312 nodes. You use "Image Resize" and one you can no longer find.',
    cost: 20_000,
    category: 'global',
    effects: [{ kind: 'globalMult', value: 0.1 }],
    unlock: lifetime(20_000),
    icon: 'node',
  },
  {
    id: 'lora-stack',
    name: 'LoRA Stack',
    desc: 'All production +15%.',
    flavor: 'Six LoRAs at 0.7 strength. The style is "all of them".',
    cost: 200_000,
    category: 'global',
    effects: [{ kind: 'globalMult', value: 0.15 }],
    unlock: lifetime(200_000),
    icon: 'lora-loader',
  },
  {
    id: 'workflow-templates',
    name: 'Workflow Templates',
    desc: 'All production +15%.',
    flavor: 'Starts from a template. Ends as spaghetti. The circle of life.',
    cost: 2_000_000,
    category: 'global',
    effects: [{ kind: 'globalMult', value: 0.15 }],
    unlock: lifetime(2_000_000),
    icon: 'template',
  },
  {
    id: 'subgraphs',
    name: 'Subgraphs',
    desc: 'All production +20%.',
    flavor: 'The spaghetti is still there. It is simply inside a box now.',
    cost: 20_000_000,
    category: 'global',
    effects: [{ kind: 'globalMult', value: 0.2 }],
    unlock: lifetime(20_000_000),
    icon: 'subgraph-blueprint-canny-to-video-ltx-2-0',
  },
  {
    id: 'app-mode',
    name: 'App Mode',
    desc: 'All production +20%.',
    flavor: 'Clients see three sliders and a button. They ask for a fourth slider.',
    cost: 200_000_000,
    category: 'global',
    effects: [{ kind: 'globalMult', value: 0.2 }],
    unlock: lifetime(200_000_000),
    icon: 'layout-template',
  },
  {
    id: 'comfyhub',
    name: 'ComfyHub',
    desc: 'All production +25%.',
    flavor: 'Publish the workflow. Someone forks it and adds a face detailer. Always.',
    cost: 2_000_000_000,
    category: 'global',
    effects: [{ kind: 'globalMult', value: 0.25 }],
    unlock: lifetime(2_000_000_000),
    icon: 'store',
  },

  // ---- offline -----------------------------------------------------------
  {
    id: 'comfy-cloud-always-on',
    name: 'Comfy Cloud: Always On',
    desc: 'Offline earnings paid at the full rate instead of half, and the cap grows +8 h.',
    flavor: 'The queue runs while you sleep. The invoice also runs while you sleep.',
    cost: 500_000,
    category: 'offline',
    effects: [
      { kind: 'offlineEfficiency', value: 1 },
      { kind: 'offlineCapHours', value: 8 },
    ],
    unlock: stat('playedSec', 1_800),
    icon: 'cloud',
  },

  // ---- studio ------------------------------------------------------------
  {
    id: 'teacache',
    name: 'TeaCache',
    desc: 'Generation time ×0.75.',
    flavor: 'Skips the steps that looked like the previous steps. Bold strategy.',
    cost: 500_000,
    category: 'studio',
    effects: [{ kind: 'speedMult', value: 0.75 }],
    unlock: stat('posts', 25),
    icon: 'fast-forward',
  },
  {
    id: 'sage-attention',
    name: 'Sage Attention',
    desc: 'Generation time ×0.75.',
    flavor: 'Built the wheel from source. It took longer than every render it will ever save.',
    cost: 5_000_000,
    category: 'studio',
    effects: [{ kind: 'speedMult', value: 0.75 }],
    unlock: stat('posts', 100),
    icon: 'zap',
  },
  {
    id: 'multi-gpu-queue',
    name: 'Multi-GPU Queue',
    desc: 'Run one more job at a time.',
    flavor: 'CUDA_VISIBLE_DEVICES=0,1. The second one is for "later".',
    cost: 2_000_000,
    category: 'studio',
    effects: [{ kind: 'concurrency', value: 1 }],
    unlock: ownHardware('rtx-pro-6000'),
    icon: 'layers',
  },
  {
    id: 'cluster-scheduler',
    name: 'Cluster Scheduler',
    desc: 'Run two more jobs at a time.',
    flavor: 'The scheduler is fair. The scheduler is also 400 lines of YAML.',
    cost: 50_000_000,
    category: 'studio',
    effects: [{ kind: 'concurrency', value: 2 }],
    unlock: ownFamily('cloud-node'),
    icon: 'network',
  },
  {
    id: 'negative-prompt',
    name: 'Negative Prompt',
    desc: 'Flop chance −5%.',
    flavor: '"bad hands, extra fingers, watermark, text, blurry, low quality, sadness".',
    cost: 100_000,
    category: 'studio',
    // flopChance effects are subtracted from FLOP_CHANCE_BASE, so positive = fewer flops.
    effects: [{ kind: 'flopChance', value: 0.05 }],
    unlock: stat('flops', 5),
    icon: 'shield-off',
  },
  {
    id: 'fixed-seed',
    name: 'Fixed Seed',
    desc: 'Flop chance −3%.',
    flavor: 'Seed 42. It was good once and you have never let go.',
    cost: 1_000_000,
    category: 'studio',
    effects: [{ kind: 'flopChance', value: 0.03 }],
    unlock: stat('flops', 20),
    icon: 'dices',
  },

  // ---- social ------------------------------------------------------------
  {
    id: 'hashtag-research',
    name: 'Hashtag Research',
    desc: 'Reveals which hashtags are trending this week.',
    flavor: 'Opened a spreadsheet. Closed the spreadsheet. Followed the spreadsheet anyway.',
    cost: 50_000,
    category: 'social',
    effects: [{ kind: 'hashtagResearch' }],
    unlock: stat('posts', 10),
    icon: 'hash',
  },
  {
    id: 'creator-fund',
    name: 'Creator Fund',
    desc: 'Payout per like +10%.',
    flavor: 'Monetization approved. Terms of service: 41 pages, one relevant.',
    cost: 250_000,
    category: 'social',
    effects: [{ kind: 'payoutRatio', value: 0.1 }],
    unlock: stat('likes', 1_000),
    icon: 'coins',
  },
  {
    id: 'referral-link',
    name: 'Referral Link',
    desc: 'Followers gained per like ×1.5.',
    flavor: '"Link in bio." The bio is also a link.',
    cost: 150_000,
    category: 'social',
    effects: [{ kind: 'followRate', value: 1.5 }],
    unlock: stat('followers', 500),
    icon: 'link',
  },
  {
    id: 'cross-posting',
    name: 'Cross-Posting',
    desc: 'Likes ×1.25.',
    flavor: 'Same video, four platforms, four aspect ratios, one crop that cuts off the subject.',
    cost: 3_000_000,
    category: 'social',
    effects: [{ kind: 'likesMult', value: 1.25 }],
    unlock: stat('followers', 5_000),
    icon: 'share-2',
  },
  {
    id: 'verified-checkmark',
    name: 'Verified Checkmark',
    desc: 'Likes ×1.5.',
    flavor: 'Paid for it. Tells everyone it was earned. Everyone knows.',
    cost: 15_000_000,
    category: 'social',
    effects: [{ kind: 'likesMult', value: 1.5 }],
    unlock: stat('followers', 25_000),
    icon: 'badge-check',
  },
  {
    id: 'trending-audio',
    name: 'Trending Audio',
    desc: 'Viral chance +2%.',
    flavor: 'The same 11 seconds of a song, under a video of a raccoon rendered in Wan.',
    cost: 20_000_000,
    category: 'social',
    effects: [{ kind: 'viralChance', value: 0.02 }],
    unlock: stat('virals', 3),
    icon: 'music-2',
  },

  // ---- power -------------------------------------------------------------
  {
    id: 'psu-850',
    name: '850 W PSU',
    desc: 'Power budget +300 W.',
    flavor: 'Gold rated. The cables are still the wrong length.',
    cost: 200,
    category: 'power',
    effects: [{ kind: 'powerBudget', value: 300 }],
    unlock: { type: 'always' },
    icon: 'plug',
  },
  {
    id: 'psu-1600',
    name: '1600 W PSU',
    desc: 'Power budget +900 W.',
    flavor: 'Trips the breaker if the kettle is on. You now schedule tea.',
    cost: 1_500,
    category: 'power',
    effects: [{ kind: 'powerBudget', value: 900 }],
    unlock: after('psu-850'),
    icon: 'plug-zap',
  },
  {
    id: 'three-phase',
    name: 'Three-Phase Power',
    desc: 'Power budget +8 kW.',
    flavor: 'The electrician asked what it was for. You said "art".',
    cost: 12_000,
    category: 'power',
    effects: [{ kind: 'powerBudget', value: 8_000 }],
    unlock: after('psu-1600'),
    icon: 'cable',
  },
  {
    id: 'substation',
    name: 'Substation',
    desc: 'Power budget +100 kW.',
    flavor: 'The utility company now has your number saved.',
    cost: 150_000,
    category: 'power',
    effects: [{ kind: 'powerBudget', value: 100_000 }],
    unlock: after('three-phase'),
    icon: 'factory',
  },
  {
    id: 'solar-farm',
    name: 'Solar Farm',
    desc: 'Power budget +2 MW.',
    flavor: 'Renders are now weather-dependent. Cloudy days: --lowvram.',
    cost: 2_000_000,
    category: 'power',
    effects: [{ kind: 'powerBudget', value: 2_000_000 }],
    unlock: after('substation'),
    icon: 'sun',
  },
  {
    id: 'fusion-reactor',
    name: 'Fusion Reactor',
    desc: 'Power budget +200 MW.',
    flavor: 'Ten years away, as always. You bought it anyway.',
    cost: 30_000_000,
    category: 'power',
    effects: [{ kind: 'powerBudget', value: 200_000_000 }],
    unlock: after('solar-farm'),
    icon: 'atom',
  },
  {
    id: 'aio-cooler',
    name: 'AIO Cooler',
    desc: 'NVIDIA consumer cards run one speed tier faster.',
    flavor: 'The pump makes a noise. The noise is "fine".',
    cost: 800,
    category: 'power',
    effects: [{ kind: 'coolingTier', family: 'nvidia-consumer', value: 1 }],
    unlock: ownFamily('nvidia-consumer'),
    icon: 'fan',
  },
  {
    id: 'liquid-amd',
    name: 'Liquid-Cooled Radeon',
    desc: 'AMD cards run one speed tier faster.',
    flavor: 'Cooler now. Still compiling.',
    cost: 6_000,
    category: 'power',
    effects: [{ kind: 'coolingTier', family: 'amd-consumer', value: 1 }],
    unlock: ownFamily('amd-consumer'),
    icon: 'thermometer',
  },
  {
    id: 'custom-loop',
    name: 'Custom Loop',
    desc: 'Workstation cards run one speed tier faster.',
    flavor: 'Distilled water, a fitting you tightened twice, a towel just in case.',
    cost: 15_000,
    category: 'power',
    effects: [{ kind: 'coolingTier', family: 'workstation', value: 1 }],
    unlock: ownFamily('workstation'),
    icon: 'droplets',
  },
  {
    id: 'immersion-cooling',
    name: 'Immersion Cooling',
    desc: 'Datacenter cards run one speed tier faster.',
    flavor: 'The GPUs live in a fish tank now. The fish were relocated.',
    cost: 250_000,
    category: 'power',
    effects: [{ kind: 'coolingTier', family: 'datacenter', value: 1 }],
    unlock: ownFamily('datacenter'),
    icon: 'waves',
  },

  // ---- rocm --------------------------------------------------------------
  {
    id: 'rocm-setup',
    name: 'ROCm Setup',
    desc: 'Unlocks AMD Radeon cards in the store.',
    flavor: 'Compiles for forty minutes. Works on the third try.',
    cost: 250,
    category: 'rocm',
    effects: [{ kind: 'unlockFamily', family: 'amd-consumer' }],
    unlock: ownHardware('pc-8c16t'),
    icon: 'wrench',
  },
]

// ---------------------------------------------------------------------------
// Virtual tier upgrades
// ---------------------------------------------------------------------------
const TIER_COUNT = TIER_UPGRADE_THRESHOLDS.length

/** Names in progression order; pools longer than TIER_COUNT rotate per hardware id. */
const TIER_NAME_POOL: Record<HardwareFamily, string[]> = {
  cpu: ['Thermal Paste', 'XMP Profile', '--lowvram', 'Overclock'],
  apple: ['Metal Flash', 'Unified Memory Tuning', 'Core ML', 'M5 Rumor'],
  'nvidia-consumer': [
    'Repaste',
    'Undervolt',
    'xformers',
    'Resizable BAR',
    'Power Limit 80%',
    'Custom Loop',
    'Sage Attention',
    'Shunt Mod',
  ],
  'amd-consumer': ['ROCm 7 Driver', 'Undervolt', 'ZLUDA Tune', 'Liquid Metal'],
  workstation: ['ECC Off', 'NVLink Bridge', 'MIG Slices', 'Driver 999.99'],
  datacenter: ['InfiniBand', 'NCCL Tuning', 'Tensor Parallel', 'Spot Instances'],
  'cloud-node': ['Autoscaler', 'Reserved Capacity', 'Multi-Region', 'K8s Operator'],
  region: ['Edge Cache', 'Warm Pool', 'Subgraph Cache', 'Second AZ'],
}

const TIER_FLAVOR: Record<string, string> = {
  'Thermal Paste': 'The stock pad was more of a suggestion.',
  'XMP Profile': 'One BIOS toggle. Forty percent more confidence.',
  '--lowvram': 'Slower, but it finishes. Finishing counts.',
  Overclock: 'Stable enough. Define stable.',
  'Metal Flash': 'Flash attention, but it asks for permission first.',
  'Unified Memory Tuning': "It's all one pool. The pool is the problem.",
  'Core ML': 'Converted the model. Lost a Tuesday.',
  'M5 Rumor': 'The next chip fixes everything. It always does.',
  Repaste: 'Factory paste from a factory that has since closed.',
  Undervolt: 'Same speed, fewer watts, one more row in the spreadsheet.',
  xformers: 'Installed. Uninstalled. Installed the right wheel.',
  'Resizable BAR': 'The BIOS option nobody enabled until now.',
  'Power Limit 80%': 'Loses 3% performance, gains a quiet room.',
  'Custom Loop': 'Soft tubing, hard lessons.',
  'Sage Attention': 'Attention, but faster. Somehow legal.',
  'Shunt Mod': 'Warranty: a social construct.',
  'ROCm 7 Driver': 'Release notes say "stability improvements". Again.',
  'ZLUDA Tune': 'CUDA, allegedly.',
  'Liquid Metal': "Conductive. Please don't spill it.",
  'ECC Off': 'Wrong bits, faster.',
  'NVLink Bridge': 'Two cards, one very expensive stick.',
  'MIG Slices': 'Seven small GPUs in a trench coat.',
  'Driver 999.99': 'Studio driver. Game Ready. Whatever the dropdown said.',
  InfiniBand: 'The cable costs more than your first GPU did.',
  'NCCL Tuning': 'Set eleven environment variables. One of them mattered.',
  'Tensor Parallel': "The model is now everyone's problem.",
  'Spot Instances': "Cheap right up until it isn't.",
  Autoscaler: 'Scales up instantly. Scales down eventually.',
  'Reserved Capacity': 'Three-year commitment. Bold.',
  'Multi-Region': 'Now the outage can follow the sun.',
  'K8s Operator': 'Nine YAML files and a prayer.',
  'Edge Cache': 'The first render was the hard one.',
  'Warm Pool': 'Pre-booted, pre-loaded, pre-billed.',
  'Subgraph Cache': 'Blueprints, but the results are memoized too.',
  'Second AZ': 'Redundancy is buying it twice, with intent.',
}

const TIER_ICON: Record<HardwareFamily, string> = {
  cpu: 'cpu',
  apple: 'apple',
  'nvidia-consumer': 'gpu',
  'amd-consumer': 'flame',
  workstation: 'server',
  datacenter: 'network',
  'cloud-node': 'cloud',
  region: 'globe',
}

/** djb2 over the hardware id, deterministic, no dependency on rng.ts. */
function hashId(id: string): number {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0
  return h
}

/**
 * Picks TIER_COUNT consecutive names from the family pool. Pools longer than
 * TIER_COUNT slide their window by hardware id so sibling cards don't all read
 * identically, while progression order within the pool is preserved.
 */
function tierNames(hw: HardwareDef): string[] {
  const pool = TIER_NAME_POOL[hw.family]
  const windows = pool.length - TIER_COUNT + 1
  const start = windows > 1 ? hashId(hw.id) % windows : 0
  return pool.slice(start, start + TIER_COUNT)
}

export function generateTierUpgrades(hardware: HardwareDef[]): UpgradeDef[] {
  const out: UpgradeDef[] = []
  for (const hw of hardware) {
    const names = tierNames(hw)
    for (let i = 0; i < TIER_COUNT; i++) {
      const threshold = TIER_UPGRADE_THRESHOLDS[i]
      const name = names[i] ?? `Tier ${i + 1}`
      out.push({
        id: `tier:${hw.id}:${i + 1}`,
        name,
        desc: `Every ${hw.name} produces ×${TIER_UPGRADE_EFFECT}. Requires ${threshold} owned.`,
        flavor: TIER_FLAVOR[name],
        cost: Math.ceil(hw.baseCost * TIER_UPGRADE_COST_MULT[i]),
        category: 'hardware',
        effects: [{ kind: 'rigMult', hardwareId: hw.id, value: TIER_UPGRADE_EFFECT }],
        unlock: { type: 'ownHardware', id: hw.id, count: threshold },
        icon: TIER_ICON[hw.family],
      })
    }
  }
  return out
}

/** Named upgrades followed by the generated tier upgrades for the given hardware list. */
export function ALL_UPGRADES(hardware: HardwareDef[]): UpgradeDef[] {
  return [...UPGRADES, ...generateTierUpgrades(hardware)]
}
