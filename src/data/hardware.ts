/**
 * Hardware ladder for Comfy Clicker.
 *
 * Units are listed in ascending `baseCost`; a unit's position in that list is its `rank`. The
 * ladder has two halves, split at the RTX PRO 6000 (rank PAYBACK_PEAK_RANK):
 *
 *   The climb (rank ≤ 19): design payback (seconds of income to recoup the first unit) falls
 *   with rank, so "save for the biggest thing you can reach" is the right call all the way up
 *   the consumer and workstation aisles:
 *     payback(rank) = 125 − 4.5·rank                        for rank ≤ 14  (125 → 62 s)
 *     payback(rank) = 40 + (62 − 40) × 0.9^(rank − 14)      for 14 < rank ≤ 19  (→ 53 s)
 *
 *   The tail (rank > 19): payback rises again, family by family (TAIL_PAYBACK_S): datacenter
 *   silicon 1 → 4 min, cloud nodes 5 min → 4 h, Comfy Cloud regions 12 → 48 h, then the Orbital
 *   Datacenter (five days) and the Dyson swarm (ten). Every rung is a bigger, *less* efficient
 *   purchase, so income keeps growing but the game decelerates the way an incremental should;
 *   the cheaper tail units stay worth buying until their per-unit growth (1.15 past the
 *   workstation aisle) catches them up. Tail prices step ×1.5–3 per rung so that a rung is
 *   exhausted in hours, not minutes: with tier upgrades worth ×16 per unit, the number of units a
 *   rung yields, not its first-unit payback, is what sets the pace. `scripts/balance.ts` is the
 *   referee: PRO 6000 inside 60 min, a cloud node inside 4 h, no region inside three hours of
 *   continuous play, regions from day five of a one-hour-a-day fortnight, orbit and the swarm
 *   beyond it.
 *
 * The pace of the ladder is the player level. Every unit carries a `minLevel` (level 1 when
 * omitted) and the store refuses it below that with `Needs level N · you are level M`, exactly
 * as a checkpoint does; each level opens one rung of cards, and the checkpoints that rung holds
 * natively are never gated below the card (hardware-data.test.ts pins that). Payback still
 * decides *which* unit to buy inside a level; the level decides when the next rung opens. The
 * table, by level: 1 the two CPUs · 2 Mac mini, RX 7600 XT, RTX 3060 · 3 RX 9070 XT, 4070 Ti
 * Super, 3090 · 4 RX 7900 XTX, 4090, 5080, Mac Studio · 5 5090, W7900 · 6 A6000, L4, 6000 Ada ·
 * 7 A40, L40S, PRO 6000 · 8 A100, MI300X · 9 H100, MI325X, H200 · 10 B200, B300, p4d, ND MI300X ·
 * 11 p5, p5e, p6, 8x B300 · 12 us-east · 13 eu-west · 14 ap-southeast · 16 orbit · 20 the swarm.
 *
 * Vendor adjustments: consumer Radeons are a little cheaper per cps (×AMD_PAYBACK_MULT) but sit
 * behind the ROCm upgrade and a ×1.25 gen-time tax; the MI-series datacenter parts get no
 * discount (256 GB of HBM is the selling point). Apple MPS is ×1.3 (unified memory is roomy, not
 * fast). `baseCps = round3(baseCost / payback)`.
 *
 * Everything else (growth per family, speed tiers, flags) is derived from the spec rows below
 * so the whole ladder can be re-balanced from one place.
 */
import type { HardwareDef, HardwareFamily, UnlockCond, Vendor } from '@/game/types'

