/**
 * Catalog indexing. The data files ship arrays; hot paths want `byId` maps.
 * Indexes are memoised per catalog object so fixtures in tests get their own.
 */
import type { Catalog } from '@/data'
import type {
  ContractDef,
  EventDef,
  HardwareDef,
  HashtagDef,
  MapNodeDef,
  ModelDef,
  UpgradeDef,
} from '@/game/types'

export interface CatalogIndex {
  hardwareById: Record<string, HardwareDef>
  modelById: Record<string, ModelDef>
  upgradeById: Record<string, UpgradeDef>
  mapNodeById: Record<string, MapNodeDef>
  hashtagById: Record<string, HashtagDef>
  contractById: Record<string, ContractDef>
  eventById: Record<string, EventDef>
}

/** `[{id:'a'}, {id:'b'}]` → `{ a: {...}, b: {...} }`. Later duplicates win. */
export function indexById<T extends { id: string }>(arr: readonly T[]): Record<string, T> {
  const out: Record<string, T> = Object.create(null) as Record<string, T>
  for (const item of arr) out[item.id] = item
  return out
}

const INDEX_CACHE = new WeakMap<Catalog, CatalogIndex>()

/** Build (or fetch the cached) id → def maps for a catalog. */
export function buildIndex(catalog: Catalog): CatalogIndex {
  const cached = INDEX_CACHE.get(catalog)
  if (cached) return cached
  const index: CatalogIndex = {
    hardwareById: indexById(catalog.hardware),
    modelById: indexById(catalog.models),
    upgradeById: indexById(catalog.upgrades),
    mapNodeById: indexById(catalog.mapNodes),
    hashtagById: indexById(catalog.hashtags),
    contractById: indexById(catalog.contracts),
    eventById: indexById(catalog.events),
  }
  INDEX_CACHE.set(catalog, index)
  return index
}
