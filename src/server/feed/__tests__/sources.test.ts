import { describe, expect, it } from 'vitest'
import { parseBlogFeed } from '@/server/feed/sources/blog'
import { parseGithubReleases } from '@/server/feed/sources/github'
import { parseHnSearch } from '@/server/feed/sources/hn'
import {
  curatedLinkedInTargets,
  linkedInActivityDate,
  linkedInActivityId,
  linkedInProfileSlug,
  parseLinkedInPost,
} from '@/server/feed/sources/linkedin'
import { parseRedditAtom } from '@/server/feed/sources/reddit'
import { parseRegistryPage, registryNodeToFeedItem, topRegistryNodes } from '@/server/feed/sources/registry'
import { curatedTweets, parseFxProfile, parseFxTweet, parseSyndicationTweet, tweetDate, tweetRef } from '@/server/feed/sources/x'
import { parseYoutubeAtom } from '@/server/feed/sources/youtube'
import { fixture, fixtureJson } from './fixtures/load'

describe('linkedin', () => {
  const target = {
    id: '7453496735747760128',
    url: 'https://www.linkedin.com/posts/robinjhuang_we-just-closed-30-million-financing-at-a-activity-7453496735747760128-E8AA',
    handle: 'robinjhuang',
  }

  it('parses text, reactions, date, author, avatar and image from a public post page', () => {
    const item = parseLinkedInPost(fixture('linkedin-post.html'), target)
    expect(item).not.toBeNull()
    expect(item).toMatchObject({
      id: 'linkedin:7453496735747760128',
      source: 'linkedin',
      author: 'Robin Huang',
      handle: 'robinjhuang',
      url: target.url,
      likes: 507,
      date: '2026-04-24T17:35:01.055Z',
      verified: true,
      stats: { comments: 77 },
    })
    expect(item!.text.startsWith('We just closed $30 million financing at a $500 million valuation')).toBe(true)
    expect(item!.text).toContain('Craft Ventures')
    expect(item!.avatarUrl).toMatch(/^https:\/\/media\.licdn\.com\/.*profile-displayphoto/)
    expect(item!.mediaUrl).toMatch(/^https:\/\/dms\.licdn\.com\//)
    expect(item!.mediaUrl).not.toContain('&amp;')
  })

  it('returns null for auth walls (even with reaction markup present) and empty pages', () => {
    expect(parseLinkedInPost('', target)).toBeNull()
    expect(parseLinkedInPost('<html><head><meta name="description" content="Sign in to LinkedIn"></head></html>', target)).toBeNull()
    const gated = fixture('linkedin-post.html').replace(
      /<meta name="description" content="[^"]*"/,
      '<meta name="description" content="Sign in or join now to see posts like this one and more."',
    )
    expect(gated).toContain('data-num-reactions="507"')
    expect(parseLinkedInPost(gated, target)).toBeNull()
  })

  it('derives ids, dates and slugs from urls', () => {
    expect(linkedInActivityId(target.url)).toBe('7453496735747760128')
    expect(linkedInActivityId('https://www.linkedin.com/feed/update/urn:li:activity:7437180483886678016')).toBe('7437180483886678016')
    expect(linkedInActivityId('https://www.linkedin.com/in/robinjhuang')).toBeNull()
    expect(linkedInActivityDate('7453496735747760128').slice(0, 19)).toBe('2026-04-24T17:35:01')
    expect(linkedInProfileSlug(target.url)).toBe('robinjhuang')
    expect(linkedInProfileSlug('https://www.linkedin.com/in/yolandyan?trk=x')).toBe('yolandyan')
    const curated = curatedLinkedInTargets()
    expect(curated).toHaveLength(8)
    expect(new Set(curated.map((t) => t.id)).size).toBe(8)
  })
})

