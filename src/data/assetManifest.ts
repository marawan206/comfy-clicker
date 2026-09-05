/**
 * Every raster asset the UI may show. Files live under public/art/<category>/<file>.
 * `src/data/assetIndex.json` (written by scripts/art-postprocess.mjs) lists which files exist,
 * so `Art` renders a designed fallback without ever requesting a missing file.
 */
export type AssetFallback =
  | { kind: 'glyph'; icon: string; tint?: string }
  | { kind: 'vendor'; icon: string }
  | { kind: 'emoji'; emoji: string }
  | { kind: 'gradient'; seed: string; glyph?: string }

export interface AssetEntry {
  id: string
  category: 'hardware' | 'models' | 'ui' | 'badges' | 'avatars' | 'thumbs' | 'map'
  file: string
  alt: string
  video?: boolean
  /** Keyword tags for prompt → thumbnail matching. */
  tags?: string[]
  fallback: AssetFallback
}

const HARDWARE: Array<[id: string, alt: string, icon: string]> = [
  ['pc-4c8t', '4c/8t office PC', 'cpu'],
  ['pc-8c16t', '8c/16t workstation', 'cpu'],
  ['mac-mini-m4', 'Mac mini M4', 'monitor'],
  ['rx-7600-xt', 'RX 7600 XT', 'microchip'],
  ['rtx-3060', 'Used RTX 3060', 'microchip'],
  ['rx-9070-xt', 'RX 9070 XT', 'microchip'],
  ['rtx-4070-ti-super', 'RTX 4070 Ti Super', 'microchip'],
  ['rtx-3090', 'RTX 3090', 'microchip'],
  ['rx-7900-xtx', 'RX 7900 XTX', 'microchip'],
  ['rtx-4090', 'RTX 4090', 'microchip'],
  ['rtx-5080', 'RTX 5080', 'microchip'],
  ['mac-studio-m4-max', 'Mac Studio M4 Max', 'monitor'],
  ['rtx-5090', 'RTX 5090', 'microchip'],
  ['radeon-pro-w7900', 'Radeon Pro W7900', 'microchip'],
  ['rtx-a6000', 'RTX A6000', 'microchip'],
  ['l4', 'NVIDIA L4', 'server'],
  ['rtx-6000-ada', 'RTX 6000 Ada', 'microchip'],
  ['a40', 'NVIDIA A40', 'server'],
  ['l40s', 'NVIDIA L40S', 'server'],
  ['rtx-pro-6000', 'RTX PRO 6000 Blackwell', 'microchip'],
  ['a100-80', 'A100 80GB', 'server'],
  ['mi300x', 'AMD MI300X', 'server'],
  ['h100-80', 'H100 80GB', 'server'],
  ['mi325x', 'AMD MI325X', 'server'],
  ['h200', 'H200', 'server'],
  ['b200', 'B200', 'server'],
  ['b300', 'B300', 'server'],
  ['aws-p4d', 'AWS p4d 8x A100 node', 'boxes'],
  ['azure-nd-mi300x', 'Azure ND MI300X v5 node', 'boxes'],
  ['aws-p5', 'AWS p5 8x H100 node', 'boxes'],
  ['aws-p5e', 'AWS p5e 8x H200 node', 'boxes'],
  ['aws-p6', 'AWS p6 8x B200 node', 'boxes'],
  ['runpod-8xb300', 'Runpod 8x B300 pod', 'boxes'],
  ['region-us-east', 'Comfy Cloud us-east region', 'cloud'],
  ['region-eu-west', 'Comfy Cloud eu-west region', 'cloud'],
  ['region-ap-southeast', 'Comfy Cloud ap-southeast region', 'cloud'],
  ['orbital-dc', 'Orbital datacenter', 'satellite'],
  ['dyson-swarm', 'Dyson compute swarm', 'sun'],
]