export const PAYBACK_MAX_S = 125
export const PAYBACK_STEP_S = 4.5
/** Last rank of the linear ramp; 125 − 4.5 × 14 = 62 s hands over to the geometric stretch. */
export const PAYBACK_KNEE_RANK = 14
/** Asymptote of the geometric stretch (seconds). Approached, never reached. */
export const PAYBACK_MIN_S = 40
/** Each rung past the knee keeps this fraction of the remaining gap to PAYBACK_MIN_S. */
export const PAYBACK_TAIL_DECAY = 0.9
/** Last rank whose payback still improves on the one below it: the RTX PRO 6000. */
export const PAYBACK_PEAK_RANK = 19
/** Consumer Radeons: a little cheaper per cps, gated behind ROCm, taxed ×1.25 on gen time. */
export const AMD_PAYBACK_MULT = 0.92
/** Apple: lots of unified memory, images only, slow. */
export const MPS_PAYBACK_MULT = 1.3

/**
 * Payback bands for the tail (rank > PAYBACK_PEAK_RANK), per family: [first unit, last unit] in
 * seconds, interpolated geometrically by the unit's position among its family's tail units.
 */
export const TAIL_PAYBACK_S: Partial<Record<HardwareFamily, readonly [number, number]>> = {
  datacenter: [60, 4 * 60],
  'cloud-node': [5 * 60, 4 * 3600],
  region: [12 * 3600, 48 * 3600],
}

/** Trophy units priced off the chart, in seconds of income. */
export const PAYBACK_OVERRIDE_S: Readonly<Record<string, number>> = {
  'orbital-dc': 120 * 3600,
  'dyson-swarm': 240 * 3600,
}

/**
 * Design payback (seconds) of the climb at cost rank `rank` (0 = cheapest), before vendor
 * multipliers. Only meaningful up to PAYBACK_PEAK_RANK; the tail is priced by `tailPayback`.
 */
export function paybackForRank(rank: number): number {
  const r = Math.max(0, rank)
  if (r <= PAYBACK_KNEE_RANK) return PAYBACK_MAX_S - PAYBACK_STEP_S * r
  const knee = PAYBACK_MAX_S - PAYBACK_STEP_S * PAYBACK_KNEE_RANK
  return PAYBACK_MIN_S + (knee - PAYBACK_MIN_S) * PAYBACK_TAIL_DECAY ** (r - PAYBACK_KNEE_RANK)
}

/**
 * Design payback (seconds) of the `index`-th of `count` tail units in `family`: geometric
 * interpolation across the family's TAIL_PAYBACK_S band (a lone unit sits at the band's start).
 */
export function tailPayback(family: HardwareFamily, index: number, count: number): number {
  const band = TAIL_PAYBACK_S[family]
  if (!band) throw new Error(`hardware: no tail payback band for family ${family}`)
  const [lo, hi] = band
  if (count <= 1) return lo
  const t = Math.min(count - 1, Math.max(0, index)) / (count - 1)
  return lo * (hi / lo) ** t
}

/**
 * Per-unit price growth by family. The climb eases off through the consumer and workstation
 * aisles so the first hour keeps moving; the tail families go back to 1.15 (Cookie Clicker's
 * number) so a datacenter or cloud rung is exhausted after ~50–75 units instead of ~120. Regions
 * are one-offs (`max: 1`), so their growth never applies.
 */
export const FAMILY_GROWTH: Record<HardwareFamily, number> = {
  cpu: 1.15,
  apple: 1.15,
  'nvidia-consumer': 1.12,
  'amd-consumer': 1.12,
  workstation: 1.11,
  datacenter: 1.15,
  'cloud-node': 1.15,
  region: 1.15,
}

/** Map-node ids the ladder gates on (owned by src/data/mapNodes.ts). */
export const REGIONS_UNLOCK_NODE = 'regions-unlock'
export const ORBITAL_UNLOCK_NODE = 'orbital-unlock'
export const DYSON_UNLOCK_NODE = 'dyson-unlock'

const ALWAYS: UnlockCond = { type: 'always' }
const own = (id: string): UnlockCond => ({ type: 'ownHardware', id })
const anyOf = (...conds: UnlockCond[]): UnlockCond => ({ type: 'any', conds })
const node = (id: string): UnlockCond => ({ type: 'mapNode', id })

const CLOUD_CARDS_PER_NODE = 8

