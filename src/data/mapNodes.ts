/**
 * The Node Map: a ComfyUI-flavoured skill tree laid out as a left-to-right graph.
 *
 * Layout: every node sits on a 260×140 grid (`x = column × 260`, `y = row × 140`).
 * Each branch is a horizontal lane (one or more rows); the core lane runs through the
 * middle and every other lane forks off one of its nodes. Edges therefore always point
 * rightwards, the way a tidy workflow should.
 *
 * Effect value conventions (see derived.ts):
 *   globalMult   additive fraction, Π(1 + v)      familyMult / rigMult   multiplier (×v)
 *   clickMult, likesMult, speedMult, followRate, weekSpeed, cpMult   multiplier (Πv)
 *   payoutRatio, viralChance, flopChance, concurrency, powerBudget, offlineCapHours, coolingTier   additive (Σv)
 *   familyGenTime   multiplier on generation time for that model family (0.7 = 30% faster)
 */
import type { Currency, Effect, HardwareFamily, MapBranch, MapNodeDef, UnlockCond } from '@/game/types'

export const MAP_GRID_X = 260
export const MAP_GRID_Y = 140

/** Lane rows, top to bottom. Hardware and techniques each take several rows. */
export const MAP_ROWS = {
  prestige: 0,
  regions: 1,
  infraOps: 2,
  infraPower: 3,
  hw3: 4,
  hw2: 5,
  hw1: 6,
  core: 7,
  models: 8,
  tech: 9,
  tech2: 10,
  api: 11,
  social: 12,
  hidden: 13,
} as const

const at = (col: number, row: number) => ({ x: col * MAP_GRID_X, y: row * MAP_GRID_Y })

interface NodeSpec {
  id: string
  title: string
  desc: string
  icon: string
  cost: number
  parents: string[]
  effects: Effect[]
  col: number
  currency?: Currency
  unlock?: UnlockCond
  hidden?: boolean
}

/** Builds one lane's nodes: same branch, same row, explicit columns. */
function lane(branch: MapBranch, row: number, currency: Currency, specs: NodeSpec[]): MapNodeDef[] {
  return specs.map(({ col, currency: cur, ...s }) => ({
    id: s.id,
    title: s.title,
    desc: s.desc,
    branch,
    cost: s.cost,
    currency: cur ?? currency,
    parents: s.parents,
    effects: s.effects,
    ...(s.hidden ? { hidden: true } : {}),
    ...(s.unlock ? { unlock: s.unlock } : {}),
    position: at(col, row),
    icon: s.icon,
  }))
}

// ---------------------------------------------------------------------------
// Core lane: the trunk everything forks from. Costs 0 → 1e10, ×~4.6 per step.
// ---------------------------------------------------------------------------
const CORE = lane('core', MAP_ROWS.core, 'credits', [
  {
    id: 'core-root', col: 0, cost: 0, parents: [],
    title: 'Load Checkpoint', icon: 'workflow',
    desc: 'Where every workflow starts. Free, like the software.',
    effects: [],
  },
  {
    id: 'core-manager', col: 1, cost: 500, parents: ['core-root'],
    title: 'Manager: Nightly Channel', icon: 'package',
    desc: '+5% income. Installs missing nodes so you can find out which one broke.',
    effects: [{ kind: 'globalMult', value: 0.05 }],
  },
  {
    id: 'core-readme', col: 2, cost: 2_500, parents: ['core-manager'],
    title: 'Read the README', icon: 'book-open',
    desc: 'Clicks ×1.25. Nobody does this, so it counts as a superpower.',
    effects: [{ kind: 'clickMult', value: 1.25 }],
  },
  {
    id: 'core-paste', col: 3, cost: 12_000, parents: ['core-readme'],
    title: 'Ctrl+Shift+V', icon: 'clipboard-paste',
    desc: '+5% income, clicks ×1.25. Paste with links intact. Life-changing.',
    effects: [{ kind: 'globalMult', value: 0.05 }, { kind: 'clickMult', value: 1.25 }],
  },
  {
    id: 'core-auto-queue', col: 4, cost: 60_000, parents: ['core-paste'],
    title: 'Auto Queue', icon: 'repeat',
    desc: '+1 concurrent job. Queue Prompt, but the button presses itself.',
    effects: [{ kind: 'concurrency', value: 1 }],
  },
  {
    id: 'core-batch', col: 5, cost: 300_000, parents: ['core-auto-queue'],
    title: 'Batch Count', icon: 'layers',
    desc: '+10% income. Four latents in, four latents out, one OOM.',
    effects: [{ kind: 'globalMult', value: 0.1 }],
  },
  {
    id: 'core-desktop', col: 6, cost: 1.5e6, parents: ['core-batch'],
    title: 'Desktop Auto-Update', icon: 'monitor',
    desc: '+10% income, +2 h offline cap. It updates itself now. Mostly.',
    effects: [{ kind: 'globalMult', value: 0.1 }, { kind: 'offlineCapHours', value: 2 }],
  },
  {
    id: 'core-templates', col: 7, cost: 7e6, parents: ['core-desktop'],
    title: 'Template Library', icon: 'layout-template',
    desc: 'Each click also pays 1% of your income per second.',
    effects: [{ kind: 'clickCpsPct', value: 0.01 }],
  },
  {
    id: 'core-subgraphs', col: 8, cost: 3.5e7, parents: ['core-templates'],
    title: 'Nested Subgraphs', icon: 'group',
    desc: '+15% income. Fold 40 nodes into one box. Pretend the spaghetti is gone.',
    effects: [{ kind: 'globalMult', value: 0.15 }],
  },
  {
    id: 'core-cloud', col: 9, cost: 1.5e8, parents: ['core-subgraphs'],
    title: 'Comfy Cloud', icon: 'cloud',
    desc: '+10% income, +4 h offline cap. Someone else’s GPU, your workflow.',
    effects: [{ kind: 'globalMult', value: 0.1 }, { kind: 'offlineCapHours', value: 4 }],
  },
  {
    id: 'core-app-mode', col: 10, cost: 7e8, parents: ['core-cloud'],
    title: 'App Mode: Published', icon: 'app-window',
    desc: '+20% income. Hide the graph, ship the app, keep the credit.',
    effects: [{ kind: 'globalMult', value: 0.2 }],
  },
  {
    id: 'core-linear', col: 11, cost: 3e9, parents: ['core-app-mode'],
    title: 'Linear Mode', icon: 'list-ordered',
    desc: '+1 concurrent job, clicks pay another 1% of income/s. Left to right, no noodles.',
    effects: [{ kind: 'concurrency', value: 1 }, { kind: 'clickCpsPct', value: 0.01 }],
  },
  {
    id: 'core-v1', col: 12, cost: 1e10, parents: ['core-linear'],
    title: 'ComfyUI 1.0', icon: 'party-popper',
    desc: '+30% income. It finally happened. The changelog is 900 lines.',
    effects: [{ kind: 'globalMult', value: 0.3 }],
  },
])

