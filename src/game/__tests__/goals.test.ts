import { describe, expect, it } from 'vitest'

import { CATALOG, createCatalog } from '@/data'
import type { Catalog } from '@/data'
import { computeDerived, createEmptyDerived } from '@/game/derived'
import { unitCost } from '@/game/economy'
import {
  condProgress,
  goalKey,
  isGoalDone,
  nextAchievements,
  nextGoal,
  saveTarget,
  type Goal,
} from '@/game/goals'
import { createInitialState } from '@/game/state'
import { describeUnlock, isUnlocked } from '@/game/unlock'
import type {
  AchievementDef,
  ActiveContract,
  ContractDef,
  Derived,
  GameState,
  HardwareDef,
  HardwareFamily,
  MapNodeDef,
  ModelDef,
  UnlockCond,
} from '@/game/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function hardware(partial: Partial<HardwareDef> & { id: string }): HardwareDef {
  return {
    name: partial.id,
    short: partial.id,
    family: 'nvidia-consumer',
    vendor: 'nvidia',
    baseCost: 100,
    baseCps: 1,
    growth: 1,
    vram: 8,
    watts: 100,
    speedTier: 3,
    flavor: '',
    art: '',
    ...partial,
  }
}

function model(partial: Partial<ModelDef> & { id: string }): ModelDef {
  return {
    name: partial.id,
    family: 'test',
    kind: 'image',
    vendorIcon: '',
    vram: 8,
    baseCost: 100,
    costSecs: 1,
    payoutRatio: 1,
    baseLikes: 10,
    baseTime: 5,
    flavor: '',
    art: '',
    thumbTags: [],
    ...partial,
  }
}

function achievement(partial: Partial<AchievementDef> & { id: string; cond: UnlockCond }): AchievementDef {
  return { name: partial.id, desc: '', icon: 'trophy', ...partial }
}

function mapNode(partial: Partial<MapNodeDef> & { id: string }): MapNodeDef {
  return {
    title: partial.id,
    desc: '',
    branch: 'core',
    cost: 100,
    currency: 'credits',
    parents: [],
    effects: [],
    position: { x: 0, y: 0 },
    icon: 'circle',
    ...partial,
  }
}

function contract(partial: Partial<ContractDef> & { id: string }): ContractDef {
  return {
    title: partial.id,
    desc: '',
    client: 'Client',
    goal: { type: 'clicks', value: 10 },
    rewardSecs: 60,
    minTier: 0,
    weight: 1,
    ...partial,
  }
}

function active(partial: Partial<ActiveContract> & { defId: string }): ActiveContract {
  return {
    acceptedAt: 0,
    progress: 0,
    target: 10,
    rewardCredits: 300,
    done: false,
    claimed: false,
    ...partial,
  }
}

function fresh(mutate?: (s: GameState) => void): GameState {
  const s = createInitialState(0, 'guest')
  mutate?.(s)
  return s
}

function derivedWith(overrides: Partial<Derived> = {}): Derived {
  return { ...createEmptyDerived(), ...overrides }
}

const base = derivedWith()

// ---------------------------------------------------------------------------
// condProgress
// ---------------------------------------------------------------------------

