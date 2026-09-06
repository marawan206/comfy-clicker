/**
 * The assembled game catalog. Every game-core function takes a `Catalog` so tests can pass
 * small fixtures; the app passes `CATALOG`, built from the data files in this directory.
 */
import type {
  AchievementDef,
  ContractDef,
  EventDef,
  HardwareDef,
  HashtagDef,
  MapNodeDef,
  ModelDef,
  Precision,
  PrecisionDef,
  UpgradeDef,
} from '@/game/types'
import { ACHIEVEMENTS } from '@/data/achievements'
import { CONTRACTS } from '@/data/contracts'
import { EVENT_DEFS } from '@/data/events'
import { HARDWARE } from '@/data/hardware'
import { HASHTAGS } from '@/data/hashtags'
import { MAP_NODES } from '@/data/mapNodes'
import { MODELS } from '@/data/models'
import { PRECISIONS } from '@/data/precisions'
import { ALL_UPGRADES } from '@/data/upgrades'

export interface Catalog {
  hardware: HardwareDef[]
  models: ModelDef[]
  precisions: Record<Precision, PrecisionDef>
  /** Named upgrades followed by the virtual `tier:<hardwareId>:<n>` upgrades. */
  upgrades: UpgradeDef[]
  mapNodes: MapNodeDef[]
  achievements: AchievementDef[]
  hashtags: HashtagDef[]
  contracts: ContractDef[]
  events: EventDef[]
}

/**
 * Build a catalog from partial data. Missing arrays are empty and precisions default to the
 * shipped table, so unit tests can write `createCatalog({ hardware: [rtx3060] })`.
 */
export function createCatalog(partial: Partial<Catalog> = {}): Catalog {
  return {
    hardware: partial.hardware ?? [],
    models: partial.models ?? [],
    precisions: partial.precisions ?? PRECISIONS,
    upgrades: partial.upgrades ?? [],
    mapNodes: partial.mapNodes ?? [],
    achievements: partial.achievements ?? [],
    hashtags: partial.hashtags ?? [],
    contracts: partial.contracts ?? [],
    events: partial.events ?? [],
  }
}

/** The shipped game data. Tier upgrades are generated once here for the shipped hardware ladder. */
export const CATALOG: Catalog = {
  hardware: HARDWARE,
  models: MODELS,
  precisions: PRECISIONS,
  upgrades: ALL_UPGRADES(HARDWARE),
  mapNodes: MAP_NODES,
  achievements: ACHIEVEMENTS,
  hashtags: HASHTAGS,
  contracts: CONTRACTS,
  events: EVENT_DEFS,
}