// ---------------------------------------------------------------------------
// Hardware lane: per-family output multipliers ×1.1 / ×1.25 / ×1.5, three rows.
// Main chain runs cpu → nvidia → workstation → datacenter → cloud → region;
// apple hangs off cpu and amd off nvidia (amd additionally needs a ROCm card owned).
// ---------------------------------------------------------------------------
interface HwLane {
  key: string
  family: HardwareFamily
  label: string
  col: number
  parent1: string
  baseCost: number
  icons: [string, string, string]
  titles: [string, string, string]
  flavor: [string, string, string]
}

const HW_LANES: HwLane[] = [
  {
    key: 'cpu', family: 'cpu', label: 'CPU', col: 2, parent1: 'core-manager', baseCost: 800,
    icons: ['cpu', 'binary', 'flame'],
    titles: ['Thread Pinning', 'AVX-512 Kernels', '--cpu, But Angry'],
    flavor: ['Every core, every time.', 'Vector units finally earn their keep.', 'It is not fast. It is inevitable.'],
  },
  {
    key: 'nvidia', family: 'nvidia-consumer', label: 'NVIDIA consumer', col: 3, parent1: 'hardware-cpu-1', baseCost: 20_000,
    icons: ['zap', 'git-branch', 'gauge'],
    titles: ['Driver Update (Nothing Broke)', 'CUDA Graphs', 'Power Limit Shuffle'],
    flavor: ['A miracle, frankly.', 'Launch overhead is for other people.', '450 W is a suggestion.'],
  },
  {
    key: 'workstation', family: 'workstation', label: 'workstation', col: 4, parent1: 'hardware-nvidia-1', baseCost: 200_000,
    icons: ['shield-check', 'cable', 'microchip'],
    titles: ['ECC On', 'NVLink Bridge', 'Blackwell Pro Tuning'],
    flavor: ['Bit flips are a choice.', 'Two cards, one address space.', 'The datasheet said so.'],
  },
  {
    key: 'datacenter', family: 'datacenter', label: 'datacenter', col: 5, parent1: 'hardware-workstation-1', baseCost: 2e6,
    icons: ['server', 'network', 'calendar-clock'],
    titles: ['SXM Everything', 'InfiniBand', 'Slurm Priority Queue'],
    flavor: ['PCIe is for peasants.', 'The fabric hums at 400 Gb/s.', 'Your jobs, finally in order.'],
  },
  {
    key: 'cloud', family: 'cloud-node', label: 'cloud node', col: 6, parent1: 'hardware-datacenter-1', baseCost: 2e7,
    icons: ['cloud-lightning', 'cloud-cog', 'shuffle'],
    titles: ['Spot Instances', 'Reserved Pods', 'Multi-Cloud Arbitrage'],
    flavor: ['Cheap until reclaimed.', 'Yours for a year, whether you like it or not.', 'Follow the cheapest H100 around the globe.'],
  },
  {
    key: 'region', family: 'region', label: 'region', col: 7, parent1: 'hardware-cloud-1', baseCost: 1e8,
    icons: ['globe', 'handshake', 'landmark'],
    titles: ['Edge Caching', 'Peering Agreements', 'Sovereign Cloud'],
    flavor: ['Latents, closer to the user.', 'Bandwidth, negotiated.', 'A flag on every rack.'],
  },
  {
    key: 'apple', family: 'apple', label: 'Apple silicon', col: 8, parent1: 'hardware-cpu-1', baseCost: 5_000,
    icons: ['laptop', 'memory-stick', 'sparkle'],
    titles: ['MPS Fallback', 'Unified Memory Diet', 'Metal Kernels'],
    flavor: ['PYTORCH_ENABLE_MPS_FALLBACK=1 and a prayer.', '192 GB shared with Safari.', 'Written by three people. Heroes.'],
  },
  {
    key: 'amd', family: 'amd-consumer', label: 'AMD', col: 9, parent1: 'hardware-nvidia-1', baseCost: 30_000,
    icons: ['wrench', 'database', 'dices'],
    titles: ['HIP Toolchain', 'MIOpen Cache', 'ROCm Nightly Roulette'],
    flavor: ['hipify and hope.', 'Warm kernels, fewer tears.', 'Sometimes it is 2× faster. Sometimes.'],
  },
]

const HW_MULTS = [1.1, 1.25, 1.5] as const
const HW_PCTS = ['+10%', '+25%', '+50%'] as const
const HW_ROWS = [MAP_ROWS.hw1, MAP_ROWS.hw2, MAP_ROWS.hw3] as const

