/**
 * Comfy Registry custom nodes. The API has no server-side sort, so we pull the first pages and rank
 * by downloads locally, "trending custom nodes" for the feed. `likes` carries GitHub stars;
 * downloads live in `stats`.
 */
import { isOfficialHandle } from '@/server/feed/normalize'
import type { FeedItem, RegistryNode, SourceResult } from '@/server/feed/types'
import { clampText, collapseWhitespace, errorMessage, fetchJson, getArray, getNumber, getString, toIso } from '@/server/feed/util'

export const REGISTRY_API_URL = 'https://api.comfy.org/nodes'
export const REGISTRY_PAGES = 2
export const REGISTRY_PAGE_SIZE = 100
export const REGISTRY_TOP_N = 10

export function registryPageUrl(page: number, limit = REGISTRY_PAGE_SIZE): string {
  return `${REGISTRY_API_URL}?page=${page}&limit=${limit}`
}

export function parseRegistryPage(json: unknown): RegistryNode[] {
  const nodes: RegistryNode[] = []
  for (const raw of getArray(json, 'nodes')) {
    const id = getString(raw, 'id')
    if (!id) continue
    const icon = getString(raw, 'icon')
    const repository = getString(raw, 'repository')
    const node: RegistryNode = {
      id,
      name: getString(raw, 'name') ?? id,
      description: collapseWhitespace(getString(raw, 'description') ?? ''),
      downloads: getNumber(raw, 'downloads') ?? 0,
      githubStars: getNumber(raw, 'github_stars') ?? 0,
      publisher: getString(raw, 'publisher.name') ?? getString(raw, 'publisher.id') ?? getString(raw, 'author') ?? id,
      updatedAt: toIso(getString(raw, 'latest_version.createdAt')) ?? toIso(getString(raw, 'created_at')),
    }
    if (icon && /^https?:\/\//i.test(icon)) node.icon = icon
    if (repository && /^https?:\/\//i.test(repository)) node.repository = repository
    nodes.push(node)
  }
  return nodes
}

/** Dedupe by id, rank by downloads (stars break ties), keep the top `n`. */
export function topRegistryNodes(nodes: RegistryNode[], n = REGISTRY_TOP_N): RegistryNode[] {
  const byId = new Map<string, RegistryNode>()
  for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node)
  return [...byId.values()]
    .sort((a, b) => b.downloads - a.downloads || b.githubStars - a.githubStars || a.id.localeCompare(b.id))
    .slice(0, n)
}

export function registryNodeToFeedItem(node: RegistryNode, now = Date.now()): FeedItem {
  const description = node.description || 'A custom node pack. The README is the documentation.'
  const item: FeedItem = {
    id: `registry:${node.id}`,
    source: 'registry',
    author: node.name,
    handle: node.publisher,
    url: node.repository ?? `https://registry.comfy.org/nodes/${encodeURIComponent(node.id)}`,
    text: `${node.name}: ${clampText(description, 240)}`,
    date: node.updatedAt ?? new Date(now).toISOString(),
    likes: node.githubStars,
    tags: ['customnodes'],
    verified: isOfficialHandle(node.publisher),
    stats: { downloads: node.downloads, stars: node.githubStars },
  }
  if (node.icon) item.avatarUrl = node.icon
  return item
}

export async function fetchRegistry(): Promise<SourceResult> {
  const pages = Array.from({ length: REGISTRY_PAGES }, (_, i) => i + 1)
  const failures: string[] = []
  const nodes: RegistryNode[] = []
  await Promise.all(
    pages.map(async (page) => {
      try {
        nodes.push(...parseRegistryPage(await fetchJson(registryPageUrl(page))))
      } catch (err) {
        failures.push(`page ${page}: ${errorMessage(err)}`)
      }
    }),
  )
  const now = Date.now()
  const items = topRegistryNodes(nodes).map((node) => registryNodeToFeedItem(node, now))
  if (failures.length === 0) return { items }
  return { items, error: failures.join('; ') }
}
