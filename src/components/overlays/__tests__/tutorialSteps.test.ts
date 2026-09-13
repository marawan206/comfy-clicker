/**
 * The tour's rules, pinned. Everything here is pure: the step gates, the "is this a first run"
 * check, the skip-ahead cursor and the copy itself (length and house style).
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '@/game/state'
import { TUTORIAL_FLAG } from '@/game/actions'
import type { GameState, Job, Post } from '@/game/types'
import {
  NEW_PLAYER_CLICKS,
  TUTORIAL_CLICKS,
  TUTORIAL_STEPS,
  firstIncompleteStep,
  isNewPlayer,
  ownedHardware,
  shouldAutoStart,
  tourStart,
  type TourStart,
} from '../tutorialSteps'

const NOW = 1_700_000_000_000

function fresh(): GameState {
  return createInitialState(NOW, 'test-guest')
}

function start(state: GameState = fresh()): TourStart {
  return tourStart(state, NOW)
}

function job(): Job {
  return {
    id: 'job-1',
    modelId: 'sd15',
    precision: 'native',
    prompt: 'a comfy cat',
    tags: [],
    hardwareId: 'office-pc',
    cost: 10,
    durationMs: 7000,
    createdAt: NOW,
    startedAt: NOW,
    endsAt: NOW + 7000,
    clickBonusMs: 0,
  }
}

function post(over: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    createdAt: NOW,
    modelId: 'sd15',
    kind: 'image',
    precision: 'native',
    prompt: 'a comfy cat',
    tags: [],
    matchedTrending: [],
    thumb: 'thumb',
    cost: 10,
    targetLikes: 100,
    likes: 100,
    creditsPerLike: 1,
    creditsPaid: 0,
    windowMs: 8000,
    viral: false,
    flop: false,
    founderBoost: false,
    followersGained: 0,
    granted: false,
    roll: 1,
    trendMult: 1,
    ...over,
  }
}

const stepById = (id: string) => {
  const found = TUTORIAL_STEPS.find((s) => s.id === id)
  if (!found) throw new Error(`no step ${id}`)
  return found
}

describe('step gates', () => {
  it('finishes step one on the tenth click, not the ninth', () => {
    const state = fresh()
    const from = start(state)
    const click = stepById('click')

    state.totalClicks = from.clicks + TUTORIAL_CLICKS - 1
    expect(click.isDone(state, from)).toBe(false)

    state.totalClicks = from.clicks + TUTORIAL_CLICKS
    expect(click.isDone(state, from)).toBe(true)
  })

  it('counts clicks from where the tour started, not from zero', () => {
    const state = fresh()
    state.totalClicks = 7
    const from = start(state)
    const click = stepById('click')

    state.totalClicks = 16
    expect(click.isDone(state, from)).toBe(false)
    state.totalClicks = 17
    expect(click.isDone(state, from)).toBe(true)
  })

  it('finishes step two on one queued job', () => {
    const state = fresh()
    const from = start(state)
    const studio = stepById('studio')

    expect(studio.isDone(state, from)).toBe(false)
    state.queue.push(job())
    expect(studio.isDone(state, from)).toBe(true)
  })

  it('finishes step two on a post made since the tour opened', () => {
    const state = fresh()
    const from = start(state)
    state.stats.posts = from.posts + 1
    expect(stepById('studio').isDone(state, from)).toBe(true)
  })

  it('finishes step three only once a post of this session has paid out', () => {
    const state = fresh()
    const from = start(state)
    const feed = stepById('feed')

    state.posts.push(post({ granted: false }))
    expect(feed.isDone(state, from)).toBe(false)

    state.posts.push(post({ id: 'old', granted: true, createdAt: from.at - 1 }))
    expect(feed.isDone(state, from)).toBe(false)

    state.posts.push(post({ id: 'new', granted: true, createdAt: from.at + 10 }))
    expect(feed.isDone(state, from)).toBe(true)
  })

  it('finishes step four on a unit bought after the tour opened', () => {
    const state = fresh()
    state.hardware['office-pc'] = 1
    const from = start(state)
    const store = stepById('store')

    expect(ownedHardware(state)).toBe(from.hardware)
    expect(store.isDone(state, from)).toBe(false)

    state.hardware['office-pc'] = 2
    expect(store.isDone(state, from)).toBe(true)
  })

  it('leaves the two button-only steps to the player', () => {
    const state = fresh()
    const from = start(state)
    expect(stepById('trending').isDone(state, from)).toBe(false)
    expect(stepById('nav').isDone(state, from)).toBe(false)
  })
})

describe('shouldAutoStart', () => {
  it('opens on a fresh save', () => {
    expect(shouldAutoStart(fresh())).toBe(true)
  })

  it('stays shut for a save with 60 clicks on it', () => {
    const state = fresh()
    state.totalClicks = 60
    expect(state.totalClicks).toBeGreaterThan(NEW_PLAYER_CLICKS)
    expect(isNewPlayer(state)).toBe(false)
    expect(shouldAutoStart(state)).toBe(false)
  })

  it('stays shut once the tour has been run or skipped', () => {
    const state = fresh()
    state.flags[TUTORIAL_FLAG] = true
    expect(shouldAutoStart(state)).toBe(false)
  })

  it('stays shut for a player who has posted or banked real credits', () => {
    const posted = fresh()
    posted.stats.posts = 1
    expect(shouldAutoStart(posted)).toBe(false)

    const rich = fresh()
    rich.lifetimeCredits = 500
    expect(shouldAutoStart(rich)).toBe(false)
  })

  it('waits behind the offline report and any open dialog', () => {
    const state = fresh()
    expect(shouldAutoStart(state, { offlinePending: true })).toBe(false)
    expect(shouldAutoStart(state, { modalOpen: true })).toBe(false)
  })
})

describe('firstIncompleteStep', () => {
  it('is step one on a fresh save', () => {
    const state = fresh()
    expect(firstIncompleteStep(state, start(state))).toBe(0)
  })

  it('skips the steps a wandering player already satisfied, in order', () => {
    const state = fresh()
    state.hardware['office-pc'] = 1
    const from = start(state)

    // Clicked enough, queued a post, and it already paid out: the tour opens on "buy something".
    state.totalClicks = from.clicks + TUTORIAL_CLICKS
    state.queue.push(job())
    state.posts.push(post({ granted: true, createdAt: from.at + 5 }))
    expect(firstIncompleteStep(state, from)).toBe(3)

    // Buying a unit leaves only the two steps that wait on a button.
    state.hardware['office-pc'] = 2
    expect(firstIncompleteStep(state, from)).toBe(4)
  })

  it('never looks behind the step it was asked to start from', () => {
    const state = fresh()
    const from = start(state)
    expect(firstIncompleteStep(state, from, 2)).toBe(2)
    expect(firstIncompleteStep(state, from, TUTORIAL_STEPS.length)).toBe(TUTORIAL_STEPS.length)
  })
})

describe('the copy', () => {
  it('is six steps with one anchor each', () => {
    expect(TUTORIAL_STEPS).toHaveLength(6)
    const anchors = TUTORIAL_STEPS.map((s) => s.anchor)
    expect(new Set(anchors).size).toBe(anchors.length)
    const ids = TUTORIAL_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps every bubble readable at a glance', () => {
    for (const s of TUTORIAL_STEPS) {
      expect(s.body.length, s.id).toBeLessThanOrEqual(160)
      expect(s.title.length, s.id).toBeGreaterThan(0)
      expect(s.cta.length, s.id).toBeGreaterThan(0)
      expect(s.anchor.trim(), s.id).toBe(s.anchor)
    }
  })

  it('has no em-dash anywhere in it', () => {
    // Escaped, not typed: the house rule bans the character from every file, this one included.
    const EM_DASH = '\u2014'
    for (const s of TUTORIAL_STEPS) {
      for (const text of [s.title, s.body, s.cta, s.anchor]) {
        expect(text.includes(EM_DASH), `${s.id}: ${text}`).toBe(false)
      }
    }
  })
})
