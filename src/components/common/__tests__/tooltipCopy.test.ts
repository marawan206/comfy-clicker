/**
 * The tooltip copy builders are pure, so every string the game shows on hover can be pinned here:
 * the exact wording for a representative input, the house rules (no em-dash, nothing longer than
 * the popup can hold) and the promise that a locked surface always reads as locked.
 */
import { describe, expect, it } from 'vitest'
import { CATALOG } from '@/data'
import { PRECISIONS } from '@/data/precisions'
import type { HardwareDef, HashtagDef, UpgradeDef } from '@/game/types'
import {
  NAV_TILE_IDS,
  creditsTip,
  generateButtonTip,
  hardwareRowTip,
  hashtagChipTip,
  incomeTip,
  levelChipTip,
  modelChipTip,
  navTileTip,
  powerTip,
  precisionCellTip,
  saveStatusTip,
  signupsTip,
  streakTip,
  trendingCountdownTip,
  upgradeRowTip,
  type TooltipCopy,
} from '../tooltipCopy'

/** Built from the code point so this file can assert on the character it bans. */
const EM_DASH = String.fromCharCode(0x2014)

/** The popup is 280 px of 11 px text: about 45 characters a line, three lines is the comfortable max. */
const MAX_LINE = 140

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RTX_3060: HardwareDef = {
  id: 'rtx-3060',
  name: 'Used RTX 3060 12GB',
  short: '3060',
  family: 'nvidia-consumer',
  vendor: 'nvidia',
  baseCost: 350,
  baseCps: 3,
  growth: 1.12,
  vram: 12,
  watts: 170,
  speedTier: 3,
  realWorld: '$0.16/hr class on Runpod.',
  flavor: "The people's card. 12 GB, --lowvram in the launch args, dreams of Flux.",
  art: 'hw-rtx-3060',
}

const ROCM_SETUP: UpgradeDef = {
  id: 'rocm-setup',
  name: 'ROCm Setup',
  desc: 'Unlocks AMD cards in the Hardware tab.',
  cost: 250,
  category: 'hardware',
  effects: [],
  unlock: { type: 'always' },
  icon: 'wrench',
}

const WAN22: HashtagDef = { id: 'wan22', tag: 'wan22', keywords: ['wan', 'wan 2.2'] }
const VIDEOGEN: HashtagDef = { id: 'videogen', tag: 'videogen', keywords: ['video'], kind: 'video' }
const LORA: HashtagDef = { id: 'lora', tag: 'lora', keywords: ['lora', 'finetune', 'style'] }

const FLUX_DEV = {
  model: { name: 'FLUX.1 dev', kind: 'image' as const, flavor: '12B of rectified flow. The one everyone means by "Flux".' },
  setup: true,
  ready: true,
  setupFee: 1200,
  hardwareName: { native: 'RTX 4090', fp8: 'RTX 3060' },
  lockReasons: { native: null, fp8: null, q4: null },
}

const SORA_LOCKED = {
  model: { name: 'Sora 2', kind: 'video' as const, flavor: 'Costs like a short film. Occasionally is one.' },
  setup: false,
  ready: false,
  setupFee: 40_000,
  hardwareName: {},
  lockReasons: { native: 'Needs level 11 · you are level 4', fp8: null, q4: null },
}