const MODELS: Array<[id: string, alt: string, vendor: string]> = [
  ['sd15', 'SD 1.5', 'stability-ai'],
  ['sdxl', 'SDXL', 'stability-ai'],
  ['sd35-medium', 'SD 3.5 Medium', 'stability-ai'],
  ['chroma', 'Chroma', 'ai-model'],
  ['flux-schnell', 'Flux.1 schnell', 'bfl'],
  ['flux-dev', 'Flux.1 dev', 'bfl'],
  ['flux-kontext', 'Flux Kontext', 'bfl'],
  ['hidream', 'HiDream-I1', 'ai-model'],
  ['qwen-image', 'Qwen-Image', 'ai-model'],
  ['qwen-image-edit', 'Qwen-Image-Edit', 'ai-model'],
  ['flux2', 'Flux.2', 'bfl'],
  ['wan22-5b', 'Wan 2.2 5B', 'wan'],
  ['ltx2', 'LTX-2', 'ltxv'],
  ['mochi', 'Mochi', 'ai-model'],
  ['cosmos', 'Cosmos', 'ai-model'],
  ['wan22-14b', 'Wan 2.2 14B', 'wan'],
  ['hunyuan-video-15', 'Hunyuan Video 1.5', 'tencent'],
  ['minimax-h3', 'MiniMax H3', 'minimax'],
  ['hunyuan3d-21', 'Hunyuan3D 2.1', 'tencent'],
  ['trellis', 'TRELLIS', 'ai-model'],
  ['ace-step', 'ACE-Step', 'ai-model'],
  ['stable-audio', 'Stable Audio', 'stability-ai'],
  ['kling', 'Kling', 'kling'],
  ['veo', 'Veo', 'veo'],
  ['sora', 'Sora', 'sora'],
  ['runway-gen4', 'Runway Gen-4', 'runway'],
  ['luma-ray', 'Luma Ray', 'luma'],
  ['vidu', 'Vidu', 'vidu'],
  ['hailuo', 'Hailuo', 'minimax'],
  ['ideogram', 'Ideogram', 'ideogram'],
  ['recraft', 'Recraft', 'recraft'],
  ['gpt-image', 'GPT Image', 'openai'],
  ['nano-banana', 'Nano Banana', 'gemini'],
  ['grok-imagine', 'Grok Imagine', 'grok'],
  ['flux-pro', 'Flux Pro', 'bfl'],
]

const BADGES: Array<[id: string, alt: string, icon: string]> = [
  ['badge-click', 'click badge', 'mouse-pointer-click'],
  ['badge-hardware', 'hardware badge', 'microchip'],
  ['badge-post', 'post badge', 'send'],
  ['badge-viral', 'viral badge', 'flame'],
  ['badge-quant', 'quantization badge', 'shrink'],
  ['badge-video', 'video badge', 'clapperboard'],
  ['badge-cloud', 'cloud badge', 'cloud'],
  ['badge-social', 'social badge', 'users'],
  ['badge-power', 'power badge', 'zap'],
  ['badge-season', 'season badge', 'refresh-cw'],
  ['badge-secret', 'secret badge', 'egg'],
  ['badge-money', 'credits badge', 'gem'],
]

const AVATARS: Array<[id: string, alt: string]> = [
  ['av-robot', 'a boxy robot'],
  ['av-cat-headphones', 'a cat with headphones'],
  ['av-origami-fox', 'an origami fox'],
  ['av-blob-shades', 'a yellow blob with sunglasses'],
  ['av-cactus', 'a smiling cactus'],
  ['av-retro-tv', 'a retro TV with a face'],
  ['av-jellyfish', 'a glowing jellyfish'],
  ['av-toaster', 'a chrome toaster'],
]

