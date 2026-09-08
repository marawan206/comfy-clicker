/**
 * Comfy-Org/ComfyUI releases. Unauthenticated GitHub allows 60 req/h per IP; set GITHUB_TOKEN to lift it.
 */
import type { FeedItem, SourceResult } from '@/server/feed/types'
import { clampText, errorMessage, fetchJson, getNumber, getPath, getString, markdownToText, toIso } from '@/server/feed/util'

export const GITHUB_RELEASES_URL = 'https://api.github.com/repos/Comfy-Org/ComfyUI/releases?per_page=5'
export const GITHUB_REPO_HANDLE = 'Comfy-Org/ComfyUI'
/** Release notes are long changelogs; the card shows the first slice. */
export const RELEASE_BODY_CHARS = 240

export function parseGithubReleases(json: unknown, now = Date.now()): FeedItem[] {
  if (!Array.isArray(json)) return []
  const fallbackDate = new Date(now).toISOString()
  const items: FeedItem[] = []
  for (const rel of json) {
    if (getPath(rel, 'draft') === true) continue
    const tag = getString(rel, 'tag_name')
    const url = getString(rel, 'html_url')
    if (!tag || !url) continue
    const prerelease = getPath(rel, 'prerelease') === true
    const head = `ComfyUI ${tag}${prerelease ? ' (pre-release)' : ''}`
    // Auto-generated notes open with a "What's Changed" heading that says nothing on a card.
    const body = markdownToText(getString(rel, 'body') ?? '').replace(/^what'?s changed\s*/i, '')
    items.push({
      id: `github:${tag}`,
      source: 'github',
      author: 'ComfyUI',
      handle: GITHUB_REPO_HANDLE,
      url,
      text: body ? `${head}\n${clampText(body, RELEASE_BODY_CHARS)}` : head,
      date: toIso(getString(rel, 'published_at')) ?? toIso(getString(rel, 'created_at')) ?? fallbackDate,
      likes: getNumber(rel, 'reactions.total_count'),
      tags: [],
      verified: true,
    })
  }
  return items
}

export async function fetchGithub(): Promise<SourceResult> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.authorization = `Bearer ${token}`
  try {
    const items = parseGithubReleases(await fetchJson(GITHUB_RELEASES_URL, { headers }))
    return items.length ? { items } : { items, error: 'no releases' }
  } catch (err) {
    return { items: [], error: errorMessage(err) }
  }
}