/** Every builder and every branch of it, so the house rules below cover the whole surface. */
const SAMPLES: { name: string; copy: TooltipCopy }[] = [
  { name: 'generate', copy: generateButtonTip(1.2) },
  { name: 'generate:big', copy: generateButtonTip(48_200) },
  { name: 'credits', copy: creditsTip(2.8, 8) },
  { name: 'credits:empty', copy: creditsTip(0, 0) },
  { name: 'income', copy: incomeTip({ cps: 2.8, throttled: false, draw: 340, budget: 650 }) },
  { name: 'income:throttled', copy: incomeTip({ cps: 2.8, throttled: true, draw: 665, budget: 650 }) },
  {
    name: 'level',
    copy: levelChipTip({ level: 4, levelTitle: 'Guidance Scale', xp: 1655, ceiling: 2050, unlocks: ['RTX 5090', 'Radeon Pro W7900', 'Wan 2.2 5B'] }),
  },
  { name: 'level:max', copy: levelChipTip({ level: 30, levelTitle: 'Honorary Maintainer', xp: 12_400, ceiling: null, unlocks: [] }) },
  {
    name: 'level:many',
    copy: levelChipTip({
      level: 7,
      levelTitle: 'VRAM Negotiator',
      xp: 2900,
      ceiling: 3150,
      unlocks: ['RTX A6000', 'NVIDIA L4', 'RTX 6000 Ada', 'Qwen-Image', 'Qwen-Image-Edit'],
    }),
  },
  { name: 'signups', copy: signupsTip(12, 3) },
  { name: 'signups:spent', copy: signupsTip(12, 0) },
  { name: 'streak:claimable', copy: streakTip({ streak: 3, nextDay: 4, claimable: true, reward: 1680 }) },
  { name: 'streak:held', copy: streakTip({ streak: 4, nextDay: 5, claimable: false, reward: 2100 }) },
  { name: 'streak:none', copy: streakTip({ streak: 0, nextDay: 1, claimable: false, reward: 420 }) },
  { name: 'power', copy: powerTip({ draw: 640, budget: 650, throttled: false }) },
  { name: 'power:throttled', copy: powerTip({ draw: 665, budget: 650, throttled: true }) },
  { name: 'power:mega', copy: powerTip({ draw: 1_400_000, budget: 2_000_000, throttled: false }) },
  { name: 'save', copy: saveStatusTip({ autosave: true, status: 'Saved 12s ago' }) },
  { name: 'save:off', copy: saveStatusTip({ autosave: false, status: 'Saved 3m ago' }) },
  { name: 'save:failed', copy: saveStatusTip({ autosave: true, failed: true }) },
  { name: 'hardware', copy: hardwareRowTip(RTX_3060, { cost: 350, have: 120, cpsEach: 3.3, paybackSec: 107 }) },
  {
    name: 'hardware:locked',
    copy: hardwareRowTip(RTX_3060, { cost: 350, have: 120, cpsEach: 3.3, paybackSec: 107, lockReason: 'Locked · own an 8-core PC' }),
  },
  { name: 'upgrade', copy: upgradeRowTip(ROCM_SETUP, { cost: 250, currency: 'credits', have: 900 }, 'unlocks AMD') },
  { name: 'upgrade:rp', copy: upgradeRowTip(ROCM_SETUP, { cost: 3, currency: 'rp', have: 1 }, 'unlocks AMD') },
  { name: 'upgrade:cp', copy: upgradeRowTip(ROCM_SETUP, { cost: 2, currency: 'cp', have: 0 }) },
  { name: 'model', copy: modelChipTip(FLUX_DEV, { precision: 'fp8', cost: 240, have: 1000, genSec: 8 }) },
  { name: 'model:locked', copy: modelChipTip(SORA_LOCKED, { precision: 'native', cost: 0, have: 0, genSec: null }) },
  { name: 'precision', copy: precisionCellTip(PRECISIONS.fp8, 0.12, { unlocked: true, runnable: true }) },
  { name: 'precision:native', copy: precisionCellTip(PRECISIONS.native, 0.23, { unlocked: true, runnable: true }) },
  {
    name: 'precision:locked',
    copy: precisionCellTip(PRECISIONS.q4, -0.04, { unlocked: false, runnable: true, blocker: 'Unlock Q4 GGUF on the Graph', fee: 300, have: 80 }),
  },
  {
    name: 'precision:unrunnable',
    copy: precisionCellTip(PRECISIONS.fp8, 0.12, { unlocked: true, runnable: false, blocker: 'Needs 20 GB · your best card has 12 GB' }),
  },
  { name: 'hashtag:trending', copy: hashtagChipTip(WAN22, { trending: true, postKind: 'video' }) },
  { name: 'hashtag:cold', copy: hashtagChipTip(LORA, { trending: false, postKind: 'image' }) },
  { name: 'hashtag:type', copy: hashtagChipTip(VIDEOGEN, { trending: true, postKind: 'video' }) },
  { name: 'hashtag:type-cold', copy: hashtagChipTip(VIDEOGEN, { trending: false, postKind: 'video' }) },
  { name: 'hashtag:wrong-kind', copy: hashtagChipTip(VIDEOGEN, { trending: true, postKind: 'image' }) },
  { name: 'countdown', copy: trendingCountdownTip(252_000, 10) },
  { name: 'countdown:one', copy: trendingCountdownTip(4000, 1) },
  ...NAV_TILE_IDS.map((id) => ({ name: `nav:${id}`, copy: navTileTip(id) })),
]