interface HardwareSpec {
  id: string
  name: string
  short: string
  family: HardwareFamily
  vendor: Vendor
  baseCost: number
  vram: number
  watts: number
  speedTier: number
  unlock: UnlockCond
  /** Player level the unit needs before it can be bought. Omitted for level 1. */
  minLevel?: number
  realWorld?: string
  flavor: string
  cardsPerUnit?: number
  /** Hard cap on owned units (regions and the space hardware are one-offs). */
  max?: number
}

// Ordered by baseCost. Do not reorder: the index is the payback rank.
const SPECS: readonly HardwareSpec[] = [
  {
    id: 'pc-4c8t',
    name: '4c/8t Office PC',
    short: 'Office PC',
    family: 'cpu',
    vendor: 'cpu',
    baseCost: 15,
    vram: 8,
    watts: 65,
    speedTier: 1,
    unlock: ALWAYS,
    realWorld: 'The machine you already have. --cpu flag, infinite patience.',
    flavor: 'Runs SD1.5 on CPU in roughly the time it takes to read the ComfyUI-Manager changelog.',
  },
  {
    id: 'pc-8c16t',
    name: '8c/16t Workstation',
    short: '8c/16t',
    family: 'cpu',
    vendor: 'cpu',
    baseCost: 75,
    vram: 32,
    watts: 120,
    speedTier: 1,
    unlock: ALWAYS,
    flavor: 'Twice the cores. The progress bar now moves visibly, which is technically a feature.',
  },
  {
    id: 'mac-mini-m4',
    name: 'Mac mini M4',
    short: 'Mac mini',
    family: 'apple',
    vendor: 'apple',
    baseCost: 200,
    vram: 24,
    watts: 40,
    speedTier: 2,
    minLevel: 2,
    unlock: own('pc-8c16t'),
    realWorld: 'Unified memory over the MPS backend. Images only.',
    flavor: '24 GB of unified memory. MPS reports "unsupported operator" with genuine remorse.',
  },
  {
    id: 'rx-7600-xt',
    name: 'RX 7600 XT',
    short: '7600 XT',
    family: 'amd-consumer',
    vendor: 'amd',
    baseCost: 300,
    vram: 16,
    watts: 190,
    speedTier: 3,
    minLevel: 2,
    unlock: own('pc-8c16t'),
    realWorld: 'Needs ROCm (Linux) or ZLUDA.',
    flavor: '16 GB for the price of 12. The ROCm install guide is longer than the workflow.',
  },
  {
    id: 'rtx-3060',
    name: 'Used RTX 3060 12GB',
    short: '3060',
    family: 'nvidia-consumer',
    vendor: 'nvidia',
    baseCost: 350,
    vram: 12,
    watts: 170,
    speedTier: 3,
    minLevel: 2,
    unlock: own('pc-8c16t'),
    realWorld: '$0.16/hr class on Runpod.',
    flavor: "The people's card. 12 GB, --lowvram in the launch args, dreams of Flux.",
  },
  {
    id: 'rx-9070-xt',
    name: 'RX 9070 XT',
    short: '9070 XT',
    family: 'amd-consumer',
    vendor: 'amd',
    baseCost: 800,
    vram: 16,
    watts: 304,
    speedTier: 4,
    minLevel: 3,
    unlock: anyOf(own('rtx-3060'), own('rx-7600-xt')),
    flavor: 'RDNA 4 finally does FP8. The subreddit has cautiously updated its wiki.',
  },
  {
    id: 'rtx-4070-ti-super',
    name: 'RTX 4070 Ti Super',
    short: '4070 Ti S',
    family: 'nvidia-consumer',
    vendor: 'nvidia',
    baseCost: 900,
    vram: 16,
    watts: 285,
    speedTier: 4,
    minLevel: 3,
    unlock: own('rtx-3060'),
    flavor: 'The name has four parts and the VRAM has sixteen gigabytes. Fair trade.',
  },
  {
    id: 'rtx-3090',
    name: 'RTX 3090',
    short: '3090',
    family: 'nvidia-consumer',
    vendor: 'nvidia',
    baseCost: 1200,
    vram: 24,
    watts: 350,
    speedTier: 4,
    minLevel: 3,
    unlock: own('rtx-3060'),
    realWorld: '$0.22/hr community on Runpod.',
    flavor: "24 GB on a used-market card. The previous owner mined with it and swears they didn't.",
  },
  {
    id: 'rx-7900-xtx',
    name: 'RX 7900 XTX',
    short: '7900 XTX',
    family: 'amd-consumer',
    vendor: 'amd',
    baseCost: 1500,
    vram: 24,
    watts: 355,
    speedTier: 5,
    minLevel: 4,
    unlock: own('rx-9070-xt'),
    flavor: '24 GB and a fan curve you can hear from the kitchen. Sage Attention support pending.',
  },
  {
    id: 'rtx-4090',
    name: 'RTX 4090',
    short: '4090',
    family: 'nvidia-consumer',
    vendor: 'nvidia',
    baseCost: 1800,
    vram: 24,
    watts: 450,
    speedTier: 5,
    minLevel: 4,
    unlock: anyOf(own('rtx-4070-ti-super'), own('rtx-3090')),
    realWorld: '$0.34/hr community, $0.74/hr secure on Runpod.',
    flavor: 'The default assumption of every custom node README ever written.',
  },
  {
    id: 'rtx-5080',
    name: 'RTX 5080',
    short: '5080',
    family: 'nvidia-consumer',
    vendor: 'nvidia',
    baseCost: 2600,
    vram: 16,
    watts: 360,
    speedTier: 5,
    minLevel: 4,
    unlock: own('rtx-4090'),
    flavor: 'Blackwell, but 16 GB. Very fast at everything that fits.',
  },
  {
    id: 'mac-studio-m4-max',
    name: 'Mac Studio M4 Max 128GB',
    short: 'M4 Max',
    family: 'apple',
    vendor: 'apple',
    baseCost: 4000,
    vram: 128,
    watts: 150,
    speedTier: 2,
    minLevel: 4,
    unlock: own('mac-mini-m4'),
    realWorld: '128 GB unified memory; loads anything, eventually.',
    flavor: 'Loads the whole video model. Then thinks about it.',
  },
  {
    id: 'rtx-5090',
    name: 'RTX 5090',
    short: '5090',
    family: 'nvidia-consumer',
    vendor: 'nvidia',
    baseCost: 9000,
    vram: 32,
    watts: 575,
    speedTier: 6,
    minLevel: 5,
    unlock: own('rtx-4090'),
    realWorld: '$0.69/hr community, $0.99/hr secure on Runpod.',
    flavor: '32 GB and a 575 W power connector with opinions about your PSU.',
  },
  {
    id: 'radeon-pro-w7900',
    name: 'Radeon Pro W7900',
    short: 'W7900',
    family: 'amd-consumer',
    vendor: 'amd',
    baseCost: 11000,
    vram: 48,
    watts: 295,
    speedTier: 6,
    minLevel: 5,
    unlock: own('rx-7900-xtx'),
    flavor: '48 GB in workstation blue. Blower cooler, one slot of dignity.',
  },
  {
    id: 'rtx-a6000',
    name: 'RTX A6000',
    short: 'A6000',
    family: 'workstation',
    vendor: 'nvidia',
    baseCost: 12000,
    vram: 48,
    watts: 300,
    speedTier: 6,
    minLevel: 6,
    unlock: own('rtx-5090'),
    realWorld: '$0.33/hr on Runpod.',
    flavor: 'Ampere with 48 GB and no RGB. The adults have arrived.',
  },
  {
    id: 'l4',
    name: 'NVIDIA L4',
    short: 'L4',
    family: 'datacenter',
    vendor: 'nvidia',
    baseCost: 15000,
    vram: 24,
    watts: 72,
    speedTier: 6,
    minLevel: 6,
    // The workstation A6000 is the on-ramp to datacenter silicon. If both branches opened on the
    // 5090, a payback-greedy climber would skip the workstation chain (and the 96 GB PRO 6000
    // the video models want) entirely, since each datacenter rung out-ranks its neighbour.
    unlock: own('rtx-a6000'),
    realWorld: '$0.44/hr on Runpod.',
    flavor: '72 watts. Slides into a 1U chassis and quietly does batch-of-one all day.',
  },
  {
    id: 'rtx-6000-ada',
    name: 'RTX 6000 Ada',
    short: '6000 Ada',
    family: 'workstation',
    vendor: 'nvidia',
    baseCost: 20000,
    vram: 48,
    watts: 300,
    speedTier: 6,
    minLevel: 6,
    unlock: own('rtx-a6000'),
    realWorld: '$0.74/hr on Runpod.',
    flavor: '48 GB, FP8, and a name that confuses procurement. Worth it.',
  },
  {
    id: 'a40',
    name: 'NVIDIA A40',
    short: 'A40',
    family: 'datacenter',
    vendor: 'nvidia',
    baseCost: 25000,
    vram: 48,
    watts: 300,
    speedTier: 7,
    minLevel: 7,
    unlock: own('l4'),
    realWorld: '$0.35/hr on Runpod.',
    flavor: 'Passively cooled. Needs datacenter airflow or a very brave box fan.',
  },
  {
    id: 'l40s',
    name: 'NVIDIA L40S',
    short: 'L40S',
    family: 'datacenter',
    vendor: 'nvidia',
    baseCost: 35000,
    vram: 48,
    watts: 350,
    speedTier: 7,
    minLevel: 7,
    unlock: own('a40'),
    realWorld: '$0.79/hr community, $1.09/hr secure on Runpod; g6e on AWS.',
    flavor: 'The card your cloud bill has been quietly trying to tell you about.',
  },
  {
    id: 'rtx-pro-6000',
    name: 'RTX PRO 6000 Blackwell',
    short: 'PRO 6000',
    family: 'workstation',
    vendor: 'nvidia',
    baseCost: 45000,
    vram: 96,
    watts: 600,
    speedTier: 7,
    minLevel: 7,
    unlock: own('rtx-6000-ada'),
    realWorld: '$1.69/hr community, $2.09/hr secure on Runpod.',
    flavor: '96 GB. Runs the video model natively, unquantized, out of spite.',
  },
  {
    id: 'a100-80',
    name: 'A100 80GB',
    short: 'A100',
    family: 'datacenter',
    vendor: 'nvidia',
    baseCost: 70000,
    vram: 80,
    watts: 400,
    speedTier: 8,
    minLevel: 8,
    unlock: own('l40s'),
    realWorld: '$1.19/hr PCIe on Runpod.',
    flavor: "80 GB of HBM2e. Still the benchmark every paper's README quotes.",
  },
  {
    id: 'mi300x',
    name: 'AMD MI300X',
    short: 'MI300X',
    family: 'datacenter',
    vendor: 'amd',
    baseCost: 110000,
    vram: 192,
    watts: 750,
    speedTier: 8,
    minLevel: 8,
    unlock: anyOf(own('radeon-pro-w7900'), own('a100-80')),
    realWorld: 'Azure ND MI300X v5.',
    flavor: '192 GB. Loads two video models at once and dares you to read the ROCm warning.',
  },
  {
    id: 'h100-80',
    name: 'H100 80GB SXM',
    short: 'H100',
    family: 'datacenter',
    vendor: 'nvidia',
    baseCost: 150000,
    vram: 80,
    watts: 700,
    speedTier: 9,
    minLevel: 9,
    unlock: own('a100-80'),
    realWorld: '$2.69/hr community, $3.49/hr secure on Runpod.',
    flavor: 'The Transformer Engine. Where FP8 stops being a compromise.',
  },
  {
    id: 'mi325x',
    name: 'AMD MI325X',
    short: 'MI325X',
    family: 'datacenter',
    vendor: 'amd',
    baseCost: 220000,
    vram: 256,
    watts: 1000,
    speedTier: 9,
    minLevel: 9,
    unlock: own('mi300x'),
    flavor: '256 GB per card. VRAM stops being a plot point.',
  },
  {
    id: 'h200',
    name: 'H200 141GB',
    short: 'H200',
    family: 'datacenter',
    vendor: 'nvidia',
    baseCost: 300000,
    vram: 141,
    watts: 700,
    speedTier: 9,
    minLevel: 9,
    unlock: own('h100-80'),
    realWorld: '$3.59/hr community, $4.59/hr secure on Runpod.',
    flavor: '141 GB, same Hopper. Half your OOM errors retire.',
  },
  {
    id: 'b200',
    name: 'B200',
    short: 'B200',
    family: 'datacenter',
    vendor: 'nvidia',
    baseCost: 500000,
    vram: 180,
    watts: 1000,
    speedTier: 10,
    minLevel: 10,
    unlock: own('h200'),
    realWorld: '$5.98/hr community, $6.79/hr secure on Runpod.',
    flavor: 'Blackwell at datacenter scale. The power draw rounds to a kilowatt.',
  },
  {
    id: 'b300',
    name: 'B300',
    short: 'B300',
    family: 'datacenter',
    vendor: 'nvidia',
    baseCost: 800000,
    vram: 288,
    watts: 1400,
    speedTier: 10,
    minLevel: 10,
    unlock: own('b200'),
    realWorld: '$6.94/hr community, $7.89/hr secure on Runpod.',
    flavor: "288 GB. The model loader finishes before you've read its tooltip.",
  },
  {
    id: 'aws-p4d',
    name: 'AWS p4d.24xlarge (8x A100)',
    short: 'p4d',
    family: 'cloud-node',
    vendor: 'aws',
    baseCost: 2000000,
    vram: 80,
    watts: 3200,
    speedTier: 9,
    minLevel: 10,
    unlock: own('a100-80'),
    realWorld: '~$32.77/hr on-demand.',
    flavor: 'Eight A100s. Your reserved-instance spreadsheet gains a tab.',
    cardsPerUnit: CLOUD_CARDS_PER_NODE,
  },
  {
    id: 'azure-nd-mi300x',
    name: 'Azure ND MI300X v5 (8x MI300X)',
    short: 'ND MI300X',
    family: 'cloud-node',
    vendor: 'azure',
    baseCost: 8000000,
    vram: 192,
    watts: 6000,
    speedTier: 9,
    minLevel: 10,
    unlock: own('mi300x'),
    flavor: 'Eight MI300X in Azure. 1.5 TB of HBM and one quota request pending.',
    cardsPerUnit: CLOUD_CARDS_PER_NODE,
  },
  {
    id: 'aws-p5',
    name: 'AWS p5.48xlarge (8x H100)',
    short: 'p5',
    family: 'cloud-node',
    vendor: 'aws',
    baseCost: 12000000,
    vram: 80,
    watts: 5600,
    speedTier: 10,
    minLevel: 11,
    unlock: own('h100-80'),
    realWorld: '~$98.32/hr on-demand.',
    flavor: 'Eight H100s and 3.2 Tb/s of EFA. Batch size stops being a question.',
    cardsPerUnit: CLOUD_CARDS_PER_NODE,
  },
  {
    id: 'aws-p5e',
    name: 'AWS p5e (8x H200)',
    short: 'p5e',
    family: 'cloud-node',
    vendor: 'aws',
    baseCost: 40000000,
    vram: 141,
    watts: 5600,
    speedTier: 10,
    minLevel: 11,
    unlock: own('h200'),
    flavor: 'Eight H200s. The instance name is shorter than its hourly rate.',
    cardsPerUnit: CLOUD_CARDS_PER_NODE,
  },
  {
    id: 'aws-p6',
    name: 'AWS p6-b200 (8x B200)',
    short: 'p6-b200',
    family: 'cloud-node',
    vendor: 'aws',
    baseCost: 120000000,
    vram: 180,
    watts: 8000,
    speedTier: 11,
    minLevel: 11,
    unlock: own('b200'),
    flavor: 'Eight B200s. Somebody in finance has set up a budget alert.',
    cardsPerUnit: CLOUD_CARDS_PER_NODE,
  },
  {
    id: 'runpod-8xb300',
    name: 'Runpod 8x B300 pod',
    short: '8x B300',
    family: 'cloud-node',
    vendor: 'runpod',
    baseCost: 400000000,
    vram: 288,
    watts: 11200,
    speedTier: 11,
    minLevel: 11,
    unlock: own('b300'),
    realWorld: '$7.89/hr per GPU, secure cloud.',
    flavor: 'A whole pod of B300s. The queue is now a formality.',
    cardsPerUnit: CLOUD_CARDS_PER_NODE,
  },
  {
    id: 'region-us-east',
    name: 'Comfy Cloud us-east',
    short: 'us-east',
    family: 'region',
    vendor: 'comfy',
    baseCost: 20000000000,
    vram: Infinity,
    watts: 250000,
    speedTier: 12,
    minLevel: 12,
    unlock: node(REGIONS_UNLOCK_NODE),
    max: 1,
    flavor: 'Your first Comfy Cloud region. Infinite VRAM, one status page.',
  },
  {
    id: 'region-eu-west',
    name: 'Comfy Cloud eu-west',
    short: 'eu-west',
    family: 'region',
    vendor: 'comfy',
    baseCost: 60000000000,
    vram: Infinity,
    watts: 250000,
    speedTier: 12,
    minLevel: 13,
    unlock: own('region-us-east'),
    max: 1,
    flavor: 'Second region. Same workflows, more consent banners.',
  },
  {
    id: 'region-ap-southeast',
    name: 'Comfy Cloud ap-southeast',
    short: 'ap-southeast',
    family: 'region',
    vendor: 'comfy',
    baseCost: 200000000000,
    vram: Infinity,
    watts: 250000,
    speedTier: 12,
    minLevel: 14,
    unlock: own('region-eu-west'),
    max: 1,
    flavor: 'Third region. The sun never sets on the queue.',
  },
  {
    id: 'orbital-dc',
    name: 'Orbital Datacenter',
    short: 'Orbital',
    family: 'region',
    vendor: 'comfy',
    baseCost: 3000000000000,
    vram: Infinity,
    watts: 0,
    speedTier: 12,
    minLevel: 16,
    unlock: node(ORBITAL_UNLOCK_NODE),
    max: 1,
    realWorld: 'Latency is bad, cooling is excellent.',
    flavor: 'A datacenter with a view. Every job now waits for a pass overhead.',
  },
  {
    id: 'dyson-swarm',
    name: 'Dyson Compute Swarm',
    short: 'Dyson',
    family: 'region',
    vendor: 'comfy',
    baseCost: 300000000000000,
    vram: Infinity,
    watts: 0,
    speedTier: 12,
    minLevel: 20,
    unlock: node(DYSON_UNLOCK_NODE),
    max: 1,
    flavor: 'Every photon the star emits, spent on one more seed.',
  },
]

