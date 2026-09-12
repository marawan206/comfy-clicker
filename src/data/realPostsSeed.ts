/**
 * Real founder posts, captured verbatim on 2026-09-13. Used as the always-available backbone of the
 * in-game feed (the live fetchers refresh likes/avatars; when LinkedIn/X are unreachable these still show).
 * Pure data. No React, no fetch.
 */

export type RealPostPlatform = 'x' | 'linkedin'

export interface RealPost {
  /** Human-readable id; the feed derives its canonical `${source}:${nativeId}` from `url`. */
  id: string
  author: string
  /** Without the leading `@` (x screen name / LinkedIn profile slug). */
  handle: string
  role: string
  platform: RealPostPlatform
  url: string
  /** YYYY-MM-DD (UTC) as displayed on the platform. */
  date: string
  text: string
  likes: number
  /** Hashtag vocabulary ids (src/data/hashtags.ts). */
  tags: string[]
  capturedAt: '2026-09-13'
}

const CAPTURED_AT = '2026-09-13' as const
const YOLAND_ROLE = 'Co-founder & CEO, Comfy Org'
const ROBIN_ROLE = 'Co-founder, Comfy Org'

export const realPostsSeed: RealPost[] = [
  {
    id: 'x-yoland-2024-06-18-comfy-org',
    author: 'Yoland Yan',
    handle: 'yoland_yan',
    role: YOLAND_ROLE,
    platform: 'x',
    url: 'https://x.com/yoland_yan/status/1803104946679849253',
    date: '2024-06-18',
    text: 'Super excited for the new chapter of our journey! We are forming Comfy Org with an insane team: - comfyanonymous: creator of ComfyUI - mcmonkey4eva: creator of SwarmUI - Dr Lt Data: creator of ComfyUI-Manager - pythongosssss: major contributor of ComfyUI - robinken: creator of…',
    likes: 671,
    tags: ['comfyui', 'customnodes'],
    capturedAt: CAPTURED_AT,
  },
  {
    id: 'x-yoland-2026-03-10-more-comfy',
    author: 'Yoland Yan',
    handle: 'yoland_yan',
    role: YOLAND_ROLE,
    platform: 'x',
    url: 'https://x.com/yoland_yan/status/2031428652957839779',
    date: '2026-03-10',
    text: "ComfyUI's UI is getting more Comfy!",
    likes: 13,
    tags: ['comfyui', 'nodegraph'],
    capturedAt: CAPTURED_AT,
  },
  {
    id: 'x-yoland-2024-05-17-comfy-ci',
    author: 'Yoland Yan',
    handle: 'yoland_yan',
    role: YOLAND_ROLE,
    platform: 'x',
    url: 'https://x.com/yoland_yan/status/1791613731841175960',
    date: '2024-05-17',
    text: '🚀 Introducing Comfy CI: the ultimate CI/CD platform to streamline and automate the testing of new @ComfyUI releases. Our mission? To enhance the reliability and performance of ComfyUI',
    likes: 23,
    tags: ['comfyui'],
    capturedAt: CAPTURED_AT,
  },
  {
    id: 'x-robin-2026-06-04-super-bowl',
    author: 'Robin Huang',
    handle: 'robinjhuang',
    role: ROBIN_ROLE,
    platform: 'x',
    url: 'https://x.com/robinjhuang/status/2062579638015291586',
    date: '2026-06-04',
    text: 'The first primarily AI-generated Super Bowl ad ran on @ComfyUI.',
    likes: 4,
    tags: ['comfyui', 'videogen'],
    capturedAt: CAPTURED_AT,
  },
  {
    id: 'li-yoland-2025-08-06-creative-os',
    author: 'Yoland Y.',
    handle: 'yolandyan',
    role: YOLAND_ROLE,
    platform: 'linkedin',
    url: 'https://www.linkedin.com/posts/yolandyan_comfyui-isnt-just-a-tool-its-a-creative-activity-7358896577266012160-4WT_',
    date: '2025-08-06',
    text: "ComfyUI isn't just a tool, it's a creative operating system for AI. New models go from paper to plug-and-play in hours.",
    likes: 46,
    tags: ['comfyui', 'nodegraph'],
    capturedAt: CAPTURED_AT,
  },
  {
    id: 'li-yoland-2026-02-23-netflix',
    author: 'Yoland Y.',
    handle: 'yolandyan',
    role: YOLAND_ROLE,
    platform: 'linkedin',
    url: 'https://www.linkedin.com/posts/yolandyan_comfyui-is-now-powering-the-production-behind-activity-7431812885649010688-Krqj',
    date: '2026-02-23',
    text: 'ComfyUI is now powering the production behind multiple Netflix games. Series Entertainment, a game development studio pioneering the use of generative AI, needed to scale production across multiple Netflix titles fast.',
    likes: 181,
    tags: ['comfyui'],
    capturedAt: CAPTURED_AT,
  },
  {
    id: 'li-robin-2026-03-10-comfyrewind',
    author: 'Robin Huang',
    handle: 'robinjhuang',
    role: ROBIN_ROLE,
    platform: 'linkedin',
    url: 'https://www.linkedin.com/posts/robinjhuang_comfyrewind-activity-7437180483886678016-EnyK',
    date: '2026-03-10',
    text: "ComfyCloud just exited beta and we're giving away 100,000 in free cloud credits to celebrate. The challenge is to make a 30-second reel in ComfyUI that looks like it was pulled straight from another era: 60s, 70s, 80s, 90s, your pick…",
    likes: 67,
    tags: ['comfycloud', 'hackathon', 'retro', 'videogen'],
    capturedAt: CAPTURED_AT,
  },
  {
    id: 'li-robin-2026-03-11-lean-team',
    author: 'Robin Huang',
    handle: 'robinjhuang',
    role: ROBIN_ROLE,
    platform: 'linkedin',
    url: 'https://www.linkedin.com/posts/robinjhuang_comfyui-is-an-extremely-lean-team-and-we-activity-7437542875388645376-QvEl',
    date: '2026-03-11',
    text: 'ComfyUI is an extremely lean team and we shipped more features in the last 90 days than most teams ship in a year.',
    likes: 197,
    tags: ['comfyui'],
    capturedAt: CAPTURED_AT,
  },
  {
    id: 'li-robin-2026-04-24-30m',
    author: 'Robin Huang',
    handle: 'robinjhuang',
    role: ROBIN_ROLE,
    platform: 'linkedin',
    url: 'https://www.linkedin.com/posts/robinjhuang_we-just-closed-30-million-financing-at-a-activity-7453496735747760128-E8AA',
    date: '2026-04-24',
    text: "We just closed $30 million financing at a $500 million valuation, bringing our total funding to $47 million. The round was led by Craft Ventures, with participation from Pace Capital, Chemistry, Tru Arrow Partners, and others. Here's where the funding goes…",
    likes: 507,
    tags: ['comfyui', 'comfycloud'],
    capturedAt: CAPTURED_AT,
  },
  {
    id: 'li-robin-2026-04-27-comfyhub',
    author: 'Robin Huang',
    handle: 'robinjhuang',
    role: ROBIN_ROLE,
    platform: 'linkedin',
    url: 'https://www.linkedin.com/posts/robinjhuang_most-comfyui-users-i-know-learned-the-same-activity-7454601887116517377-y704',
    date: '2026-04-27',
    text: "Most ComfyUI users I know learned the same way: by tearing apart somebody else's workflow. That's how ComfyUI grew. Users teaching each other in Discord channels, on Twitter threads, in YouTube videos breaking down what each node does…",
    likes: 234,
    tags: ['comfyui', 'comfyhub', 'nodegraph'],
    capturedAt: CAPTURED_AT,
  },
  {
    id: 'li-robin-2026-05-06-hiring',
    author: 'Robin Huang',
    handle: 'robinjhuang',
    role: ROBIN_ROLE,
    platform: 'linkedin',
    url: 'https://www.linkedin.com/posts/robinjhuang_comfyui-just-raised-at-a-500m-valuation-activity-7457866787762774016-F7X7',
    date: '2026-05-06',
    text: "ComfyUI just raised at a $500M valuation and we're still hiring the same way we did when we had nothing. We look for people who build things, not people who look good on paper.",
    likes: 245,
    tags: ['comfyui'],
    capturedAt: CAPTURED_AT,
  },
  {
    id: 'li-robin-2026-06-04-careers',
    author: 'Robin Huang',
    handle: 'robinjhuang',
    role: ROBIN_ROLE,
    platform: 'linkedin',
    url: 'https://www.linkedin.com/posts/robinjhuang_careers-comfy-activity-7468345880585338880-Ewgu',
    date: '2026-06-04',
    text: 'The first primarily AI-generated Super Bowl ad was built on ComfyUI. Netflix, Buck, and Groove Jones build AI workflows on it too. Comfy Cloud is the infrastructure side, and we\'re hiring engineers across the team to keep building for all of them.',
    likes: 129,
    tags: ['comfyui', 'comfycloud', 'videogen'],
    capturedAt: CAPTURED_AT,
  },
]