/** Thumbnail pools per model family; tags drive prompt matching. */
const THUMB_FAMILIES: Array<{ family: string; video?: boolean; prompts: Array<[slug: string, tags: string[]]> }> = [
  { family: 'sd15', prompts: [
    ['cat-astronaut', ['cat', 'space', 'astronaut', 'kitten']],
    ['cozy-cabin', ['cozy', 'cabin', 'snow', 'winter', 'fireplace']],
    ['cyber-samurai', ['cyberpunk', 'samurai', 'neon', 'rain', 'night', 'city']],
    ['spaghetti-graph', ['spaghetti', 'food', 'pasta', 'node', 'graph', 'workflow']],
    ['robot-flower', ['robot', 'flower', 'cute']],
    ['iso-island', ['island', 'lighthouse', 'isometric', 'ocean', 'sea']],
  ] },
  { family: 'sdxl', prompts: [
    ['grad-retriever', ['dog', 'retriever', 'puppy', 'portrait']],
    ['dew-web', ['macro', 'spider', 'web', 'sunrise', 'nature']],
    ['deco-rocket', ['rocket', 'poster', 'retro', 'space', 'art deco']],
    ['moss-owl', ['owl', 'statue', 'forest', 'rainforest', 'moss']],
    ['bento-graph', ['bento', 'food', 'sushi', 'node', 'graph']],
    ['dusk-surfer', ['surfer', 'ocean', 'dusk', 'beach', 'sunset']],
  ] },
  { family: 'flux', prompts: [
    ['glass-hummingbird', ['hummingbird', 'glass', 'bird', 'sculpture', 'studio']],
    ['planet-dessert', ['dessert', 'chef', 'food', 'planet', 'cake']],
    ['tokyo-umbrella', ['tokyo', 'alley', 'umbrella', 'fog', 'city', 'rain']],
    ['wool-spaceship', ['spaceship', 'knitted', 'wool', 'cozy', 'space']],
    ['brutalist-library', ['brutalist', 'library', 'architecture', 'building', 'concrete']],
    ['leaf-fox', ['fox', 'autumn', 'leaves', 'nature', 'animal']],
  ] },
  { family: 'qwen', prompts: [
    ['ink-village-drone', ['ink', 'village', 'mountain', 'drone', 'painting']],
    ['papercut-reef', ['coral', 'reef', 'papercut', 'ocean', 'underwater', 'fish']],
    ['floating-datacenter-poster', ['datacenter', 'poster', 'retro', 'travel', 'server']],
    ['teacup-palette', ['teacup', 'tea', 'palette', 'still life', 'cozy']],
    ['ceramic-koi-robot', ['koi', 'robot', 'ceramic', 'fish']],
    ['neon-cloud-sign', ['neon', 'cloud', 'sign', 'rain', 'wall', 'cyberpunk']],
  ] },
  { family: 'video-wan', video: true, prompts: [
    ['paper-boat-neon', ['boat', 'paper', 'neon', 'puddle', 'rain', 'city']],
    ['cat-sunbeam', ['cat', 'sunbeam', 'dust', 'cozy', 'kitten']],
    ['clouds-serverfarm', ['clouds', 'timelapse', 'server', 'datacenter', 'dawn']],
    ['coffee-nodegraph-steam', ['coffee', 'steam', 'node', 'graph', 'cozy']],
    ['fireflies-lake', ['fireflies', 'lake', 'night', 'nature']],
    ['lantern-corridor', ['lantern', 'corridor', 'dolly', 'yellow', 'glow']],
  ] },
  { family: 'video-ltx', video: true, prompts: [
    ['hummingbird-flower', ['hummingbird', 'flower', 'slow motion', 'bird']],
    ['rain-train-window', ['rain', 'train', 'window', 'city', 'night']],
    ['kickflip-garage', ['skateboard', 'kickflip', 'garage', 'urban']],
    ['marble-maze', ['marble', 'maze', 'wood', 'toy']],
    ['confetti-stage', ['confetti', 'stage', 'celebration', 'party']],
    ['rice-terraces-drone', ['drone', 'rice', 'terraces', 'landscape', 'nature']],
  ] },
  { family: 'video-hunyuan', video: true, prompts: [
    ['dragon-over-city', ['dragon', 'city', 'flight', 'fantasy']],
    ['anime-rooftop', ['anime', 'rooftop', 'sunset', 'city']],
    ['ocean-whale', ['whale', 'ocean', 'underwater', 'sea']],
    ['mech-hangar', ['mech', 'robot', 'hangar', 'sci-fi']],
    ['glitch-portrait', ['glitch', 'portrait', 'datamosh', 'face']],
    ['retro-arcade', ['retro', 'arcade', '80s', 'neon']],
  ] },
  { family: '3d', prompts: [
    ['lowpoly-corgi', ['corgi', 'dog', 'low poly', '3d', 'mesh']],
    ['retro-console', ['console', 'retro', 'game', '3d']],
    ['potted-sprout', ['plant', 'sprout', 'pot', '3d']],
    ['floating-castle', ['castle', 'floating', 'rock', 'fantasy', '3d']],
    ['cartoon-rocket', ['rocket', 'cartoon', 'space', '3d']],
    ['mech-beetle', ['beetle', 'mechanical', 'robot', 'insect', '3d']],
  ] },
  { family: 'audio', prompts: [
    ['lofi-waveform', ['lofi', 'music', 'beat', 'chill', 'song']],
    ['synthwave-waveform', ['synthwave', 'retro', 'music', '80s']],
    ['orchestra-waveform', ['orchestra', 'cinematic', 'score', 'music']],
  ] },
]