describe('x', () => {
  const target = { user: 'yoland_yan', id: '1803104946679849253' }

  it('parses an fxtwitter status', () => {
    const item = parseFxTweet(fixtureJson('fxtwitter.json'), target)
    expect(item).toMatchObject({
      id: 'x:1803104946679849253',
      source: 'x',
      author: 'Yoland Yan',
      handle: 'yoland_yan',
      url: 'https://x.com/yoland_yan/status/1803104946679849253',
      likes: 671,
      date: '2024-06-18T16:38:14.000Z',
      mediaUrl: 'https://pbs.twimg.com/media/GQXqRgqaIAAo_Zz.jpg?name=orig',
      verified: true,
      stats: { comments: 47, reposts: 114, views: 89781 },
    })
    expect(item!.text).toContain('creator of ComfyUI-Manager')
    expect(item!.avatarUrl).toBe('https://pbs.twimg.com/profile_images/1802833511206072320/LtFpoZ0k_200x200.jpg')
  })

  it('parses the syndication fallback and strips the trailing t.co link', () => {
    const item = parseSyndicationTweet(fixtureJson('syndication.json'), target)
    expect(item).toMatchObject({
      id: 'x:1803104946679849253',
      author: 'Yoland Yan',
      handle: 'yoland_yan',
      likes: 671,
      date: '2024-06-18T16:38:14.000Z',
      mediaUrl: 'https://pbs.twimg.com/media/GQXqRgqaIAAo_Zz.jpg',
      avatarUrl: 'https://pbs.twimg.com/profile_images/1802833511206072320/LtFpoZ0k_400x400.jpg',
      verified: true,
      stats: { comments: 47 },
    })
    expect(item!.text).not.toMatch(/t\.co/)
    expect(item!.text.endsWith('creator of')).toBe(true)
  })

  it('parses the official profile', () => {
    expect(parseFxProfile(fixtureJson('fxtwitter-profile.json'))).toEqual({
      name: 'ComfyUI',
      handle: 'ComfyUI',
      url: 'https://x.com/ComfyUI',
      avatarUrl: 'https://pbs.twimg.com/profile_images/2047708517570887680/vasvAmZR_400x400.jpg',
      followers: 57785,
      verified: true,
    })
  })

  it('rejects error payloads and derives dates from snowflakes', () => {
    expect(parseFxTweet({ code: 404, message: 'NOT_FOUND' }, target)).toBeNull()
    expect(parseSyndicationTweet({}, target)).toBeNull()
    expect(tweetDate('1803104946679849253')).toBe('2024-06-18T16:38:14.015Z')
    expect(tweetRef('https://x.com/robinjhuang/status/2062579638015291586')).toEqual({ user: 'robinjhuang', id: '2062579638015291586' })
    expect(curatedTweets()).toHaveLength(4)
  })
})

describe('reddit', () => {
  it('parses the r/comfyui atom feed', () => {
    const items = parseRedditAtom(fixture('reddit.xml'))
    expect(items).toHaveLength(6)
    const first = items[0]
    expect(first).toMatchObject({
      id: 'reddit:1w96xzh',
      source: 'reddit',
      author: 'u/Nekodificador',
      handle: 'Nekodificador',
      url: 'https://www.reddit.com/r/comfyui/comments/1w96xzh/denzel_explains_why_he_uses_ai/',
      date: '2026-09-06T20:15:57.000Z',
      likes: null,
      verified: false,
    })
    expect(first.text.startsWith('Denzel explains why he uses AI.\n')).toBe(true)
    expect(first.text).toContain('Minimax H3 in ComfyUI')
    expect(first.text).not.toContain('submitted by')
    expect(first.mediaUrl).toMatch(/^https:\/\/external-preview\.redd\.it\//)
    expect(first.mediaUrl).toContain('&crop=smart')
    expect(first.mediaUrl).not.toContain('&amp;')
    expect(new Set(items.map((i) => i.id)).size).toBe(6)
    for (const item of items) expect(item.text.length).toBeGreaterThan(0)
  })
})

describe('hn', () => {
  it('parses algolia hits and falls back to the discussion url', () => {
    const items = parseHnSearch(fixtureJson('hn.json'))
    expect(items).toHaveLength(5)
    expect(items[0]).toMatchObject({
      id: 'hn:49155629',
      source: 'hn',
      author: 'vblanco',
      handle: 'vblanco',
      url: 'https://blog.comfy.org/p/minimax-h3-day-0-support-in-comfyui',
      text: 'MiniMax H3 Day-0 Support in ComfyUI: Open Weights, Native Audio, and 2K Video',
      date: '2026-08-03T13:34:43.000Z',
      likes: 334,
      stats: { comments: 94 },
    })
    const noUrl = items.find((i) => i.id === 'hn:40799262')
    expect(noUrl?.url).toBe('https://news.ycombinator.com/item?id=40799262')
  })
  it('drops off-topic hits', () => {
    expect(parseHnSearch({ hits: [{ title: 'Ollama gateway', url: 'https://x.example', objectID: '1' }] })).toEqual([])
    expect(parseHnSearch(null)).toEqual([])
  })
})

describe('blog', () => {
  it('parses the substack rss feed', () => {
    const items = parseBlogFeed(fixture('blog.xml'))
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      id: 'blog:forward-deployed-creatives',
      source: 'blog',
      author: 'Doug Hogan',
      handle: 'blog.comfy.org',
      url: 'https://blog.comfy.org/p/forward-deployed-creatives',
      date: '2026-09-04T17:06:37.000Z',
      likes: null,
      verified: true,
    })
    expect(items[0].text.startsWith('Forward Deployed Creatives — Comfy experts embedded with your team')).toBe(true)
    expect(items[0].mediaUrl).toMatch(/^https:\/\/substackcdn\.com\//)
  })
})