/** Every string a tooltip renders, split on the newlines the popup turns into line breaks. */
function copyLines(copy: TooltipCopy): string[] {
  const out: string[] = [copy.title]
  for (const field of [copy.description, copy.meta, copy.lock, copy.shortcut]) {
    if (typeof field === 'string' && field.length > 0) out.push(...field.split('\n'))
  }
  return out
}

// ---------------------------------------------------------------------------
// House rules
// ---------------------------------------------------------------------------

describe('tooltip copy house rules', () => {
  it('covers all fifteen surfaces', () => {
    const families = new Set(SAMPLES.map((s) => s.name.split(':')[0]))
    expect(families).toEqual(
      new Set(['generate', 'credits', 'income', 'level', 'signups', 'streak', 'power', 'save', 'hardware', 'upgrade', 'model', 'precision', 'hashtag', 'countdown', 'nav']),
    )
    expect(families.size).toBe(15)
  })

  it('never emits an em-dash', () => {
    for (const { name, copy } of SAMPLES) {
      for (const line of copyLines(copy)) expect(`${name}: ${line}`).not.toContain(EM_DASH)
    }
  })

  it('keeps every line inside the popup', () => {
    for (const { name, copy } of SAMPLES) {
      for (const line of copyLines(copy)) expect(line.length, `${name}: ${line}`).toBeLessThanOrEqual(MAX_LINE)
    }
  })

  it('always gives a title', () => {
    for (const { name, copy } of SAMPLES) expect(copy.title, name).toBeTruthy()
  })

  it('marks every locked variant with the locked tone', () => {
    const locked = SAMPLES.filter((s) => s.name.includes('locked') || s.name.includes('throttled') || s.name.includes('wrong-kind') || s.name.includes('unrunnable') || s.name.includes('failed'))
    expect(locked.length).toBeGreaterThan(5)
    for (const { name, copy } of locked) expect(copy.tone, name).toBe('locked')
  })

  it('only sets a lock line on a locked or throttled tooltip', () => {
    for (const { name, copy } of SAMPLES) {
      if (copy.lock) expect(copy.tone, name).toBe('locked')
    }
  })
})

// ---------------------------------------------------------------------------
// Exact copy
// ---------------------------------------------------------------------------