function entries(): AssetEntry[] {
  const out: AssetEntry[] = []
  for (const [id, alt, icon] of HARDWARE) out.push({ id: `hw-${id}`, category: 'hardware', file: `hardware/hw-${id}.webp`, alt, fallback: { kind: 'glyph', icon } })
  for (const [id, alt, vendor] of MODELS) out.push({ id: `model-${id}`, category: 'models', file: `models/model-${id}.webp`, alt, fallback: { kind: 'vendor', icon: vendor } })
  for (const [id, alt, icon] of BADGES) out.push({ id, category: 'badges', file: `badges/${id}.webp`, alt, fallback: { kind: 'glyph', icon, tint: 'electric' } })
  for (const [id, alt] of AVATARS) out.push({ id, category: 'avatars', file: `avatars/${id}.webp`, alt, fallback: { kind: 'gradient', seed: id, glyph: 'user' } })
  out.push({ id: 'hero-aura', category: 'ui', file: 'ui/hero-aura.webp', alt: 'aura', fallback: { kind: 'gradient', seed: 'aura' } })
  out.push({ id: 'bg-backdrop', category: 'ui', file: 'ui/bg-backdrop.webp', alt: 'backdrop', fallback: { kind: 'gradient', seed: 'backdrop' } })
  for (const fam of THUMB_FAMILIES) {
    fam.prompts.forEach(([slug, tags], i) => {
      const id = `thumb-${fam.family}-${String(i + 1).padStart(2, '0')}`
      out.push({
        id,
        category: 'thumbs',
        file: fam.video ? `thumbs/${id}.mp4` : `thumbs/${id}.webp`,
        alt: slug.replace(/-/g, ' '),
        video: fam.video,
        tags,
        fallback: { kind: 'gradient', seed: slug, glyph: fam.video ? 'clapperboard' : fam.family === '3d' ? 'box' : fam.family === 'audio' ? 'audio-lines' : 'image' },
      })
    })
  }
  for (const id of ['map-hardware', 'map-models', 'map-techniques', 'map-infra', 'map-social', 'map-regions', 'map-api', 'map-prestige', 'map-hidden']) {
    out.push({ id, category: 'map', file: `map/${id}.webp`, alt: id, fallback: { kind: 'glyph', icon: 'workflow' } })
  }
  return out
}

export const ASSET_LIST: AssetEntry[] = entries()
export const ASSETS: Record<string, AssetEntry> = Object.fromEntries(ASSET_LIST.map(a => [a.id, a]))

/** Thumbnail family for a model id (mirrors ModelDef.family; kept here so the UI never needs the catalog). */
export function thumbFamilyFor(modelId: string, kind: 'image' | 'video' | '3d' | 'audio'): string {
  if (kind === 'audio') return 'audio'
  if (kind === '3d') return '3d'
  if (kind === 'video') {
    if (modelId.startsWith('wan') || modelId === 'cosmos' || modelId === 'mochi') return 'video-wan'
    if (modelId.startsWith('ltx')) return 'video-ltx'
    return 'video-hunyuan'
  }
  if (modelId.startsWith('sd15')) return 'sd15'
  if (modelId.startsWith('sdxl') || modelId.startsWith('sd35') || modelId === 'chroma') return 'sdxl'
  if (modelId.startsWith('qwen') || modelId === 'hidream') return 'qwen'
  return 'flux'
}

export function thumbsFor(family: string): AssetEntry[] {
  return ASSET_LIST.filter(a => a.category === 'thumbs' && a.id.startsWith(`thumb-${family}-`))
}

/** Pick the thumbnail whose tags overlap the prompt the most; deterministic tie-break by prompt hash. */
export function pickThumb(family: string, prompt: string, hash: number): string {
  const pool = thumbsFor(family)
  if (!pool.length) return ''
  const words = new Set(prompt.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  let best = -1
  let bestScore = 0
  pool.forEach((a, i) => {
    const score = (a.tags ?? []).reduce((n, t) => n + (t.split(' ').every(w => words.has(w)) ? 1 : 0), 0)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  })
  return (best >= 0 ? pool[best] : pool[Math.abs(hash) % pool.length]).id
}