const round3 = (x: number): number => Math.round(x * 1000) / 1000

/** Position of every tail unit among its family's tail units (overrides excluded). */
interface TailSlot {
  index: number
  count: number
}

function tailSlots(specs: readonly HardwareSpec[]): Map<string, TailSlot> {
  const groups = new Map<HardwareFamily, string[]>()
  specs.forEach((spec, rank) => {
    if (rank <= PAYBACK_PEAK_RANK || spec.id in PAYBACK_OVERRIDE_S) return
    const ids = groups.get(spec.family) ?? []
    ids.push(spec.id)
    groups.set(spec.family, ids)
  })
  const out = new Map<string, TailSlot>()
  for (const ids of groups.values()) ids.forEach((id, index) => out.set(id, { index, count: ids.length }))
  return out
}

/** Design payback before vendor multipliers: the climb formula, a tail band, or a trophy override. */
export function designPayback(spec: Pick<HardwareSpec, 'id' | 'family'>, rank: number, slot?: TailSlot): number {
  const override = PAYBACK_OVERRIDE_S[spec.id]
  if (override !== undefined) return override
  if (rank <= PAYBACK_PEAK_RANK) return paybackForRank(rank)
  if (!slot) throw new Error(`hardware: ${spec.id} sits in the tail without a family slot`)
  return tailPayback(spec.family, slot.index, slot.count)
}