const HARDWARE: MapNodeDef[] = HW_LANES.flatMap((l) =>
  HW_MULTS.map((mult, i) => {
    const tier = i + 1
    const id = `hardware-${l.key}-${tier}`
    const parents = tier === 1 ? [l.parent1] : [`hardware-${l.key}-${tier - 1}`]
    const node: MapNodeDef = {
      id,
      title: l.titles[i],
      desc: `${HW_PCTS[i]} output from every ${l.label} rig. ${l.flavor[i]}`,
      branch: 'hardware',
      cost: l.baseCost * 10 ** i,
      currency: 'credits',
      parents,
      effects: [{ kind: 'familyMult', family: l.family, value: mult }],
      position: at(l.col, HW_ROWS[i]),
      icon: l.icons[i],
    }
    // The first node of each family only appears once you own that class of hardware.
    if (tier === 1) node.unlock = { type: 'ownFamily', family: l.family }
    return node
  }),
)

// ---------------------------------------------------------------------------
// Models lane: loaders, adapters and pipelines that make posts better.
// ---------------------------------------------------------------------------
const MODELS = lane('models', MAP_ROWS.models, 'credits', [
  {
    id: 'models-manager', col: 2, cost: 1_000, parents: ['core-manager'],
    title: 'Model Manager', icon: 'download',
    desc: 'Generations 5% faster. Downloads go to the right folder on the first try.',
    effects: [{ kind: 'speedMult', value: 0.95 }],
  },
  {
    id: 'models-merge', col: 3, cost: 6_000, parents: ['models-manager'],
    title: 'Checkpoint Merger', icon: 'merge',
    desc: '+5% likes. 0.35 of this, 0.65 of that, a name with an X in it.',
    effects: [{ kind: 'likesMult', value: 1.05 }],
  },
  {
    id: 'models-controlnet', col: 4, cost: 30_000, parents: ['models-merge'],
    title: 'ControlNet', icon: 'pen-tool',
    desc: '+10% likes. The hands are still wrong, but they are wrong where you asked.',
    effects: [{ kind: 'likesMult', value: 1.1 }],
  },
  {
    id: 'models-ipadapter', col: 5, cost: 150_000, parents: ['models-controlnet'],
    title: 'IPAdapter', icon: 'image-plus',
    desc: '+0.5% viral chance. Style transfer that actually transfers the style.',
    effects: [{ kind: 'viralChance', value: 0.005 }],
  },
  {
    id: 'models-upscale', col: 6, cost: 700_000, parents: ['models-ipadapter'],
    title: 'Upscale Model Loader', icon: 'maximize',
    desc: '+5% payout per like. 4x-UltraSharp on everything, including the memes.',
    effects: [{ kind: 'payoutRatio', value: 0.05 }],
  },
  {
    id: 'models-video-combine', col: 7, cost: 3.5e6, parents: ['models-upscale'],
    title: 'Video Combine', icon: 'clapperboard',
    desc: '+10% likes. Frames become a video. The video becomes a 200 MB GIF.',
    effects: [{ kind: 'likesMult', value: 1.1 }],
  },
  {
    id: 'models-kontext', col: 8, cost: 1.5e7, parents: ['models-video-combine'],
    title: 'Context Editing', icon: 'scan',
    desc: '-2% flop chance. Change the hat, keep the face. Revolutionary.',
    effects: [{ kind: 'flopChance', value: 0.02 }],
  },
  {
    id: 'models-lightning', col: 9, cost: 7e7, parents: ['models-kontext'],
    title: 'Lightning LoRAs', icon: 'zap',
    desc: 'Generations 10% faster. Four steps, CFG 1, no regrets.',
    effects: [{ kind: 'speedMult', value: 0.9 }],
  },
  {
    id: 'models-3d-viewer', col: 10, cost: 3e8, parents: ['models-lightning'],
    title: '3D Preview Node', icon: 'rotate-3d',
    desc: '+15% likes. Spin the mesh. Spin it again. Post it.',
    effects: [{ kind: 'likesMult', value: 1.15 }],
  },
  {
    id: 'models-omni', col: 11, cost: 1.5e9, parents: ['models-3d-viewer'],
    title: 'Omni Pipeline', icon: 'combine',
    desc: '+1 concurrent job, +10% likes. Text, image, video and audio in one graph you cannot see the end of.',
    effects: [{ kind: 'concurrency', value: 1 }, { kind: 'likesMult', value: 1.1 }],
  },
  {
    id: 'models-zoo', col: 12, cost: 1e10, parents: ['models-omni'],
    title: 'Model Zoo', icon: 'library',
    desc: '+20% income, +20% likes. Every checkpoint ever released, 40 TB, indexed.',
    effects: [{ kind: 'globalMult', value: 0.2 }, { kind: 'likesMult', value: 1.2 }],
  },
])

