/**
 * ComfyHub server module: validation, listing with trending-aware scoring, publishing and run
 * recording. Route handlers in `src/app/api/hub/*` are thin wrappers around these.
 *
 * Reads and the publish go through the cookie-bound server client so RLS applies (public read,
 * author insert). Runs are recorded with the service role only: `/api/hub/run` clamps
 * `creditsPaid` to the job the workflow could actually cost the runner, rate-limits per runner
 * and inserts the `hub_runs` row itself (0003 dropped the runner-insert policy), and the insert
 * trigger bumps `runs_24h` / `runs_total` / `royalties_total` / `rep` in one atomic UPDATE.
 * Royalties reach the author's game through `claim_hub_royalties` (see `claimRoyalties`).
 */
import { z } from 'zod'
import { CATALOG } from '@/data'
import { HASHTAG_IDS } from '@/data/hashtags'
import { buildIndex } from '@/game/catalog'
import { jobCost } from '@/game/studio'
import type { Derived, Precision } from '@/game/types'
import { readFeed } from '@/server/feed/store'
import { getSupabaseAdminClient } from '@/server/supabase/admin'
import { createSupabaseServerClient } from '@/server/supabase/server'
import type { HubWorkflowRow } from '@/server/supabase/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Share of the runner's job cost credited to the author as royalty. */
export const HUB_ROYALTY_RATE = 0.05
/** Trending bonus per matched live trending tag in the `trending` sort. */
export const HUB_TRENDING_BONUS = 0.5
export const HUB_MAX_HASHTAGS = 3
export const HUB_NAME_MAX = 80
export const HUB_LIST_LIMIT = 60
/** Runs one player may record per minute; a queue of MAX_QUEUE jobs at GEN_TIME_MIN_S needs far fewer. */
export const HUB_RUNS_PER_MINUTE = 40
/**
 * Headroom on the runner's last uploaded cps when capping `creditsPaid`: the cloud row is at
 * most a minute old and income can jump a few times over in that minute early on.
 */
export const HUB_CPS_HEADROOM = 4

export type HubSort = 'trending' | 'new'

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const MODEL_IDS = new Set(CATALOG.models.map((m) => m.id))
const HASHTAG_SET = new Set(HASHTAG_IDS)
const PRECISIONS: readonly Precision[] = ['native', 'fp8', 'q4']

export const hubPublishSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the workflow a name')
    .max(HUB_NAME_MAX, `Names cap at ${HUB_NAME_MAX} characters`),
  modelId: z.string().refine((id) => MODEL_IDS.has(id), 'Unknown model'),
  precision: z.enum(PRECISIONS),
  hashtags: z
    .array(z.string().refine((id) => HASHTAG_SET.has(id), 'Unknown hashtag'))
    .max(HUB_MAX_HASHTAGS, `Up to ${HUB_MAX_HASHTAGS} hashtags`)
    .default([])
    .transform((tags) => Array.from(new Set(tags))),
  loraTag: z
    .string()
    .refine((id) => HASHTAG_SET.has(id), 'Unknown LoRA tag')
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  upscaler: z.boolean().default(false),
})
export type HubPublishInput = z.input<typeof hubPublishSchema>

export const hubRunSchema = z.object({
  workflowId: z.uuid('Bad workflow id'),
  creditsPaid: z.number().finite().nonnegative(),
})
export type HubRunInput = z.input<typeof hubRunSchema>

export const hubListSchema = z.object({
  sort: z.enum(['trending', 'new']).default('trending'),
  tag: z
    .string()
    .refine((id) => HASHTAG_SET.has(id), 'Unknown hashtag')
    .optional(),
  limit: z.coerce.number().int().min(1).max(HUB_LIST_LIMIT).default(HUB_LIST_LIMIT),
})
export type HubListInput = z.input<typeof hubListSchema>

/** Whole-credit royalty on a run; the author of their own workflow earns nothing from it. */
export function royaltyFor(creditsPaid: number, selfRun: boolean): number {
  if (selfRun || !Number.isFinite(creditsPaid) || creditsPaid <= 0) return 0
  return Math.round(creditsPaid * HUB_ROYALTY_RATE)
}

/** Reputation earned by one run: +1 for the run, +1 per order of magnitude of royalty. */
export function repFor(royalty: number): number {
  return 1 + (royalty > 0 ? Math.floor(Math.log10(1 + royalty)) : 0)
}

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------
export interface HubWorkflow {
  id: string
  authorId: string
  authorHandle: string
  name: string
  modelId: string
  precision: Precision
  loraTag: string | null
  upscaler: boolean
  hashtags: string[]
  runs24h: number
  runsTotal: number
  rep: number
  /** Sum of royalties earned so far (whole credits). */
  royalties: number
  createdAt: string
  /** Live trending tags this workflow carries. */
  trendingMatch: number
  /** `runs_24h × (1 + 0.5 × trendingMatch)` — the trending sort key. */
  score: number
}