/** Vendor multiplier on payback: consumer Radeons discounted, Apple taxed, everything else 1. */
export function vendorPaybackMult(spec: Pick<HardwareSpec, 'family'>): number {
  if (spec.family === 'amd-consumer') return AMD_PAYBACK_MULT
  if (spec.family === 'apple') return MPS_PAYBACK_MULT
  return 1
}

function build(spec: HardwareSpec, rank: number, slot: TailSlot | undefined): HardwareDef {
  const amd = spec.vendor === 'amd'
  const apple = spec.family === 'apple'
  const cpu = spec.family === 'cpu'
  // AMD silicon (consumer and MI-series) also appears inside the Azure MI300X node.
  const rocm = amd || spec.id === 'azure-nd-mi300x'
  const payback = designPayback(spec, rank, slot) * vendorPaybackMult(spec)
  const def: HardwareDef = {
    id: spec.id,
    name: spec.name,
    short: spec.short,
    family: spec.family,
    vendor: spec.vendor,
    baseCost: spec.baseCost,
    baseCps: round3(spec.baseCost / payback),
    growth: FAMILY_GROWTH[spec.family],
    vram: spec.vram,
    watts: spec.watts,
    speedTier: spec.speedTier,
    unlock: spec.unlock,
    flavor: spec.flavor,
    art: `hw-${spec.id}`,
  }
  if (cpu) def.cpuOnly = true
  if (apple) def.mps = true
  if (rocm) def.rocm = true
  if (spec.cardsPerUnit !== undefined) def.cardsPerUnit = spec.cardsPerUnit
  if (spec.realWorld !== undefined) def.realWorld = spec.realWorld
  if (spec.max !== undefined) def.max = spec.max
  if (spec.minLevel !== undefined && spec.minLevel > 1) def.minLevel = spec.minLevel
  return def
}