// ---------------------------------------------------------------------------
// Techniques lane: speed, quantization, ROCm, LoRA training, distillation.
// ---------------------------------------------------------------------------
const TECH = lane('techniques', MAP_ROWS.tech, 'credits', [
  {
    id: 'tech-sage', col: 3, cost: 800, parents: ['core-manager'],
    title: 'Triton Kernels', icon: 'wand-sparkles',
    desc: 'Generations 10% faster. One Triton wheel, three hours, zero regrets.',
    effects: [{ kind: 'speedMult', value: 0.9 }],
  },
  {
    id: 'quant-fp8', col: 4, cost: 1_500, parents: ['tech-sage'],
    title: 'FP8 Quantization', icon: 'shrink',
    desc: 'Unlocks FP8 in the Quantize panel: half the VRAM, a little less detail.',
    effects: [],
  },
  {
    id: 'quant-q4', col: 5, cost: 15_000, parents: ['quant-fp8'],
    title: 'GGUF Q4', icon: 'minimize-2',
    desc: 'Unlocks Q4 in the Quantize panel: a quarter of the VRAM, a lot less detail.',
    effects: [],
  },
  {
    id: 'tech-torch-compile', col: 6, cost: 50_000, parents: ['quant-q4'],
    title: 'torch.compile', icon: 'terminal',
    desc: 'Generations 10% faster after a two-minute warm-up you will never skip.',
    effects: [{ kind: 'speedMult', value: 0.9 }],
  },
  {
    id: 'tech-distill', col: 7, cost: 200_000, parents: ['tech-torch-compile'],
    title: 'Distillation Lab', icon: 'flask-conical',
    desc: 'Generations 5% faster and opens per-family distillation below.',
    effects: [{ kind: 'speedMult', value: 0.95 }],
  },
  {
    id: 'tech-block-swap', col: 8, cost: 1e6, parents: ['tech-distill'],
    title: 'Block Swap', icon: 'arrow-left-right',
    desc: '+1 concurrent job. Transformer blocks commute between RAM and VRAM.',
    effects: [{ kind: 'concurrency', value: 1 }],
  },
  {
    id: 'tech-teacache', col: 9, cost: 4e6, parents: ['tech-block-swap'],
    title: 'MagCache', icon: 'coffee',
    desc: 'Generations 15% faster. Skips the steps that would not have changed anything.',
    effects: [{ kind: 'speedMult', value: 0.85 }],
  },
  {
    id: 'tech-sage-2', col: 10, cost: 2.5e7, parents: ['tech-teacache'],
    title: 'Sage Attention 2++', icon: 'sparkles',
    desc: 'Generations 15% faster. The pluses are load-bearing.',
    effects: [{ kind: 'speedMult', value: 0.85 }],
  },
  {
    id: 'tech-nunchaku', col: 11, cost: 1.5e8, parents: ['tech-sage-2'],
    title: 'Nunchaku SVDQuant', icon: 'swords',
    desc: 'Generations 20% faster. 4-bit weights, 4-bit activations, full-size ego.',
    effects: [{ kind: 'speedMult', value: 0.8 }],
  },
  {
    id: 'tech-fp4', col: 12, cost: 1e9, parents: ['tech-nunchaku'],
    title: 'NVFP4 Kernels', icon: 'binary',
    desc: 'Generations 15% faster, +5% likes. Blackwell finally does the thing on the slide.',
    effects: [{ kind: 'speedMult', value: 0.85 }, { kind: 'likesMult', value: 1.05 }],
  },
  {
    id: 'tech-custom-kernels', col: 13, cost: 1e10, parents: ['tech-fp4'],
    title: 'Hand-Rolled CUDA Kernels', icon: 'code',
    desc: 'Generations 30% faster. You wrote them at 3 a.m. They only work on your card.',
    effects: [{ kind: 'speedMult', value: 0.7 }],
  },
])

const DISTILL_FAMILIES: Array<{ family: string; label: string; cost: number; icon: string }> = [
  { family: 'sd', label: 'Stable Diffusion', cost: 4e5, icon: 'image' },
  { family: 'flux', label: 'FLUX', cost: 8e5, icon: 'wind' },
  { family: 'qwen', label: 'Qwen', cost: 1.6e6, icon: 'languages' },
  { family: 'wan', label: 'Wan', cost: 3.2e6, icon: 'video' },
  { family: 'ltx', label: 'LTX', cost: 6.4e6, icon: 'film' },
  { family: 'hunyuan', label: 'Hunyuan', cost: 1.28e7, icon: 'box' },
]

const TECH2 = lane('techniques', MAP_ROWS.tech2, 'credits', [
  {
    id: 'rocm-basics', col: 3, cost: 3_000, parents: ['tech-sage'],
    title: 'ROCm Basics', icon: 'wrench',
    desc: 'AMD rigs ×1.2. HSA_OVERRIDE_GFX_VERSION set; segfaults reduced to weekly.',
    effects: [{ kind: 'familyMult', family: 'amd-consumer', value: 1.2 }],
    unlock: { type: 'ownFamily', family: 'amd-consumer' },
  },
  {
    id: 'zluda', col: 4, cost: 5_000, parents: ['rocm-basics'],
    title: 'ZLUDA', icon: 'ghost',
    desc: 'CUDA-only models run on AMD. Legally distinct from magic.',
    effects: [{ kind: 'zluda' }],
  },
  {
    id: 'lora-training', col: 5, cost: 4_000, parents: ['tech-sage'],
    title: 'LoRA Training', icon: 'graduation-cap',
    desc: 'Unlocks the LoRA trainer: train a style per hashtag for a permanent likes bonus on it.',
    // Marker effect: tag '*' with value 0 is inert in derived.ts but signals the trainer is available.
    effects: [{ kind: 'tagLikes', tag: '*', value: 0 }],
  },
  ...DISTILL_FAMILIES.map<NodeSpec>((d, i) => ({
    id: `distill-${d.family}`,
    col: 7 + i,
    cost: d.cost,
    parents: ['tech-distill'],
    title: `Distill ${d.label}`,
    icon: d.icon,
    desc: `${d.label} models generate 30% faster. Fewer steps, same vibes.`,
    effects: [{ kind: 'familyGenTime', family: d.family, value: 0.7 }],
  })),
])

