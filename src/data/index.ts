/**
 * The assembled game catalog. Every game-core function takes a `Catalog` so tests can pass
 * small fixtures; the app passes `CATALOG`, built from the data files in this directory.
 */
import type {
  AchievementDef,
  ContractDef,
  EventDef,
  GambleOutcomeDef,
  HardwareDef,
  HashtagDef,
  MapNodeDef,
  ModelDef,
  Precision,
  PrecisionDef,
  UpgradeDef,
} from '@/game/types'
import { ACHIEVEMENTS } from '@/data/achievements'
import { CITIZEN_LINES, CITIZEN_PREFIXES, CITIZEN_SUFFIXES } from '@/data/citizens'
import { CONTRACTS } from '@/data/contracts'
import { EVENT_DEFS } from '@/data/events'
import { GAMBLE_OUTCOMES } from '@/data/gamble'
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
  /** Lounge wheel segments. Weights are probabilities and sum to 1. */
  gamble: GambleOutcomeDef[]
  /** Word pools for the citizens who run published workflows. */
  citizens: CitizenFlavor
}

/** Handle parts and one-liners for the hub's invented players. */
export interface CitizenFlavor {
  prefixes: string[]
  suffixes: string[]
  lines: string[]
}

/**
 * Build a catalog from partial data. Missing arrays are empty; precisions and the roulette table
 * default to the shipped data, so unit tests can write `createCatalog({ hardware: [rtx3060] })`.
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
    gamble: partial.gamble ?? GAMBLE_OUTCOMES,
    citizens: partial.citizens ?? SHIPPED_CITIZENS,
  }
}

const SHIPPED_CITIZENS: CitizenFlavor = {
  prefixes: [...CITIZEN_PREFIXES],
  suffixes: [...CITIZEN_SUFFIXES],
  lines: [...CITIZEN_LINES],
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
  gamble: GAMBLE_OUTCOMES,
  citizens: SHIPPED_CITIZENS,
}
