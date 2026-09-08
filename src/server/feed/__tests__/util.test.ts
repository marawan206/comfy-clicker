import { describe, expect, it } from 'vitest'
import {
  attrValue,
  clampText,
  decodeEntities,
  entryLink,
  extractAttr,
  extractMeta,
  extractTitle,
  firstImageUrl,
  getNumber,
  getPath,
  getString,
  mapLimit,
  markdownToText,
  parseCount,
  parseEntry,
  stripHtml,
  toIso,
  xmlEntries,
  xmlTag,
  xmlTagAttr,
} from '@/server/feed/util'

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities and leaves unknown ones alone', () => {
    expect(decodeEntities('Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;x&#39; &#x1F600; &nbsp;&bogus;')).toBe(
      'Tom & Jerry <3 "hi" \'x\' 😀  &bogus;',
    )
  })
  it('only decodes one level (double-encoded stays encoded)', () => {
    expect(decodeEntities('&amp;#32;')).toBe('&#32;')
  })
})

describe('stripHtml', () => {
  it('drops tags, comments and scripts, keeps paragraph breaks, decodes entities', () => {
    const html = '<div class="md"><p>Hello <b>world</b> &amp; friends</p><!-- x --><script>evil()</script><p>Second&#32;line</p></div>'
    expect(stripHtml(html)).toBe('Hello world & friends\nSecond line')
  })
})

describe('extractMeta / attributes', () => {
  const html =
    '<html><head><title>Post | Robin Huang posted on the topic | LinkedIn</title>' +
    '<meta content="first &amp; foremost" name="description">' +
    '<meta property="og:image" content="https://img.example/x.jpg?a=1&amp;b=2"></head>' +
    '<body><a data-num-reactions="507" href="#">x</a><a data-num-reactions="1">y</a>' +
    '<img class="a" data-delayed-url="https://media.example/p.jpg"></body></html>'
  it('handles either attribute order and decodes the content', () => {
    expect(extractMeta(html, 'description')).toBe('first & foremost')
    expect(extractMeta(html, 'og:image')).toBe('https://img.example/x.jpg?a=1&b=2')
    expect(extractMeta(html, 'missing')).toBeNull()
  })
  it('returns the first attribute occurrence', () => {
    expect(extractAttr(html, 'data-num-reactions')).toBe('507')
    expect(parseCount(extractAttr(html, 'data-num-reactions'))).toBe(507)
  })
  it('reads title and lazy images', () => {
    expect(extractTitle(html)).toBe('Post | Robin Huang posted on the topic | LinkedIn')
    expect(firstImageUrl(html)).toBe('https://media.example/p.jpg')
    expect(attrValue('<a href=\'x\' rel="alternate">', 'rel')).toBe('alternate')
  })
})

describe('xml helpers', () => {
  const atom =
    '<feed><title>Feed</title><entry><id>t3_a</id><title>A &amp; B</title><link rel="self" href="s"/><link rel="alternate" href="https://a.example/1"/>' +
    '<media:thumbnail url="https://t.example/1.png?w=1&amp;h=2"/><published>2026-09-06T20:15:57+00:00</published><author><name>/u/bob</name></author></entry>' +
    '<entry><id>t3_b</id><title><![CDATA[C <i>cdata</i>]]></title><link href="https://a.example/2" /></entry></feed>'
  const rss = '<rss><channel><item><title><![CDATA[T]]></title><link>https://b.example/p</link><guid>g1</guid><pubDate>Fri, 04 Sep 2026 17:06:37 GMT</pubDate><dc:creator><![CDATA[Doug]]></dc:creator><description><![CDATA[<p>Desc &amp; more</p>]]></description><enclosure url="https://b.example/i.png" type="image/png"/></item></channel></rss>'

  it('splits entries and items', () => {
    expect(xmlEntries(atom)).toHaveLength(2)
    expect(xmlEntries(rss)).toHaveLength(1)
  })
  it('reads tag text (decoded) and CDATA (verbatim)', () => {
    const [a, b] = xmlEntries(atom)
    expect(xmlTag(a, 'title')).toBe('A & B')
    expect(xmlTag(b, 'title')).toBe('C <i>cdata</i>')
    expect(xmlTag(a, 'nope')).toBeNull()
    expect(xmlTagAttr(a, 'media:thumbnail', 'url')).toBe('https://t.example/1.png?w=1&h=2')
  })
  it('prefers rel=alternate links, falls back to the first href, then RSS text links', () => {
    const [a, b] = xmlEntries(atom)
    expect(entryLink(a)).toBe('https://a.example/1')
    expect(entryLink(b)).toBe('https://a.example/2')
    expect(entryLink(xmlEntries(rss)[0])).toBe('https://b.example/p')
  })
  it('parseEntry gives a format-agnostic view', () => {
    const e = parseEntry(xmlEntries(rss)[0])
    expect(e).toMatchObject({
      id: 'g1',
      title: 'T',
      link: 'https://b.example/p',
      date: '2026-09-04T17:06:37.000Z',
      author: 'Doug',
      summary: 'Desc & more',
      image: 'https://b.example/i.png',
    })
    const a = parseEntry(xmlEntries(atom)[0])
    expect(a.author).toBe('/u/bob')
    expect(a.date).toBe('2026-09-06T20:15:57.000Z')
  })
})

describe('text helpers', () => {
  it('clampText cuts on a word boundary with an ellipsis', () => {
    expect(clampText('short', 10)).toBe('short')
    const long = 'the quick brown fox jumps over the lazy dog'
    const out = clampText(long, 20)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(21)
    expect(out).toBe('the quick brown fox…')
  })
  it('markdownToText flattens release notes', () => {
    const md = "## What's Changed\r\n* Fix **thing** by @x in https://github.com/Comfy-Org/ComfyUI/pull/15883\r\n* [Docs](https://d) update"
    expect(markdownToText(md)).toBe("What's Changed\n• Fix thing by @x in #15883\n• Docs update")
  })
  it('toIso parses ISO, RFC 2822 and Twitter dates', () => {
    expect(toIso('2026-09-06T20:15:57+00:00')).toBe('2026-09-06T20:15:57.000Z')
    expect(toIso('Fri, 04 Sep 2026 17:06:37 GMT')).toBe('2026-09-04T17:06:37.000Z')
    expect(toIso('Tue Jun 18 16:38:14 +0000 2024')).toBe('2024-06-18T16:38:14.000Z')
    expect(toIso('nope')).toBeNull()
    expect(toIso(null)).toBeNull()
  })
  it('json guards walk paths safely', () => {
    const j = { a: { b: [{ c: 'x', n: 3 }] }, s: '12' }
    expect(getString(j, 'a.b.0.c')).toBe('x')
    expect(getNumber(j, 'a.b.0.n')).toBe(3)
    expect(getNumber(j, 's')).toBe(12)
    expect(getPath(j, 'a.b.5.c')).toBeUndefined()
    expect(getString(null, 'a')).toBeNull()
  })
  it('mapLimit keeps order and bounds concurrency', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapLimit([30, 10, 20, 5], 2, async (ms) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, ms))
      inFlight -= 1
      return ms * 2
    })
    expect(out).toEqual([60, 20, 40, 10])
    expect(peak).toBe(2)
  })
})