describe('github', () => {
  it('parses releases with trimmed, flattened notes', () => {
    const items = parseGithubReleases(fixtureJson('github.json'))
    expect(items).toHaveLength(2)
    const first = items[0]
    expect(first).toMatchObject({
      id: 'github:v0.35.0',
      source: 'github',
      author: 'ComfyUI',
      handle: 'Comfy-Org/ComfyUI',
      url: 'https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.35.0',
      date: '2026-09-09T19:55:08.000Z',
      verified: true,
    })
    expect(first.text.startsWith('ComfyUI v0.35.0\n• ')).toBe(true)
    expect(first.text).toContain('#15883')
    expect(first.text).not.toContain('github.com/Comfy-Org/ComfyUI/pull')
    expect(first.text).not.toContain("What's Changed")
    expect(first.text.length).toBeLessThanOrEqual('ComfyUI v0.35.0\n'.length + 241)
    expect(parseGithubReleases({ message: 'rate limited' })).toEqual([])
  })
})

describe('registry', () => {
  it('parses nodes and ranks by downloads', () => {
    const nodes = parseRegistryPage(fixtureJson('registry.json'))
    expect(nodes).toHaveLength(8)
    const top = topRegistryNodes(nodes, 3)
    expect(top.map((n) => n.id)).toEqual(['comfyui-florence2', 'comfyui_ipadapter_plus', 'comfyui_patches_ll'])
    expect(top[0].downloads).toBeGreaterThan(top[1].downloads)
    const item = registryNodeToFeedItem(top[0])
    expect(item).toMatchObject({
      id: 'registry:comfyui-florence2',
      source: 'registry',
      author: 'ComfyUI-Florence2',
      likes: 1744,
      tags: ['customnodes'],
      stats: { downloads: 1621927, stars: 1744 },
    })
    expect(item.url).toMatch(/^https:\/\//)
    expect(item.text.startsWith('ComfyUI-Florence2 — Nodes to use Florence2 VLM')).toBe(true)
  })
  it('dedupes across pages', () => {
    const nodes = parseRegistryPage(fixtureJson('registry.json'))
    expect(topRegistryNodes([...nodes, ...nodes], 20)).toHaveLength(8)
  })
})

describe('youtube', () => {
  it('parses channel uploads with thumbnails, likes and views', () => {
    const items = parseYoutubeAtom(fixture('youtube.xml'))
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      id: 'youtube:zF-5R-Cg8tQ',
      source: 'youtube',
      author: 'ComfyUI',
      handle: 'comfyui',
      url: 'https://www.youtube.com/shorts/zF-5R-Cg8tQ',
      date: '2026-09-11T19:58:00.000Z',
      mediaUrl: 'https://i3.ytimg.com/vi/zF-5R-Cg8tQ/hqdefault.jpg',
      likes: 12,
      verified: true,
      stats: { views: 745 },
    })
    expect(items[0].text.startsWith('One talking-head video, multiple camera angles\nThis Seedance 2.5 workflow')).toBe(true)
  })
  it('handles a channel with no uploads', () => {
    expect(parseYoutubeAtom(fixture('youtube-empty.xml'))).toEqual([])
  })
})