const TAIL_SLOTS = tailSlots(SPECS)

/** The full ladder, ascending by baseCost. Index = payback rank. */
export const HARDWARE: HardwareDef[] = SPECS.map((spec, rank) => build(spec, rank, TAIL_SLOTS.get(spec.id)))

/** Store tabs, in display order. */
export const HARDWARE_FAMILIES: { id: HardwareFamily; label: string; blurb: string }[] = [
  { id: 'cpu', label: 'CPU', blurb: 'Runs the small stuff. Slowly. With dignity.' },
  {
    id: 'apple',
    label: 'Apple',
    blurb: 'Unified memory over MPS. Images only, and it takes its time.',
  },
  { id: 'nvidia-consumer', label: 'NVIDIA', blurb: 'What every README assumes you have.' },
  {
    id: 'amd-consumer',
    label: 'AMD',
    blurb: 'More VRAM per credit, once ROCm is installed. Ask the wiki.',
  },
  {
    id: 'workstation',
    label: 'Workstation',
    blurb: '48 GB and up, no RGB. Blower fans and quiet competence.',
  },
  {
    id: 'datacenter',
    label: 'Datacenter',
    blurb: 'HBM, passive cooling, and a power bill with a service tier.',
  },
  {
    id: 'cloud-node',
    label: 'Cloud Nodes',
    blurb: "8x GPU boxes rented by the hour. Someone else's cooling.",
  },
  { id: 'region', label: 'Regions', blurb: 'Comfy Cloud regions. Infinite VRAM, zero drivers.' },
]