// ---------------------------------------------------------------------------
// Infra lane: power (row 3) and cooling/ops (row 2). Big power beyond the upgrades.
// ---------------------------------------------------------------------------
const INFRA_POWER = lane('infra', MAP_ROWS.infraPower, 'credits', [
  {
    id: 'infra-undervolt', col: 4, cost: 5_000, parents: ['core-readme'],
    title: 'Undervolt', icon: 'battery-charging',
    desc: '+200 W power budget. Same clocks, less heat, smug feeling.',
    effects: [{ kind: 'powerBudget', value: 200 }],
  },
  {
    id: 'power-dedicated-circuit', col: 5, cost: 25_000, parents: ['infra-undervolt'],
    title: 'Dedicated 20 A Circuit', icon: 'plug-zap',
    desc: '+2 kW power budget. The microwave and the 4090 no longer share a breaker.',
    effects: [{ kind: 'powerBudget', value: 2_000 }],
  },
  {
    id: 'power-three-phase', col: 6, cost: 150_000, parents: ['power-dedicated-circuit'],
    title: 'Second Utility Feed', icon: 'utility-pole',
    desc: '+15 kW power budget. The electrician asked what the rack was for. You said "art".',
    effects: [{ kind: 'powerBudget', value: 15_000 }],
  },
  {
    id: 'power-substation', col: 7, cost: 1e6, parents: ['power-three-phase'],
    title: 'Private Substation', icon: 'factory',
    desc: '+200 kW power budget. There is a transformer in the garden now.',
    effects: [{ kind: 'powerBudget', value: 200_000 }],
  },
  {
    id: 'power-microgrid', col: 8, cost: 6e6, parents: ['power-substation'],
    title: 'Microgrid', icon: 'sun-medium',
    desc: '+500 kW power budget. Solar, batteries, and a diesel backup you never mention.',
    effects: [{ kind: 'powerBudget', value: 500_000 }],
  },
  {
    id: 'power-hydro', col: 9, cost: 4e7, parents: ['power-microgrid'],
    title: 'Hydro Dam Lease', icon: 'waves',
    desc: '+5 MW power budget. Renewable, quiet, upstream of someone else’s datacenter.',
    effects: [{ kind: 'powerBudget', value: 5e6 }],
  },
  {
    id: 'power-smr', col: 10, cost: 3e8, parents: ['power-hydro'],
    title: 'Small Modular Reactor', icon: 'atom',
    desc: '+50 MW power budget. Small is relative.',
    effects: [{ kind: 'powerBudget', value: 5e7 }],
  },
  {
    id: 'power-orbital-solar', col: 11, cost: 2e9, parents: ['power-smr'],
    title: 'Orbital Solar Array', icon: 'satellite',
    desc: '+1 GW power budget, beamed down. Do not stand in the beam.',
    effects: [{ kind: 'powerBudget', value: 1e9 }],
  },
])

const INFRA_OPS = lane('infra', MAP_ROWS.infraOps, 'credits', [
  {
    id: 'infra-cron', col: 3, cost: 8_000, parents: ['core-readme'],
    title: 'Cron Queue', icon: 'clock',
    desc: '+2 h offline cap. The queue keeps working while you sleep. Unlike the frontend.',
    effects: [{ kind: 'offlineCapHours', value: 2 }],
  },
  {
    id: 'cooling-aio', col: 4, cost: 10_000, parents: ['infra-undervolt'],
    title: 'Repaste & Fan Curve', icon: 'fan',
    desc: 'NVIDIA consumer cards run one tier faster. Fresh paste, louder fans, cooler dies.',
    effects: [{ kind: 'coolingTier', family: 'nvidia-consumer', value: 1 }],
  },
  {
    id: 'cooling-loop', col: 5, cost: 80_000, parents: ['cooling-aio'],
    title: 'Dual-Loop Water Cooling', icon: 'droplets',
    desc: 'NVIDIA and AMD consumer cards run one tier faster. Leak-tested twice, panicked once.',
    effects: [
      { kind: 'coolingTier', family: 'nvidia-consumer', value: 1 },
      { kind: 'coolingTier', family: 'amd-consumer', value: 1 },
    ],
  },
  {
    id: 'cooling-hot-aisle', col: 6, cost: 500_000, parents: ['cooling-loop'],
    title: 'Hot Aisle Containment', icon: 'thermometer',
    desc: 'Workstation cards run one tier faster. The hallway is 40 °C; the racks are happy.',
    effects: [{ kind: 'coolingTier', family: 'workstation', value: 1 }],
  },
  {
    id: 'cooling-immersion', col: 7, cost: 4e6, parents: ['cooling-hot-aisle'],
    title: 'Two-Phase Immersion', icon: 'test-tubes',
    desc: 'Datacenter nodes run one tier faster. Dielectric fluid, fish optional.',
    effects: [{ kind: 'coolingTier', family: 'datacenter', value: 1 }],
  },
  {
    id: 'cluster-ops', col: 8, cost: 1e7, parents: ['power-microgrid', 'cooling-immersion'],
    title: 'Cluster Ops', icon: 'boxes',
    desc: '+1 concurrent job. Kubernetes, but for latents. Opens the Regions lane.',
    effects: [{ kind: 'concurrency', value: 1 }],
  },
  {
    id: 'reserved-capacity', col: 9, cost: 5e7, parents: ['cluster-ops'],
    title: 'Reserved Capacity', icon: 'lock-keyhole',
    desc: 'Spot reclaims can no longer take your cloud nodes away mid-render.',
    effects: [{ kind: 'reservedCapacity' }],
  },
  {
    id: 'cooling-liquid-chip', col: 10, cost: 2e8, parents: ['reserved-capacity'],
    title: 'Direct Liquid-to-Chip', icon: 'snowflake',
    desc: 'Datacenter and cloud nodes run one tier faster. Cold plates on every die.',
    effects: [
      { kind: 'coolingTier', family: 'datacenter', value: 1 },
      { kind: 'coolingTier', family: 'cloud-node', value: 1 },
    ],
  },
  {
    id: 'infra-always-on', col: 11, cost: 1e9, parents: ['cooling-liquid-chip'],
    title: 'Always-On Fleet', icon: 'moon',
    desc: '+8 h offline cap. The fleet renders through the weekend without you.',
    effects: [{ kind: 'offlineCapHours', value: 8 }],
  },
  {
    id: 'infra-autoscaler', col: 12, cost: 5e9, parents: ['infra-always-on'],
    title: 'Autoscaler', icon: 'trending-up',
    desc: '+2 concurrent jobs. Scales to demand. Also scales the bill.',
    effects: [{ kind: 'concurrency', value: 2 }],
  },
])