export interface HubList {
  workflows: HubWorkflow[]
  /** Live trending hashtag ids the scoring used (empty when the feed has none). */
  trending: string[]
  sort: HubSort
  tag: string | null
}

export type HubError = { ok: false; status: 400 | 401 | 404 | 429 | 503; error: string }
export type HubResult<T> = { ok: true; value: T } | HubError

const err = (status: HubError['status'], error: string): HubError => ({ ok: false, status, error })

type WorkflowJoinRow = HubWorkflowRow & { author: { handle: string } | { handle: string }[] | null }

function handleOf(author: WorkflowJoinRow['author']): string {
  if (!author) return 'comfy-anon'
  if (Array.isArray(author)) return author[0]?.handle ?? 'comfy-anon'
  return author.handle
}

/** Score, count trending matches and attach handles. Exported for tests. */
export function scoreWorkflows(rows: WorkflowJoinRow[], trending: readonly string[]): HubWorkflow[] {
  const hot = new Set(trending)
  return rows.map((row) => {
    const trendingMatch = row.hashtags.filter((t) => hot.has(t)).length
    return {
      id: row.id,
      authorId: row.author_id,
      authorHandle: handleOf(row.author),
      name: row.name,
      modelId: row.model_id,
      precision: row.precision,
      loraTag: row.lora_tag,
      upscaler: row.upscaler,
      hashtags: row.hashtags,
      runs24h: row.runs_24h,
      runsTotal: row.runs_total,
      rep: row.rep,
      // Maintained by the hub_runs insert trigger since 0003; older rows read as 0.
      royalties: Number(row.royalties_total) || 0,
      createdAt: row.created_at,
      trendingMatch,
      score: row.runs_24h * (1 + HUB_TRENDING_BONUS * trendingMatch),
    }
  })
}

async function liveTrending(): Promise<string[]> {
  try {
    const snapshot = await readFeed()
    return snapshot.trending.filter((t) => HASHTAG_SET.has(t))
  } catch {
    return []
  }
}


// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
/** Public listing. `trending` ranks by runs_24h × (1 + 0.5 × live trending matches); `new` by created_at. */
export async function listHub(input: HubListInput = {}): Promise<HubResult<HubList>> {
  const parsed = hubListSchema.safeParse(input)
  if (!parsed.success) return err(400, parsed.error.issues[0]?.message ?? 'Bad request')
  const { sort, tag, limit } = parsed.data

  const db = await createSupabaseServerClient()
  if (!db) return err(503, 'ComfyHub needs Supabase — the hub is offline in guest mode')

  let query = db.from('hub_workflows').select('*, author:profiles!hub_workflows_author_id_fkey(handle)')
  if (tag) query = query.contains('hashtags', [tag])
  query =
    sort === 'new'
      ? query.order('created_at', { ascending: false })
      : query.order('runs_24h', { ascending: false }).order('runs_total', { ascending: false }).order('created_at', { ascending: false })
  // The trending sort re-ranks in memory with the live bonus, so over-fetch a little for the cut.
  const { data, error } = await query.limit(sort === 'trending' ? Math.min(HUB_LIST_LIMIT * 2, 200) : limit)
  if (error) return err(503, `ComfyHub is unreachable: ${error.message}`)

  const rows = (data ?? []) as unknown as WorkflowJoinRow[]
  const trending = await liveTrending()
  let workflows = scoreWorkflows(rows, trending)
  if (sort === 'trending') {
    workflows = workflows
      .sort((a, b) => b.score - a.score || b.runsTotal - a.runsTotal || b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }
  return { ok: true, value: { workflows, trending, sort, tag: tag ?? null } }
}

/** Publish a workflow as the signed-in user. */
export async function publishWorkflow(input: unknown): Promise<HubResult<HubWorkflow>> {
  const parsed = hubPublishSchema.safeParse(input)
  if (!parsed.success) return err(400, parsed.error.issues[0]?.message ?? 'Bad request')

  const db = await createSupabaseServerClient()
  if (!db) return err(503, 'ComfyHub needs Supabase — the hub is offline in guest mode')
  const { data: auth } = await db.auth.getUser()
  const user = auth.user
  if (!user) return err(401, 'Sign in to publish to ComfyHub')

  const { name, modelId, precision, hashtags, loraTag, upscaler } = parsed.data
  const { data, error } = await db
    .from('hub_workflows')
    .insert({ author_id: user.id, name, model_id: modelId, precision, hashtags, lora_tag: loraTag, upscaler })
    .select('*, author:profiles!hub_workflows_author_id_fkey(handle)')
    .single()
  if (error || !data) return err(503, `Publish failed: ${error?.message ?? 'no row returned'}`)

  const [workflow] = scoreWorkflows([data as unknown as WorkflowJoinRow], await liveTrending())
  return { ok: true, value: workflow }
}

export interface HubRunReceipt {
  runId: string
  workflowId: string
  /** What the run was recorded at, after the server-side cap. */
  creditsPaid: number
  royalty: number
  rep: number
  selfRun: boolean
}

/**
 * The most a run of `modelId` at `precision` can have cost a player whose last uploaded income
 * was `cps`: the game's own `jobCost` with headroom for the minute since that upload. `jobCost`
 * reads only `derived.cps`, so a one-field Derived is enough here.
 */
export function runCostCap(modelId: string, precision: Precision, cps: number): number {
  const model = buildIndex(CATALOG).modelById[modelId]
  if (!model) return 0
  const derived = { cps: Math.max(0, cps) * HUB_CPS_HEADROOM } as Derived
  return jobCost(model, precision, derived, CATALOG)
}

/**
 * Record that the signed-in user ran a workflow. Needs the service role: the row is inserted
 * server-side (no client insert policy), `credits_paid` is capped by `runCostCap`, and the
 * insert trigger bumps the workflow's counters and rep atomically.
 */
export async function recordRun(input: unknown): Promise<HubResult<HubRunReceipt>> {
  const parsed = hubRunSchema.safeParse(input)
  if (!parsed.success) return err(400, parsed.error.issues[0]?.message ?? 'Bad request')

  const db = await createSupabaseServerClient()
  if (!db) return err(503, 'ComfyHub needs Supabase — the hub is offline in guest mode')
  const { data: auth } = await db.auth.getUser()
  const user = auth.user
  if (!user) return err(401, 'Sign in so the author gets their royalty')
  const admin = getSupabaseAdminClient()
  if (!admin) return err(503, 'ComfyHub royalties need the service role on this build')

  const { workflowId, creditsPaid } = parsed.data
  const { data: workflow } = await admin
    .from('hub_workflows')
    .select('id, author_id, model_id, precision')
    .eq('id', workflowId)
    .maybeSingle()
  if (!workflow) return err(404, 'That workflow was unpublished')

  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await admin
    .from('hub_runs')
    .select('id', { count: 'exact', head: true })
    .eq('runner_id', user.id)
    .gte('created_at', since)
  if ((count ?? 0) >= HUB_RUNS_PER_MINUTE) {
    return err(429, `The hub records at most ${HUB_RUNS_PER_MINUTE} runs a minute per player. Even the queue is not that fast.`)
  }

  const { data: save } = await admin.from('saves').select('cps').eq('user_id', user.id).maybeSingle()
  const cap = runCostCap(workflow.model_id, workflow.precision, Number(save?.cps) || 0)
  const paid = Math.min(Math.max(0, Math.round(creditsPaid)), cap)

  const selfRun = workflow.author_id === user.id
  const royalty = royaltyFor(paid, selfRun)
  const rep = selfRun ? 0 : repFor(royalty)
  const { data: run, error } = await admin
    .from('hub_runs')
    .insert({ workflow_id: workflowId, runner_id: user.id, credits_paid: paid, royalty, rep })
    .select('id')
    .single()
  if (error || !run) return err(503, `Run not recorded: ${error?.message ?? 'no row returned'}`)

  return { ok: true, value: { runId: run.id, workflowId, creditsPaid: paid, royalty, rep, selfRun } }
}

export interface HubRoyaltyGrant {
  /** Runs by other players collected in this claim. */
  runs: number
  /** Whole credits owed to the author for those runs. */
  royalty: number
  rep: number
}

/**
 * Hand the signed-in author every royalty and rep point earned since their last claim, marking
 * the runs so no device collects them twice. `{ runs: 0 }` when nothing is waiting.
 */
export async function claimRoyalties(): Promise<HubResult<HubRoyaltyGrant>> {
  const db = await createSupabaseServerClient()
  if (!db) return err(503, 'ComfyHub needs Supabase — the hub is offline in guest mode')
  const { data: auth } = await db.auth.getUser()
  const user = auth.user
  if (!user) return err(401, 'Sign in to collect royalties')
  const admin = getSupabaseAdminClient()
  if (!admin) return err(503, 'ComfyHub royalties need the service role on this build')

  const { data, error } = await admin.rpc('claim_hub_royalties', { p_author: user.id })
  if (error) return err(503, `Royalties unavailable: ${error.message}`)
  const row = data?.[0]
  return {
    ok: true,
    value: {
      runs: Math.max(0, Math.floor(Number(row?.runs) || 0)),
      royalty: Math.max(0, Math.round(Number(row?.royalty) || 0)),
      rep: Math.max(0, Math.floor(Number(row?.rep) || 0)),
    },
  }
}
