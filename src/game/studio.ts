/**
 * The Studio: queue generation jobs, run them `concurrency` at a time, and turn finished jobs
 * into posts. Job cost scales with income so a render is always a meaningful fraction of a
 * few seconds of cps; clicking on a running job shaves time off it, up to half.
 */
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import { API_COST_MULT, CLICK_JOB_BONUS_CAP, CLICK_JOB_BONUS_MS, MAX_POSTS, MAX_QUEUE } from '@/game/constants'
import { bestRunnable, genTimeMs } from '@/game/hardware'
import { normalizePromptText } from '@/game/hashtags'
import type { Derived, GameEvent, GameState, Job, ModelDef, Precision, Rng } from '@/game/types'
import { rollPost } from '@/game/virality'

/** API-node models bill someone else's GPU on top of yours (lives in constants.ts; re-exported for callers). */
export { API_COST_MULT }
/** Prompts are trimmed to this many characters (a post, not a novel). */
export const MAX_PROMPT_CHARS = 280
/** Explicit tags kept per job. */
export const MAX_JOB_TAGS = 8
/** Flag set the first time a prompt mentions spaghetti (hidden achievement). */
export const SPAGHETTI_FLAG = 'spaghetti'

export interface JobInput {
  modelId: string
  precision: Precision
  prompt: string
  tags: string[]
  hubWorkflowId?: string
}

export type CreateJobResult = { ok: true; job: Job } | { ok: false; reason: string }

/** `round(max(baseCost, costSecs × cps) × precision.costMult × (api ? 1.5 : 1))`. */
export function jobCost(
  model: ModelDef,
  precision: Precision,
  derived: Derived,
  catalog: Catalog,
): number {
  const costMult = catalog.precisions[precision]?.costMult ?? 1
  const base = Math.max(model.baseCost, model.costSecs * derived.cps)
  return Math.round(base * costMult * (model.api ? API_COST_MULT : 1))
}

function isRunning(job: Job): boolean {
  return job.startedAt !== null
}

/** A job is due once its (click-shortened) end time has passed. */
export function jobDue(job: Job, now: number): boolean {
  return job.endsAt !== null && job.endsAt - job.clickBonusMs <= now
}

/** Progress of a running job in [0, 1] (0 while pending). */
export function jobProgress(job: Job, now: number): number {
  if (job.startedAt === null || !(job.durationMs > 0)) return 0
  const elapsed = now - job.startedAt + job.clickBonusMs
  return Math.max(0, Math.min(1, elapsed / job.durationMs))
}

function newJobId(state: GameState, now: number, rng: Rng): string {
  const taken = new Set<string>()
  for (const j of state.queue) taken.add(j.id)
  for (const p of state.posts) taken.add(p.id)
  for (;;) {
    const id = `job-${now.toString(36)}-${Math.floor(rng() * 0x7fffffff).toString(36)}`
    if (!taken.has(id) && !taken.has(`post-${id}`)) return id
  }
}

/**
 * Validate, charge and enqueue a job. Rejections carry a short reason for the button tooltip.
 * The job waits (`startedAt: null`) until `advanceQueue` finds a free slot.
 */