// ---------------------------------------------------------------------------
// Regions lane: planetary scale, then orbit. Credits, then Comfy Points.
// ---------------------------------------------------------------------------
const REGIONS = lane('regions', MAP_ROWS.regions, 'credits', [
  {
    id: 'regions-unlock', col: 9, cost: 2e7, parents: ['cluster-ops'],
    title: 'Go Multi-Region', icon: 'earth',
    desc: 'Unlocks region purchases in the store, +4 h offline cap. The sun never sets on your queue.',
    effects: [{ kind: 'offlineCapHours', value: 4 }],
    unlock: { type: 'ownFamily', family: 'cloud-node' },
  },
  {
    id: 'region-latency', col: 10, cost: 6e7, parents: ['regions-unlock'],
    title: 'Edge Routing', icon: 'route',
    desc: 'Generations 10% faster. Jobs land on the nearest idle rack.',
    effects: [{ kind: 'speedMult', value: 0.9 }],
  },
  {
    id: 'region-peering', col: 11, cost: 2e8, parents: ['region-latency'],
    title: 'Peering Fabric', icon: 'network',
    desc: '+2 concurrent jobs. Private links between regions, no public internet in the loop.',
    effects: [{ kind: 'concurrency', value: 2 }],
  },
  {
    id: 'region-failover', col: 12, cost: 6e8, parents: ['region-peering'],
    title: 'Multi-Region Failover', icon: 'shield',
    desc: '+8 h offline cap, -2% flop chance. One region burns, another finishes the render.',
    effects: [{ kind: 'offlineCapHours', value: 8 }, { kind: 'flopChance', value: 0.02 }],
  },
  {
    id: 'region-anycast', col: 13, cost: 2e9, parents: ['region-failover'],
    title: 'Anycast Everything', icon: 'radio',
    desc: '+15% income. One IP, every continent, zero explanations to the network team.',
    effects: [{ kind: 'globalMult', value: 0.15 }],
  },
  {
    id: 'region-antarctica', col: 14, cost: 6e9, parents: ['region-anycast'],
    title: 'Antarctic Datacenter', icon: 'mountain-snow',
    desc: 'Regions run two tiers faster, +1 MW power budget. Free cooling, expensive penguins.',
    effects: [{ kind: 'coolingTier', family: 'region', value: 2 }, { kind: 'powerBudget', value: 1e6 }],
  },
  {
    id: 'orbital-unlock', col: 15, cost: 25, currency: 'cp', parents: ['region-antarctica'],
    title: 'Orbital Compute', icon: 'orbit',
    desc: 'Unlocks orbital hardware in the store. Latency measured in light-milliseconds.',
    effects: [],
    unlock: { type: 'ownFamily', family: 'region' },
  },
  {
    id: 'orbital-relay', col: 16, cost: 60, currency: 'cp', parents: ['orbital-unlock'],
    title: 'Orbital Relay Mesh', icon: 'satellite-dish',
    desc: '+25% income. Laser links between satellites. Space spaghetti.',
    effects: [{ kind: 'globalMult', value: 0.25 }],
  },
  {
    id: 'dyson-unlock', col: 17, cost: 200, currency: 'cp', parents: ['orbital-relay', 'power-orbital-solar'],
    title: 'Dyson Swarm Blueprint', icon: 'sun',
    desc: 'Unlocks the Dyson Swarm in the store. Every photon becomes a latent.',
    effects: [],
  },
])

// ---------------------------------------------------------------------------
// API lane: API Nodes and the business of renting other people's models.
// ---------------------------------------------------------------------------
const API = lane('api', MAP_ROWS.api, 'credits', [
  {
    id: 'api-nodes', col: 6, cost: 5e6, parents: ['core-batch'],
    title: 'API Nodes', icon: 'plug',
    desc: 'Unlocks API models (no VRAM needed, +50% job cost). Someone else’s cluster, your prompt.',
    effects: [{ kind: 'apiNodes' }],
  },
  {
    id: 'api-keys', col: 7, cost: 1.5e7, parents: ['api-nodes'],
    title: 'API Key Vault', icon: 'key-round',
    desc: '+5% payout per like. Keys in a vault instead of in the workflow JSON you posted.',
    effects: [{ kind: 'payoutRatio', value: 0.05 }],
  },
  {
    id: 'api-batch', col: 8, cost: 5e7, parents: ['api-keys'],
    title: 'Batched API Calls', icon: 'layers-2',
    desc: '+1 concurrent job. Rate limits are just a suggestion with a retry loop.',
    effects: [{ kind: 'concurrency', value: 1 }],
  },
  {
    id: 'api-partner', col: 9, cost: 2e8, parents: ['api-batch'],
    title: 'Partner Pricing', icon: 'badge-percent',
    desc: '+15% payout per like. You are on a first-name basis with a pricing page.',
    effects: [{ kind: 'payoutRatio', value: 0.15 }],
  },
  {
    id: 'api-hailuo', col: 10, cost: 8e8, parents: ['api-partner'],
    title: 'Hailuo Priority Lane', icon: 'fast-forward',
    desc: '+15% likes. MiniMax renders yours first, and it shows.',
    effects: [{ kind: 'likesMult', value: 1.15 }],
    // Hailuo is the hosted MiniMax line (an API model), not the 160 GB local MiniMax H3.
    unlock: { type: 'ownModel', id: 'hailuo' },
  },
  {
    id: 'api-sla', col: 11, cost: 3e9, parents: ['api-hailuo'],
    title: 'Enterprise SLA', icon: 'file-check',
    desc: '-3% flop chance, +10% income. 99.99% uptime, 100% invoice.',
    effects: [{ kind: 'flopChance', value: 0.03 }, { kind: 'globalMult', value: 0.1 }],
  },
  {
    id: 'api-cloud-credits', col: 12, cost: 1e10, parents: ['api-sla'],
    title: 'Comfy Cloud Credits', icon: 'coins',
    desc: '+30% income. The credits are real. That is the joke.',
    effects: [{ kind: 'globalMult', value: 0.3 }],
  },
])