describe('tooltip copy strings', () => {
  it('generate button', () => {
    expect(generateButtonTip(1.2)).toEqual({
      title: 'Generate',
      description: 'The logo and the pill are the same button. One click, one credit, 150 ms off the job, and a streak pays more: ×2 at 50 clicks, ×3 at 100.',
      meta: '+1.2 per click',
      shortcut: 'Space',
      tone: 'electric',
    })
  })

  it('credits counter', () => {
    const tip = creditsTip(2.8, 8)
    expect(tip.title).toBe('Credits')
    expect(tip.description).toBe('The only currency. Hardware, models, posts and the Graph all cost it.')
    expect(tip.meta).toBe('+2.8/s from 8 units')
    expect(creditsTip(1, 1).meta).toBe('+1.0/s from 1 unit')
  })

  it('income, running and throttled', () => {
    expect(incomeTip({ cps: 2.8, throttled: false, draw: 340, budget: 650 })).toEqual({
      title: 'Income',
      description: '2.8 credits per second from the rack.',
      tone: 'credits',
    })
    const throttled = incomeTip({ cps: 2.8, throttled: true, draw: 665, budget: 650 })
    expect(throttled.title).toBe('Breaker tripped')
    expect(throttled.description).toBe(
      'Draw 665 is over the 650 budget. The rack is off and earns nothing until it fits. Clicks still pay.',
    )
  })

  it('level chip', () => {
    // `unlocks` arrives with the hardware names first, then the models; the meta keeps that order.
    const tip = levelChipTip({ level: 4, levelTitle: 'Guidance Scale', xp: 1655, ceiling: 2050, unlocks: ['RTX 5090', 'Radeon Pro W7900', 'Wan 2.2 5B'] })
    expect(tip.title).toBe('Level 4 · Guidance Scale')
    expect(tip.description).toBe('1,655 of 2,050 XP. XP comes from posting, contracts, the Graph, achievements and every new card.')
    expect(tip.meta).toBe('Level 5 unlocks RTX 5090, Radeon Pro W7900, Wan 2.2 5B')
    const max = levelChipTip({ level: 30, levelTitle: 'Honorary Maintainer', xp: 12_400, ceiling: null, unlocks: [] })
    expect(max.description).toBe('12,400 XP. Top of the table. XP comes from posting, contracts, the Graph, achievements and every new card.')
    expect(max.meta).toBeUndefined()
    const many = levelChipTip({
      level: 7,
      levelTitle: 'VRAM Negotiator',
      xp: 2900,
      ceiling: 3150,
      unlocks: ['RTX A6000', 'NVIDIA L4', 'RTX 6000 Ada', 'Qwen-Image', 'Qwen-Image-Edit'],
    })
    expect(many.meta).toBe('Level 8 unlocks RTX A6000, NVIDIA L4, RTX 6000 Ada and 2 more')
  })

  it('signups chip', () => {
    const tip = signupsTip(12, 3)
    expect(tip.title).toBe('Comfy Cloud signups')
    expect(tip.description).toBe('Each signup is a Research Point: +1% income forever. Spend them on the Graph.')
    expect(tip.meta).toBe('3 RP unspent')
  })

  it('streak chip', () => {
    expect(streakTip({ streak: 3, nextDay: 4, claimable: true, reward: 1680 }).description).toBe(
      'Day 4 is waiting: 1,680 credits, ten minutes of income times the day.',
    )
    expect(streakTip({ streak: 4, nextDay: 5, claimable: false, reward: 2100 }).description).toBe(
      'Day 4. Come back tomorrow (UTC) to keep it. Day 3 adds RP, day 7 adds CP.',
    )
    expect(streakTip({ streak: 0, nextDay: 1, claimable: false, reward: 420 }).description).toBe(
      'No streak yet. Come back tomorrow (UTC) to keep it. Day 3 adds RP, day 7 adds CP.',
    )
  })

  it('power chip', () => {
    expect(powerTip({ draw: 640, budget: 650, throttled: false }).description).toBe(
      '640 of 650 W. Past the breaker every rig stops and passive income is zero.',
    )
    expect(powerTip({ draw: 1_400_000, budget: 2_000_000, throttled: false }).description).toBe(
      '1.4 MW of 2.0 MW. Past the breaker every rig stops and passive income is zero.',
    )
  })

  it('save status', () => {
    expect(saveStatusTip({ autosave: true }).description).toBe('Every 10 s, 1.5 s after any purchase, and when the tab hides. S saves now.')
    expect(saveStatusTip({ autosave: false }).title).toBe('Autosave off')
    expect(saveStatusTip({ autosave: true, failed: true }).title).toBe('Not saving')
  })

  it('hardware row', () => {
    const tip = hardwareRowTip(RTX_3060, { cost: 350, have: 120, cpsEach: 3.3, paybackSec: 107 })
    expect(tip.title).toBe('Used RTX 3060 12GB')
    expect(tip.description).toBe("$0.16/hr class on Runpod.\nThe people's card. 12 GB, --lowvram in the launch args, dreams of Flux.")
    expect(tip.cost).toEqual({ credits: 350, have: 120 })
    expect(tip.meta).toBe('+3.3/s each · payback 1:47 · 170 W')
    expect(tip.side).toBe('left')
    expect(tip.lock).toBeNull()
  })

  it('hardware row, locked', () => {
    const tip = hardwareRowTip(RTX_3060, { cost: 350, have: 120, cpsEach: 3.3, paybackSec: 107, lockReason: 'Locked · own an 8-core PC' })
    expect(tip.tone).toBe('locked')
    expect(tip.lock).toBe('Locked · own an 8-core PC')
    expect(tip.meta).toBeUndefined()
  })

  it('upgrade row, per currency', () => {
    expect(upgradeRowTip(ROCM_SETUP, { cost: 250, currency: 'credits', have: 900 }, 'unlocks AMD')).toEqual({
      title: 'ROCm Setup',
      description: 'Unlocks AMD cards in the Hardware tab.',
      cost: { credits: 250, have: 900 },
      meta: 'unlocks AMD',
      side: 'left',
    })
    expect(upgradeRowTip(ROCM_SETUP, { cost: 3, currency: 'rp', have: 1 }).cost).toEqual({ rp: 3 })
    expect(upgradeRowTip(ROCM_SETUP, { cost: 2, currency: 'cp', have: 0 }).cost).toEqual({ cp: 2 })
  })

  it('model chip, ready and locked', () => {
    const ready = modelChipTip(FLUX_DEV, { precision: 'fp8', cost: 240, have: 1000, genSec: 8 })
    expect(ready.title).toBe('FLUX.1 dev · Image')
    expect(ready.meta).toBe('runs FP8 on RTX 3060 · about 8 s')
    expect(ready.cost).toEqual({ credits: 240, have: 1000 })

    const locked = modelChipTip(SORA_LOCKED, { precision: 'native', cost: 0, have: 0, genSec: null })
    expect(locked.title).toBe('Sora 2 · Video')
    expect(locked.tone).toBe('locked')
    expect(locked.lock).toBe('Not set up · 40.0K credits to set up · Needs level 11 · you are level 4')
  })

  it('precision cell', () => {
    const fp8 = precisionCellTip(PRECISIONS.fp8, 0.12, { unlocked: true, runnable: true })
    expect(fp8.title).toBe('FP8')
    expect(fp8.description).toBe('cost x0.85 · time x0.9 · quality 92%')
    expect(fp8.meta).toBe('about +12% expected')

    const q4 = precisionCellTip(PRECISIONS.q4, -0.04, { unlocked: false, runnable: true, blocker: 'Unlock Q4 GGUF on the Graph', fee: 300, have: 80 })
    expect(q4.description).toBe('cost x0.7 · time x1.15 · quality 80%')
    expect(q4.meta).toBe('about -4% expected')
    expect(q4.tone).toBe('locked')
    expect(q4.lock).toBe('Unlock Q4 GGUF on the Graph')
    expect(q4.cost).toEqual({ credits: 300, have: 80 })
  })

  it('hashtag chip', () => {
    const hot = hashtagChipTip(WAN22, { trending: true, postKind: 'video' })
    expect(hot.title).toBe('#wan22 · trending')
    expect(hot.description).toBe('Doubles the likes on this post. A second trending tag adds +40%. A third voids the boost.')

    const type = hashtagChipTip(VIDEOGEN, { trending: true, postKind: 'video' })
    expect(type.title).toBe('#videogen · video')
    expect(type.description).toBe('+20% on video posts, no slot used.')

    const wrong = hashtagChipTip(VIDEOGEN, { trending: true, postKind: 'image' })
    expect(wrong.title).toBe('#videogen · wrong kind')
    expect(wrong.description).toBe('#videogen is for video posts. On an image post it gets ratioed.')
    expect(wrong.tone).toBe('locked')

    expect(hashtagChipTip(LORA, { trending: false, postKind: 'image' }).description).toBe(
      'Not trending this week. Picked up from: lora, finetune, style.',
    )
  })

  it('trending countdown', () => {
    const tip = trendingCountdownTip(252_000, 10)
    expect(tip.title).toBe('Next week in 4:12')
    expect(tip.description).toBe(
      'AI weeks are ten minutes. Tags come from the real ComfyUI wire when it answers, the calendar when it does not.',
    )
    expect(trendingCountdownTip(4000, 1).description).toContain('AI weeks are one minute.')
  })

  it('nav tiles', () => {
    expect(navTileTip('map')).toEqual({
      title: 'The Graph',
      description: 'Spend credits, RP and CP on the skill tree. 132 nodes, drawn as a workflow.',
      tone: 'electric',
      side: 'bottom',
    })
    expect(navTileTip('hub').description).toBe("Run other players' recipes for +15% likes. Publish yours: 5% of every run is yours.")
    expect(navTileTip('leaderboard').description).toBe('Top 100 cloud saves by lifetime credits. Sign in to appear.')
    expect(navTileTip('lounge').description).toBe('Bet any credits on the wheel or the coin. No cooldown, one free spin a day.')
    expect(navTileTip('stats').description).toBe('Lifetime numbers and the achievement grid. Hidden ones show as ???.')
    expect(navTileTip('settings').description).toBe('Save, export, sound, motion, hard reset.')
    expect(navTileTip('projector').description).toBe('Bigger type for the back row.')
    expect(navTileTip('help').shortcut).toBe('?')
    expect(NAV_TILE_IDS).toHaveLength(8)
  })

  it('does not mutate the shared nav copy', () => {
    const first = navTileTip('map')
    first.title = 'changed'
    expect(navTileTip('map').title).toBe('The Graph')
  })
})

