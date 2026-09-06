/**
 * Random events. Each kind has a fixed duration (game design constants below); several kinds
 * ship multiple flavours that differ only in copy and gating. The runtime picks a def by
 * `weight` among those whose `minTier` ≤ the player's best speedTier.
 *
 * Kind semantics (implemented in game/events.ts):
 *   modelDrop      +100% likes on a random hashtag (payload) for the duration
 *   nodeBroke      income halved until the player clicks the broken node to fix it
 *   founderRepost  next posts get the founder boost window
 *   spotReclaim    a cloud node (payload) goes offline unless `reservedCapacity`
 *   powerSurge     brownout: power budget −40% for the duration (over-budget rigs run throttled)
 *   trendingSpark  tiny catch-me window; catching it arms `sparkNext`: the next post's likes are ×3
 *   cloudPromo     income ×2 for 77 seconds
 */
import type { EventDef, EventKind } from '@/game/types'

export const EVENT_DURATION_S: Record<EventKind, number> = {
  modelDrop: 300,
  nodeBroke: 120,
  founderRepost: 60,
  spotReclaim: 60,
  powerSurge: 90,
  trendingSpark: 8,
  cloudPromo: 77,
}

export const EVENT_DEFS: EventDef[] = [
  {
    id: 'ev-model-drop',
    kind: 'modelDrop',
    title: 'New Checkpoint Dropped',
    desc: 'A lab released weights at 2 a.m. and the timeline is on fire. Double likes on the tag for 5 minutes.',
    durationSec: EVENT_DURATION_S.modelDrop,
    weight: 3,
    minTier: 1,
  },
  {
    id: 'ev-model-drop-leak',
    kind: 'modelDrop',
    title: 'Weights Leaked',
    desc: 'Someone posted a magnet link. Nobody asked how. Double likes on the tag for 5 minutes.',
    durationSec: EVENT_DURATION_S.modelDrop,
    weight: 2,
    minTier: 3,
  },
  {
    id: 'ev-node-broke-import',
    kind: 'nodeBroke',
    title: 'IMPORT FAILED',
    desc: 'A custom node threw a red banner and took half your income with it. Click it to fix.',
    durationSec: EVENT_DURATION_S.nodeBroke,
    weight: 3,
    minTier: 1,
  },
  {
    id: 'ev-node-broke-frontend',
    kind: 'nodeBroke',
    title: 'Frontend Update',
    desc: 'The new frontend shipped and one node’s widgets vanished. Income halved until you click it.',
    durationSec: EVENT_DURATION_S.nodeBroke,
    weight: 2,
    minTier: 2,
  },
  {
    id: 'ev-node-broke-oom',
    kind: 'nodeBroke',
    title: 'CUDA out of memory',
    desc: 'Tried to allocate 20.00 GiB. Income halved until you click the node and add --lowvram.',
    durationSec: EVENT_DURATION_S.nodeBroke,
    weight: 2,
    minTier: 4,
  },
  {
    id: 'ev-founder-repost',
    kind: 'founderRepost',
    title: 'Founder Repost',
    desc: 'A ComfyUI founder reposted you. Posts finishing in the next minute get the founder boost.',
    durationSec: EVENT_DURATION_S.founderRepost,
    weight: 1,
    minTier: 2,
  },
  {
    id: 'ev-spot-reclaim',
    kind: 'spotReclaim',
    title: 'Spot Instance Reclaimed',
    desc: 'The cloud wants its GPU back. One node goes dark for a minute unless you have reserved capacity.',
    durationSec: EVENT_DURATION_S.spotReclaim,
    weight: 2,
    minTier: 8,
  },
  {
    id: 'ev-power-surge',
    kind: 'powerSurge',
    title: 'Power Surge',
    desc: 'A surge tripped the breaker. Power budget drops 40% for 90 seconds; anything over budget runs throttled.',
    durationSec: EVENT_DURATION_S.powerSurge,
    weight: 2,
    minTier: 3,
  },
  {
    id: 'ev-trending-spark',
    kind: 'trendingSpark',
    title: 'Trending Spark',
    desc: 'A tag is about to pop. Catch the spark within 8 seconds and your next post rides it.',
    durationSec: EVENT_DURATION_S.trendingSpark,
    weight: 3,
    minTier: 2,
  },
  {
    id: 'ev-cloud-promo',
    kind: 'cloudPromo',
    title: 'Comfy Cloud Promo',
    desc: 'Double credits for 77 seconds. Terms apply. The terms are: 77 seconds.',
    durationSec: EVENT_DURATION_S.cloudPromo,
    weight: 1,
    minTier: 5,
  },
]