// ---------------------------------------------------------------------------
// Social lane: paid in Research Points (RP). Spending RP never lowers the RP bonus.
// ---------------------------------------------------------------------------
const SOCIAL = lane('social', MAP_ROWS.social, 'rp', [
  {
    id: 'social-reddit', col: 3, cost: 1, parents: ['core-readme'],
    title: 'Post to r/comfyui', icon: 'message-square',
    desc: 'Follower rate ×1.1. Title: "workflow in comments". There is no workflow in the comments.',
    effects: [{ kind: 'followRate', value: 1.1 }],
  },
  {
    id: 'hashtag-research-plus', col: 4, cost: 2, parents: ['social-reddit'],
    title: 'Hashtag Research+', icon: 'hash',
    desc: 'Reveals next week’s trending tags early and adds +5% likes.',
    effects: [{ kind: 'hashtagResearch' }, { kind: 'likesMult', value: 1.05 }],
  },
  {
    id: 'streak-grace', col: 5, cost: 3, parents: ['hashtag-research-plus'],
    title: 'Streak Grace', icon: 'calendar-check',
    desc: 'Miss one day and your daily streak survives. Touch grass, keep the streak.',
    effects: [{ kind: 'streakGrace' }],
  },
  {
    id: 'social-discord', col: 6, cost: 4, parents: ['streak-grace'],
    title: 'Discord Showcase', icon: 'megaphone',
    desc: '+10% likes. #showcase, 14 reactions, one "workflow?"',
    effects: [{ kind: 'likesMult', value: 1.1 }],
  },
  {
    id: 'social-founder-follow', col: 7, cost: 6, parents: ['social-discord'],
    title: 'Founder Follow-Back', icon: 'user-check',
    desc: '+1% viral chance. comfyanonymous followed you. You screenshotted it.',
    effects: [{ kind: 'viralChance', value: 0.01 }],
  },
  {
    id: 'social-alt', col: 8, cost: 8, parents: ['social-founder-follow'],
    title: 'The Alt Account', icon: 'venetian-mask',
    desc: '-3% flop chance. Test posts go to the alt. The alt has 3 followers. All you.',
    effects: [{ kind: 'flopChance', value: 0.03 }],
  },
  {
    id: 'social-hub', col: 9, cost: 12, parents: ['social-alt'],
    title: 'ComfyHub Workflows', icon: 'share-2',
    desc: '+10% payout per like. Publish the graph; every run is a tiny royalty.',
    effects: [{ kind: 'payoutRatio', value: 0.1 }],
  },
  {
    id: 'social-tutorial', col: 10, cost: 16, parents: ['social-hub'],
    title: 'Tutorial Series', icon: 'video',
    desc: 'Follower rate ×1.2. "In this video we will" (40 minutes) "install a node".',
    effects: [{ kind: 'followRate', value: 1.2 }],
  },
  {
    id: 'social-sponsor', col: 11, cost: 24, parents: ['social-tutorial'],
    title: 'Sponsorships', icon: 'badge-dollar-sign',
    desc: '+20% payout per like. This render is brought to you by a GPU cloud you already use.',
    effects: [{ kind: 'payoutRatio', value: 0.2 }],
  },
  {
    id: 'social-keynote', col: 12, cost: 32, parents: ['social-sponsor'],
    title: 'Keynote Slot', icon: 'presentation',
    desc: '+25% likes. Live demo. The demo works. Nobody believes it was live.',
    effects: [{ kind: 'likesMult', value: 1.25 }],
  },
  {
    id: 'social-cm', col: 13, cost: 45, parents: ['social-keynote'],
    title: 'Community Manager', icon: 'users',
    desc: 'Follower rate ×1.3, -2% flop chance. Someone else answers "workflow?" now.',
    effects: [{ kind: 'followRate', value: 1.3 }, { kind: 'flopChance', value: 0.02 }],
  },
  {
    id: 'social-cult', col: 14, cost: 60, parents: ['social-cm'],
    title: 'Cult Following', icon: 'crown',
    desc: '+2% viral chance, +10% likes. They have a Discord about your Discord.',
    effects: [{ kind: 'viralChance', value: 0.02 }, { kind: 'likesMult', value: 1.1 }],
  },
])