// ---------------------------------------------------------------------------
// The real catalog, not just the fixtures
// ---------------------------------------------------------------------------

describe('tooltip copy over the shipped catalog', () => {
  it('keeps every hardware row inside the rules', () => {
    for (const def of CATALOG.hardware) {
      const copy = hardwareRowTip(def, { cost: def.baseCost, have: 0, cpsEach: def.baseCps, paybackSec: 120 })
      for (const line of copyLines(copy)) {
        expect(line, def.id).not.toContain(EM_DASH)
        expect(line.length, `${def.id}: ${line}`).toBeLessThanOrEqual(MAX_LINE)
      }
    }
  })

  it('keeps every upgrade row inside the rules', () => {
    for (const def of CATALOG.upgrades) {
      const copy = upgradeRowTip(def, { cost: def.cost, currency: def.currency ?? 'credits', have: 0 })
      for (const line of copyLines(copy)) {
        expect(line, def.id).not.toContain(EM_DASH)
        expect(line.length, `${def.id}: ${line}`).toBeLessThanOrEqual(MAX_LINE)
      }
    }
  })

  it('keeps every hashtag chip inside the rules', () => {
    for (const def of CATALOG.hashtags) {
      for (const trending of [true, false]) {
        for (const postKind of ['image', 'video', '3d', 'audio'] as const) {
          const copy = hashtagChipTip(def, { trending, postKind })
          for (const line of copyLines(copy)) {
            expect(line, def.id).not.toContain(EM_DASH)
            expect(line.length, `${def.id}: ${line}`).toBeLessThanOrEqual(MAX_LINE)
          }
          if (def.kind !== undefined && def.kind !== postKind) expect(copy.tone, def.id).toBe('locked')
        }
      }
    }
  })

  it('keeps every model chip inside the rules', () => {
    for (const model of CATALOG.models) {
      const copy = modelChipTip(
        { model, setup: true, ready: true, setupFee: 500, hardwareName: { native: 'RTX 4090' }, lockReasons: { native: null, fp8: null, q4: null } },
        { precision: 'native', cost: model.baseCost, have: 0, genSec: model.baseTime },
      )
      for (const line of copyLines(copy)) {
        expect(line, model.id).not.toContain(EM_DASH)
        expect(line.length, `${model.id}: ${line}`).toBeLessThanOrEqual(MAX_LINE)
      }
    }
  })
})