export function createJob(
  state: GameState,
  derived: Derived,
  catalog: Catalog,
  input: JobInput,
  now: number,
  rng: Rng,
): CreateJobResult {
  const { modelById, hashtagById } = buildIndex(catalog)
  const model = modelById[input.modelId]
  if (!model) return { ok: false, reason: 'Unknown model' }
  const owned = state.models[model.id]
  if (!owned) return { ok: false, reason: `You don't have ${model.name} yet` }
  if (!owned.setup) return { ok: false, reason: `${model.name} is not set up yet` }
  if (!catalog.precisions[input.precision]) return { ok: false, reason: 'Unknown precision' }
  if (!owned.precisions.includes(input.precision)) {
    return { ok: false, reason: `${catalog.precisions[input.precision].label} not unlocked for ${model.name}` }
  }
  const hardware = bestRunnable(model, input.precision, state, derived, catalog)
  if (!hardware) return { ok: false, reason: 'Nothing you own can run this' }
  if (state.queue.length >= MAX_QUEUE) return { ok: false, reason: `Queue full (${MAX_QUEUE})` }
  const cost = jobCost(model, input.precision, derived, catalog)
  if (state.credits < cost) return { ok: false, reason: 'Not enough credits' }

  const prompt = input.prompt.trim().slice(0, MAX_PROMPT_CHARS)
  const tags: string[] = []
  for (const tag of input.tags) {
    if (hashtagById[tag] && !tags.includes(tag)) tags.push(tag)
    if (tags.length >= MAX_JOB_TAGS) break
  }

  state.credits -= cost
  state.stats.lastPrompt = prompt
  if (normalizePromptText(prompt).includes(' spaghetti ')) state.flags[SPAGHETTI_FLAG] = true

  const job: Job = {
    id: newJobId(state, now, rng),
    modelId: model.id,
    precision: input.precision,
    prompt,
    tags,
    hardwareId: hardware.id,
    cost,
    durationMs: genTimeMs(model, input.precision, hardware, derived, catalog),
    createdAt: now,
    startedAt: null,
    endsAt: null,
    clickBonusMs: 0,
  }
  if (input.hubWorkflowId !== undefined) job.hubWorkflowId = input.hubWorkflowId
  state.queue.push(job)
  return { ok: true, job }
}

/** Keep the feed at MAX_POSTS by dropping the oldest granted posts; live posts are never dropped. */
function trimPosts(state: GameState): void {
  while (state.posts.length > MAX_POSTS) {
    let victim = -1
    for (let i = state.posts.length - 1; i >= 0; i--) {
      if (state.posts[i]?.granted) {
        victim = i
        break
      }
    }
    if (victim < 0) return
    state.posts.splice(victim, 1)
  }
}

/**
 * Finish due jobs (each becomes a post at the top of the feed), then start pending jobs while
 * slots are free. Finishing first lets a freed slot be reused in the same tick.
 */
export function advanceQueue(
  state: GameState,
  derived: Derived,
  catalog: Catalog,
  now: number,
  rng: Rng,
): GameEvent[] {
  const events: GameEvent[] = []
  const { modelById } = buildIndex(catalog)

  for (let i = 0; i < state.queue.length; ) {
    const job = state.queue[i] as Job
    if (!isRunning(job) || !jobDue(job, now)) {
      i += 1
      continue
    }
    state.queue.splice(i, 1)
    if (!modelById[job.modelId]) {
      // The model left the catalog (save migration); refund rather than post nothing.
      state.credits += job.cost
      continue
    }
    const post = rollPost(job, state, derived, catalog, now, rng)
    state.posts.unshift(post)
    state.stats.posts += 1
    trimPosts(state)
    events.push({ type: 'postCreated', postId: post.id })
  }

  const slots = Math.max(1, Math.floor(derived.concurrency))
  let running = state.queue.filter(isRunning).length
  for (const job of state.queue) {
    if (running >= slots) break
    if (isRunning(job)) continue
    job.startedAt = now
    job.endsAt = now + job.durationMs
    running += 1
    events.push({ type: 'jobStarted', jobId: job.id })
  }
  return events
}

/**
 * A click on the studio shaves CLICK_JOB_BONUS_MS off the earliest running job, up to
 * CLICK_JOB_BONUS_CAP of its duration. Returns whether anything was shaved.
 */
export function applyClickToJobs(state: GameState, now: number): boolean {
  let target: Job | null = null
  for (const job of state.queue) {
    if (!isRunning(job) || jobDue(job, now)) continue
    if (target === null || (job.startedAt as number) < (target.startedAt as number)) target = job
  }
  if (!target) return false
  const cap = CLICK_JOB_BONUS_CAP * target.durationMs
  if (target.clickBonusMs >= cap) return false
  target.clickBonusMs = Math.min(cap, target.clickBonusMs + CLICK_JOB_BONUS_MS)
  return true
}