// ---------------------------------------------------------------------------
// Prestige lane: Comfy Points (CP), earned by rebranding. Persists across seasons.
// ---------------------------------------------------------------------------
const PRESTIGE = lane('prestige', MAP_ROWS.prestige, 'cp', [
  {
    id: 'season-income-1', col: 1, cost: 3, parents: ['core-root'],
    title: 'Season Income I', icon: 'trending-up',
    desc: 'CP income bonus ×1.1. Your past seasons pay a little better.',
    effects: [{ kind: 'cpMult', value: 1.1 }],
  },
  {
    id: 'start-with-4090', col: 2, cost: 5, parents: ['season-income-1'],
    title: 'Start With a 4090', icon: 'zap',
    desc: 'Every new season begins with one RTX 4090 already installed.',
    effects: [{ kind: 'startHardware', hardwareId: 'rtx-4090', count: 1 }],
  },
  {
    id: 'season-income-2', col: 3, cost: 6, parents: ['start-with-4090'],
    title: 'Season Income II', icon: 'trending-up',
    desc: 'CP income bonus ×1.1 again. Compounding, like your custom_nodes folder.',
    effects: [{ kind: 'cpMult', value: 1.1 }],
  },
  {
    id: 'prestige-muscle-memory', col: 4, cost: 8, parents: ['season-income-2'],
    title: 'Muscle Memory', icon: 'mouse-pointer-click',
    desc: 'Clicks ×2, forever. Your finger remembers where Queue Prompt was.',
    effects: [{ kind: 'clickMult', value: 2 }],
  },
  {
    id: 'fast-weeks', col: 5, cost: 10, parents: ['prestige-muscle-memory'],
    title: 'Fast Weeks', icon: 'fast-forward',
    desc: 'Trending hashtags rotate twice as often. Twice the trends, twice the FOMO.',
    effects: [{ kind: 'weekSpeed', value: 2 }],
  },
  {
    id: 'season-income-3', col: 6, cost: 12, parents: ['fast-weeks'],
    title: 'Season Income III', icon: 'trending-up',
    desc: 'CP income bonus ×1.1 again.',
    effects: [{ kind: 'cpMult', value: 1.1 }],
  },
  {
    id: 'prestige-warm-cache', col: 7, cost: 16, parents: ['season-income-3'],
    title: 'Warm Cache', icon: 'flame',
    desc: 'Generations 15% faster, forever. The first run is never cold again.',
    effects: [{ kind: 'speedMult', value: 0.85 }],
  },
  {
    id: 'start-with-pro-6000', col: 8, cost: 20, parents: ['prestige-warm-cache'],
    title: 'Start With a PRO 6000', icon: 'microchip',
    desc: 'Every new season begins with one RTX PRO 6000. 96 GB of head start.',
    effects: [{ kind: 'startHardware', hardwareId: 'rtx-pro-6000', count: 1 }],
  },
  {
    id: 'season-income-4', col: 9, cost: 25, parents: ['start-with-pro-6000'],
    title: 'Season Income IV', icon: 'trending-up',
    desc: 'CP income bonus ×1.1 again.',
    effects: [{ kind: 'cpMult', value: 1.1 }],
  },
  {
    id: 'prestige-legacy-audience', col: 10, cost: 40, parents: ['season-income-4'],
    title: 'Legacy Audience', icon: 'heart-handshake',
    desc: 'Follower rate ×1.5, forever. They remember the old account.',
    effects: [{ kind: 'followRate', value: 1.5 }],
  },
  {
    id: 'season-income-5', col: 11, cost: 50, parents: ['prestige-legacy-audience'],
    title: 'Season Income V', icon: 'trending-up',
    desc: 'CP income bonus ×1.1 one last time.',
    effects: [{ kind: 'cpMult', value: 1.1 }],
  },
  {
    id: 'prestige-founders-club', col: 12, cost: 80, parents: ['season-income-5'],
    title: 'Founders’ Club', icon: 'award',
    desc: '+2% viral chance, +20% likes, forever. There is a jacket.',
    effects: [{ kind: 'viralChance', value: 0.02 }, { kind: 'likesMult', value: 1.2 }],
  },
  {
    id: 'start-with-h100', col: 13, cost: 120, parents: ['prestige-founders-club'],
    title: 'Start With an H100', icon: 'server',
    desc: 'Every new season begins with one H100 80 GB. Skip the consumer aisle entirely.',
    effects: [{ kind: 'startHardware', hardwareId: 'h100-80', count: 1 }],
  },
  {
    id: 'prestige-singularity', col: 14, cost: 200, parents: ['start-with-h100'],
    title: 'The Singularity', icon: 'infinity',
    desc: '+50% income, forever. The workflow generates the next workflow.',
    effects: [{ kind: 'globalMult', value: 0.5 }],
  },
])

// ---------------------------------------------------------------------------
// Hidden lane: easter eggs. Invisible until the matching flag is raised by the UI through
// `actions.setFlag` (keys: ticker-seven, konami, seed42, rickroll; see UI_FLAGS in actions.ts).
// ---------------------------------------------------------------------------
const HIDDEN = lane('hidden', MAP_ROWS.hidden, 'credits', [
  {
    id: 'pythongosssss-node', col: 1, cost: 777, parents: ['core-root'], hidden: true,
    title: 'pysssss Custom Scripts', icon: 'sparkles',
    desc: '+7% income. Somehow every workflow already depends on it.',
    effects: [{ kind: 'globalMult', value: 0.07 }],
    unlock: { type: 'flag', key: 'ticker-seven' },
  },
  {
    id: 'spaghetti-monster', col: 2, cost: 1_111, parents: ['core-root'], hidden: true,
    title: 'Flying Spaghetti Monster', icon: 'utensils',
    desc: '+11% likes. You summoned it with the noodles. It is pleased.',
    effects: [{ kind: 'likesMult', value: 1.11 }],
    unlock: { type: 'flag', key: 'konami' },
  },
  {
    id: 'seed-42', col: 3, cost: 42, parents: ['core-root'], hidden: true,
    title: 'Seed 42', icon: 'dices',
    desc: '+1% viral chance. The answer, fixed, control_after_generate.',
    effects: [{ kind: 'viralChance', value: 0.01 }],
    unlock: { type: 'flag', key: 'seed42' },
  },
  {
    id: 'rickroll', col: 4, cost: 1_987, parents: ['core-root'], hidden: true,
    title: 'Never Gonna Give You Up', icon: 'music',
    desc: 'Follower rate ×1.05. They stayed for the workflow. Or so they say.',
    effects: [{ kind: 'followRate', value: 1.05 }],
    unlock: { type: 'flag', key: 'rickroll' },
  },
])

export const MAP_NODES: MapNodeDef[] = [
  ...CORE,
  ...HARDWARE,
  ...MODELS,
  ...TECH,
  ...TECH2,
  ...INFRA_POWER,
  ...INFRA_OPS,
  ...REGIONS,
  ...API,
  ...SOCIAL,
  ...PRESTIGE,
  ...HIDDEN,
]
