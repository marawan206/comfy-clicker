/**
 * The `next` parameter on /auth/callback. The route is the landing page for confirmation and magic
 * links, so a crafted link looks first-party, and the provider-error branch bounces before any auth
 * work: no session and no valid code are needed to make the redirect fire.
 */
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

import { GET } from '@/app/auth/callback/route'

const ORIGIN = 'https://comfy-clicker.vercel.app'

/** Bounce through the error branch, which needs no Supabase, and read the Location header. */
async function locationFor(next: string): Promise<string> {
  const url = `${ORIGIN}/auth/callback?error=x&next=${next}`
  const res = await GET(new NextRequest(new Request(url)))
  return res.headers.get('location') ?? ''
}

describe('safeNext', () => {
  it('keeps a same-origin path, with its query and hash', async () => {
    expect(await locationFor('%2Fleaderboard')).toBe(`${ORIGIN}/leaderboard?auth=error&reason=x`)
    expect(await locationFor('%2Fhub%3Fsort%3Dnew')).toBe(`${ORIGIN}/hub?sort=new&auth=error&reason=x`)
  })

  it('refuses the control characters the URL parser strips before parsing', async () => {
    // `%09` decodes to a TAB, which the WHATWG parser removes: "/\t/evil.com" passed a
    // startsWith('//') guard and then parsed as the protocol-relative "//evil.com".
    for (const raw of ['%2F%09%2Fevil.com', '%2F%0A%2Fevil.com', '%2F%0D%2Fevil.com', '%2F%09%5Cevil.com']) {
      expect(await locationFor(raw), raw).toBe(`${ORIGIN}/?auth=error&reason=x`)
    }
  })

  it('refuses everything that is not a plain same-origin path', async () => {
    for (const raw of ['%2F%2Fevil.com', '%2F%5Cevil.com', 'https%3A%2F%2Fevil.com', 'evil.com', '']) {
      expect(await locationFor(raw), raw).toBe(`${ORIGIN}/?auth=error&reason=x`)
    }
  })

  it('bounces to the root when `next` is absent', async () => {
    const res = await GET(new NextRequest(new Request(`${ORIGIN}/auth/callback?error=x`)))
    expect(res.headers.get('location')).toBe(`${ORIGIN}/?auth=error&reason=x`)
  })
})