describe('condProgress', () => {
  const empty = createCatalog()

  it('divides a stat by its threshold and labels it', () => {
    const s = fresh((st) => {
      st.totalClicks = 250
    })
    const p = condProgress({ type: 'stat', key: 'clicks', value: 1000 }, s, base, empty)
    expect(p).toEqual({ current: 250, target: 1000, fraction: 0.25, label: '250 / 1,000 clicks' })
  })

  it('clamps an overshot stat to 1', () => {
    const s = fresh((st) => {
      st.lifetimeLikes = 40_000
    })
    expect(condProgress({ type: 'stat', key: 'likes', value: 10_000 }, s, base, empty).fraction).toBe(1)
  })

  it('puts the unit first for the level stat', () => {
    const s = fresh((st) => {
      st.stats.levelSeen = 2
    })
    expect(condProgress({ type: 'stat', key: 'level', value: 5 }, s, base, empty).label).toBe('level 2 / 5')
  })

  it('reads cps from derived', () => {
    const p = condProgress({ type: 'cps', value: 200 }, fresh(), derivedWith({ cps: 50 }), empty)
    expect(p.fraction).toBe(0.25)
    expect(p.label).toBe('50 / 200 credits/s')
  })

  it('counts credits banked toward the next unit for ownHardware', () => {
    const card = hardware({ id: 'card', name: 'Test Card', baseCost: 100, growth: 1 })
    const catalog = createCatalog({ hardware: [card] })
    const s = fresh((st) => {
      st.hardware = { card: 1 }
      st.credits = 50
    })
    const p = condProgress({ type: 'ownHardware', id: 'card', count: 3 }, s, base, catalog)
    expect(p).toEqual({ current: 1.5, target: 3, fraction: 0.5, label: '1 / 3 Test Card' })
  })

  it('never banks more than one unit', () => {
    const card = hardware({ id: 'card', baseCost: 100, growth: 1 })
    const catalog = createCatalog({ hardware: [card] })
    const s = fresh((st) => {
      st.hardware = { card: 1 }
      st.credits = 900
    })
    const p = condProgress({ type: 'ownHardware', id: 'card', count: 3 }, s, base, catalog)
    expect(p.current).toBe(2)
    expect(p.fraction).toBeCloseTo(2 / 3, 10)
  })

  it('banks against the cheapest unlocked unit for ownFamily', () => {
    const cheap = hardware({ id: 'cheap', baseCost: 200, growth: 1 })
    const dear = hardware({ id: 'dear', baseCost: 5000, growth: 1 })
    const locked = hardware({ id: 'locked', baseCost: 10, growth: 1, unlock: { type: 'flag', key: 'nope' } })
    const catalog = createCatalog({ hardware: [dear, cheap, locked] })
    const s = fresh((st) => {
      st.hardware = {}
      st.credits = 100
    })
    const p = condProgress({ type: 'ownFamily', family: 'nvidia-consumer', count: 2 }, s, base, catalog)
    expect(p).toEqual({ current: 0.5, target: 2, fraction: 0.25, label: '0 / 2 NVIDIA units' })
  })

  it('is binary for ownModel, precision, mapNode, upgrade and flag, with describeUnlock labels', () => {
    const catalog = createCatalog({
      models: [model({ id: 'sdxl', name: 'SDXL' })],
      mapNodes: [mapNode({ id: 'quant-fp8', title: 'FP8 Quantization' })],
    })
    const conds: UnlockCond[] = [
      { type: 'ownModel', id: 'sdxl' },
      { type: 'precision', modelId: 'sdxl', precision: 'fp8' },
      { type: 'mapNode', id: 'quant-fp8' },
      { type: 'upgrade', id: 'rocm-setup' },
      { type: 'flag', key: 'konami' },
    ]
    const s = fresh()
    for (const cond of conds) {
      const p = condProgress(cond, s, base, catalog)
      expect(p).toEqual({ current: 0, target: 1, fraction: 0, label: describeUnlock(cond, catalog) })
    }
  })

  it('reports 1 for a met binary condition', () => {
    const catalog = createCatalog({ mapNodes: [mapNode({ id: 'quant-fp8' })] })
    const s = fresh((st) => {
      st.mapNodes = ['quant-fp8']
    })
    expect(condProgress({ type: 'mapNode', id: 'quant-fp8' }, s, base, catalog).fraction).toBe(1)
  })

  it('takes the lowest child for all and the highest for any', () => {
    const s = fresh((st) => {
      st.totalClicks = 50
      st.stats.posts = 8
    })
    const near: UnlockCond = { type: 'stat', key: 'clicks', value: 100 } // 0.5
    const far: UnlockCond = { type: 'stat', key: 'posts', value: 80 } // 0.1
    expect(condProgress({ type: 'all', conds: [near, far] }, s, base, empty).fraction).toBeCloseTo(0.1, 10)
    expect(condProgress({ type: 'any', conds: [far, near] }, s, base, empty).fraction).toBe(0.5)
    expect(condProgress({ type: 'all', conds: [near, far] }, s, base, empty).label).toBe('8 / 80 posts')
  })

  it('treats no condition and `always` as done', () => {
    expect(condProgress(undefined, fresh(), base, empty).fraction).toBe(1)
    expect(condProgress({ type: 'always' }, fresh(), base, empty).fraction).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// nextAchievements
// ---------------------------------------------------------------------------

describe('nextAchievements', () => {
  const catalog = createCatalog({
    achievements: [
      achievement({ id: 'half', name: 'Half', cond: { type: 'stat', key: 'clicks', value: 100 } }),
      achievement({ id: 'secret', hidden: true, cond: { type: 'stat', key: 'clicks', value: 55 } }),
      achievement({ id: 'earned', cond: { type: 'stat', key: 'clicks', value: 10 } }),
      achievement({ id: 'complete', cond: { type: 'stat', key: 'clicks', value: 20 } }),
      achievement({ id: 'near', name: 'Near', cond: { type: 'stat', key: 'clicks', value: 60 } }),
      achievement({ id: 'binary', cond: { type: 'flag', key: 'konami' } }),
      achievement({ id: 'zero', cond: { type: 'stat', key: 'posts', value: 1000 } }),
    ],
  })
  const s = fresh((st) => {
    st.totalClicks = 50
    st.achievements = ['earned']
  })

  it('excludes hidden, earned and complete entries', () => {
    const ids = nextAchievements(s, base, catalog, 10).map((a) => a.id)
    expect(ids).not.toContain('secret')
    expect(ids).not.toContain('earned')
    expect(ids).not.toContain('complete')
  })

  it('ranks by fraction descending and sinks binary conditions', () => {
    expect(nextAchievements(s, base, catalog, 10).map((a) => a.id)).toEqual(['near', 'half', 'zero', 'binary'])
  })

  it('carries the name, the numbers and the label', () => {
    const [first] = nextAchievements(s, base, catalog, 1)
    expect(first).toEqual({
      id: 'near',
      name: 'Near',
      desc: '',
      icon: 'trophy',
      current: 50,
      target: 60,
      fraction: 50 / 60,
      label: '50 / 60 clicks',
    })
  })

  it('defaults to three', () => {
    expect(nextAchievements(s, base, catalog)).toHaveLength(3)
  })

  it('breaks a fraction tie on the smaller target', () => {
    const tied = createCatalog({
      achievements: [
        achievement({ id: 'big', cond: { type: 'stat', key: 'clicks', value: 100 } }),
        achievement({ id: 'small', cond: { type: 'stat', key: 'posts', value: 20 } }),
      ],
    })
    const state = fresh((st) => {
      st.totalClicks = 50
      st.stats.posts = 10
    })
    expect(nextAchievements(state, base, tied, 2).map((a) => a.id)).toEqual(['small', 'big'])
  })

  it('keeps catalog order when fraction and target tie', () => {
    const tied = createCatalog({
      achievements: [
        achievement({ id: 'first', cond: { type: 'stat', key: 'clicks', value: 100 } }),
        achievement({ id: 'second', cond: { type: 'stat', key: 'clicks', value: 100 } }),
      ],
    })
    const state = fresh((st) => {
      st.totalClicks = 50
    })
    expect(nextAchievements(state, base, tied, 2).map((a) => a.id)).toEqual(['first', 'second'])
  })

  it('reports the blocking child of an `all` condition', () => {
    const compound = createCatalog({
      achievements: [
        achievement({
          id: 'both',
          cond: {
            type: 'all',
            conds: [
              { type: 'stat', key: 'clicks', value: 100 },
              { type: 'stat', key: 'posts', value: 80 },
            ],
          },
        }),
      ],
    })
    const state = fresh((st) => {
      st.totalClicks = 50
      st.stats.posts = 8
    })
    expect(nextAchievements(state, base, compound, 1)[0]?.label).toBe('8 / 80 posts')
  })

  it('runs over the shipped catalog without returning a hidden or earned entry', () => {
    const state = fresh((st) => {
      st.totalClicks = 400
      st.lifetimeCredits = 12_000
      st.achievements = ['first-click']
    })
    const list = nextAchievements(state, base, CATALOG, 6)
    expect(list).toHaveLength(6)
    for (const entry of list) {
      const def = CATALOG.achievements.find((a) => a.id === entry.id)
      expect(def?.hidden).not.toBe(true)
      expect(state.achievements).not.toContain(entry.id)
      expect(entry.fraction).toBeLessThan(1)
    }
    // Sorted, with no measurable entry below a binary one.
    for (let i = 1; i < list.length; i++) {
      expect((list[i] as { fraction: number }).fraction).toBeLessThanOrEqual((list[i - 1] as { fraction: number }).fraction)
    }
  })
})

// ---------------------------------------------------------------------------
// nextGoal
// ---------------------------------------------------------------------------

describe('nextGoal', () => {
  const card = hardware({ id: 'card', name: 'Test Card', baseCost: 1000, growth: 1, vram: 8 })
  const heavy = model({ id: 'heavy', name: 'Heavy', vram: 8, baseCost: 10_000 })
  const catalog = createCatalog({
    hardware: [card],
    models: [heavy],
    contracts: [contract({ id: 'wedding', title: 'Wedding Slideshow' })],
    mapNodes: [mapNode({ id: 'root', title: 'Comfy Manager', cost: 500 })],
  })

  function lived(mutate?: (s: GameState) => void): GameState {
    return fresh((st) => {
      st.hardware = {}
      st.models = {}
      st.credits = 50
      mutate?.(st)
    })
  }

  it('claims a done contract before anything else', () => {
    const s = lived((st) => {
      st.contracts.active = [
        active({ defId: 'wedding', done: false }),
        active({ defId: 'wedding', done: true, rewardCredits: 300 }),
      ]
    })
    expect(nextGoal(s, base, catalog)).toEqual({ kind: 'claim', index: 1, title: 'Wedding Slideshow', reward: 300 })
  })

  it('ignores a contract that is already claimed', () => {
    const s = lived((st) => {
      st.contracts.active = [active({ defId: 'wedding', done: true, claimed: true })]
    })
    expect(nextGoal(s, base, catalog)?.kind).not.toBe('claim')
  })

  it('sets up an affordable model next, free ones first', () => {
    const paid = model({ id: 'paid', name: 'Paid', vram: 8, baseCost: 40 })
    const free = model({ id: 'free', name: 'Free', vram: 4, baseCost: 900 })
    const c = createCatalog({ hardware: [card], models: [paid, free] })
    const s = lived((st) => {
      st.credits = 100
    })
    // bestVram 6: `paid` costs its base cost to offload, `free` fits and is free.
    expect(nextGoal(s, derivedWith({ bestVram: 6 }), c)).toEqual({
      kind: 'setup',
      modelId: 'free',
      name: 'Free',
      fee: 0,
    })
  })

  it('skips a model above the player level', () => {
    const gated = model({ id: 'gated', vram: 4, minLevel: 5 })
    const c = createCatalog({ hardware: [card], models: [gated] })
    expect(nextGoal(lived(), base, c)?.kind).toBe('buy')
  })

  it('falls through to the save target when no setup is affordable', () => {
    const s = lived()
    expect(nextGoal(s, base, catalog)).toEqual({
      kind: 'buy',
      hardwareId: 'card',
      name: 'Test Card',
      family: 'nvidia-consumer',
      cost: 1000,
      pct: 5,
      etaSec: Infinity,
      unlocksModel: 'Heavy',
    })
  })

  it('carries a whole-second eta and no model line when nothing new fits', () => {
    const c = createCatalog({ hardware: [card] })
    const goal = nextGoal(lived(), derivedWith({ cps: 4 }), c)
    expect(goal).toMatchObject({ kind: 'buy', etaSec: Math.ceil(950 / 4), unlocksModel: null })
  })

  it('takes the cheapest affordable available node when nothing is left to buy', () => {
    const c = createCatalog({
      mapNodes: [
        mapNode({ id: 'cheap-locked', cost: 10, parents: ['root'] }),
        mapNode({ id: 'rp-node', cost: 1, currency: 'rp' }),
        mapNode({ id: 'root', title: 'Comfy Manager', cost: 500 }),
        mapNode({ id: 'dear', cost: 900 }),
      ],
    })
    const s = lived((st) => {
      st.credits = 1000
    })
    expect(nextGoal(s, base, c)).toEqual({
      kind: 'node',
      nodeId: 'root',
      title: 'Comfy Manager',
      cost: 500,
      currency: 'credits',
    })
  })

  it('falls back to the level bar', () => {
    expect(nextGoal(fresh(), base, createCatalog())).toEqual({ kind: 'level', level: 2, pct: 0, xpToGo: 500 })
  })

  it('returns a goal for a fresh player on the shipped catalog', () => {
    const s = createInitialState(0, 'guest')
    const goal = nextGoal(s, computeDerived(s, CATALOG), CATALOG)
    expect(goal).not.toBeNull()
    expect(['setup', 'buy', 'node', 'level']).toContain(goal?.kind)
  })
})

// ---------------------------------------------------------------------------
// goalKey and isGoalDone
// ---------------------------------------------------------------------------

describe('goalKey', () => {
  const goals: Array<[Goal, string]> = [
    [{ kind: 'claim', index: 1, title: 'Wedding Slideshow', reward: 300 }, 'claim:1:Wedding Slideshow'],
    [{ kind: 'setup', modelId: 'sdxl', name: 'SDXL', fee: 0 }, 'setup:sdxl'],
    [
      {
        kind: 'buy',
        hardwareId: 'rtx-4090',
        name: 'RTX 4090',
        family: 'nvidia-consumer',
        cost: 100,
        pct: 40,
        etaSec: 12,
        unlocksModel: null,
      },
      'buy:rtx-4090',
    ],
    [{ kind: 'node', nodeId: 'quant-fp8', title: 'FP8', cost: 1500, currency: 'credits' }, 'node:quant-fp8'],
    [{ kind: 'level', level: 5, pct: 80, xpToGo: 42 }, 'level:5'],
  ]

  it('is stable and distinct per goal', () => {
    for (const [goal, key] of goals) expect(goalKey(goal)).toBe(key)
    expect(new Set(goals.map(([g]) => goalKey(g))).size).toBe(goals.length)
  })

  it('does not encode the percent, so the bar can move without a new key', () => {
    const a: Goal = { kind: 'buy', hardwareId: 'x', name: 'X', family: 'cpu', cost: 10, pct: 1, etaSec: 9, unlocksModel: null }
    const b: Goal = { ...a, pct: 99, etaSec: 1 }
    expect(goalKey(a)).toBe(goalKey(b))
  })
})

describe('isGoalDone', () => {
  it('claim: done when the slot is empty, claimed or no longer done', () => {
    const goal: Goal = { kind: 'claim', index: 0, title: 'Wedding Slideshow', reward: 300 }
    expect(isGoalDone(goal, fresh())).toBe(true)
    expect(isGoalDone(goal, fresh((s) => {
      s.contracts.active = [active({ defId: 'wedding', done: true })]
    }))).toBe(false)
    expect(isGoalDone(goal, fresh((s) => {
      s.contracts.active = [active({ defId: 'wedding', done: true, claimed: true })]
    }))).toBe(true)
  })

  it('setup: done once the model is set up, not merely owned', () => {
    const goal: Goal = { kind: 'setup', modelId: 'sdxl', name: 'SDXL', fee: 0 }
    expect(isGoalDone(goal, fresh())).toBe(false)
    expect(isGoalDone(goal, fresh((s) => {
      s.models['sdxl'] = { precisions: ['native'], setup: false }
    }))).toBe(false)
    expect(isGoalDone(goal, fresh((s) => {
      s.models['sdxl'] = { precisions: ['native'], setup: true }
    }))).toBe(true)
  })

  it('buy: done once the price is banked', () => {
    const goal: Goal = {
      kind: 'buy',
      hardwareId: 'card',
      name: 'Test Card',
      family: 'nvidia-consumer',
      cost: 1000,
      pct: 50,
      etaSec: 10,
      unlocksModel: null,
    }
    expect(isGoalDone(goal, fresh((s) => {
      s.credits = 999
    }))).toBe(false)
    expect(isGoalDone(goal, fresh((s) => {
      s.credits = 1000
    }))).toBe(true)
  })

  it('node: done once it is unlocked', () => {
    const goal: Goal = { kind: 'node', nodeId: 'root', title: 'Comfy Manager', cost: 500, currency: 'credits' }
    expect(isGoalDone(goal, fresh())).toBe(false)
    expect(isGoalDone(goal, fresh((s) => {
      s.mapNodes = ['root']
    }))).toBe(true)
  })

  it('level: done once the level is reached', () => {
    const goal: Goal = { kind: 'level', level: 3, pct: 10, xpToGo: 400 }
    expect(isGoalDone(goal, fresh())).toBe(false)
    expect(isGoalDone(goal, fresh((s) => {
      s.stats.levelSeen = 3
    }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// saveTarget
// ---------------------------------------------------------------------------

/**
 * The body of `useSaveTarget` in src/components/store/storeHooks.ts, transcribed. The hook is
 * meant to become a thin wrapper over `saveTarget`; this pins the semantics it has to keep.
 */
function hookSaveTarget(s: GameState, d: Derived, catalog: Catalog) {
  const visibleHardware = (): HardwareDef[] => {
    const out: HardwareDef[] = []
    for (const def of catalog.hardware) if (isUnlocked(def.unlock, s, d, catalog)) out.push(def)
    return out
  }
  const nonCreditLock = (def: HardwareDef): string | null => {
    if (!d.unlockedFamilies.includes(def.family)) return 'Locked'
    if (!isUnlocked(def.unlock, s, d, catalog)) return 'Locked'
    const owned = s.hardware[def.id] ?? 0
    if (def.max !== undefined && owned >= def.max) return `Maxed out · ${def.max} owned`
    return null
  }
  let best: HardwareDef | null = null
  let bestCost = Infinity
  for (const def of visibleHardware()) {
    if (nonCreditLock(def)) continue
    const cost = unitCost(def, s.hardware[def.id] ?? 0)
    if (cost > s.credits && cost < bestCost) {
      best = def
      bestCost = cost
    }
  }
  if (!best) return null
  const pct = Math.max(0, Math.min(100, Math.floor((s.credits / bestCost) * 100)))
  const etaSec = d.cps > 0 ? Math.ceil((bestCost - s.credits) / d.cps) : Infinity
  return { id: best.id, name: best.name, family: best.family as HardwareFamily, cost: bestCost, pct, etaSec }
}

describe('saveTarget', () => {
  function livedIn(credits: number): GameState {
    return fresh((s) => {
      s.credits = credits
      s.hardware = { 'pc-4c8t': 2, 'rtx-3060': 3, 'rtx-3090': 1 }
      s.upgrades = ['rocm-setup']
      s.mapNodes = ['core-root']
      s.lifetimeCredits = 250_000
      s.totalClicks = 2_400
      s.stats.posts = 60
    })
  }

  it('matches the store hook over a lived-in save at every scale', () => {
    for (const credits of [0, 250, 1_000, 25_000, 400_000, 9_000_000]) {
      const s = livedIn(credits)
      const d = computeDerived(s, CATALOG)
      const hook = hookSaveTarget(s, d, CATALOG)
      const engine = saveTarget(s, d, CATALOG)
      if (hook === null) {
        expect(engine).toBeNull()
        continue
      }
      expect(engine).not.toBeNull()
      expect({
        id: engine?.def.id,
        name: engine?.def.name,
        family: engine?.def.family,
        cost: engine?.cost,
        pct: engine?.pct,
        etaSec: engine?.etaSec,
      }).toEqual(hook)
    }
  })

  it('picks the cheapest unaffordable unit, skipping locked, maxed and affordable ones', () => {
    const catalog = createCatalog({
      hardware: [
        hardware({ id: 'affordable', baseCost: 50, growth: 1 }),
        hardware({ id: 'locked', baseCost: 120, growth: 1, unlock: { type: 'flag', key: 'nope' } }),
        hardware({ id: 'maxed', baseCost: 130, growth: 1, max: 1 }),
        hardware({ id: 'amd', baseCost: 140, growth: 1, family: 'amd-consumer' }),
        hardware({ id: 'target', baseCost: 150, growth: 1 }),
        hardware({ id: 'dearer', baseCost: 900, growth: 1 }),
      ],
    })
    const s = fresh((st) => {
      st.credits = 100
      st.hardware = { maxed: 1 }
    })
    const target = saveTarget(s, base, catalog)
    expect(target?.def.id).toBe('target')
    expect(target).toMatchObject({ cost: 150, pct: 66, etaSec: Infinity })
  })

  it('prices the next unit, not the first', () => {
    const catalog = createCatalog({ hardware: [hardware({ id: 'card', baseCost: 100, growth: 2 })] })
    const s = fresh((st) => {
      st.credits = 100
      st.hardware = { card: 2 }
    })
    expect(saveTarget(s, derivedWith({ cps: 10 }), catalog)).toMatchObject({ cost: 400, pct: 25, etaSec: 30 })
  })

  it('is null when everything visible is affordable', () => {
    const catalog = createCatalog({ hardware: [hardware({ id: 'card', baseCost: 100, growth: 1 })] })
    const s = fresh((st) => {
      st.credits = 10_000
    })
    expect(saveTarget(s, base, catalog)).toBeNull()
  })
})
