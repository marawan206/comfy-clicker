/**
 * Single source of truth for generated art: one prompt per asset id in src/data/assetManifest.ts.
 * `pnpm tsx scripts/art-prompts.ts [category]` prints the submit_batch items (JSON) for the Comfy Cloud MCP.
 * Style prefixes keep every family consistent; subjects stay short and silhouette-first so icons read at 48 px.
 */
import { ASSET_LIST, type AssetEntry } from '../src/data/assetManifest'

export const STYLE_ICON =
  'Clean vector-style game icon for a casual clicker game, chunky rounded silhouette, thick soft edges, simple geometric forms, subtle soft cel shading, matte materials with one small specular highlight, light grey and gunmetal materials with electric yellow and sapphire blue accent lights, bold silhouette readable at 48 pixels, no small details, single object centered, front three-quarter view, consistent soft key light from the top-left, isolated on a fully transparent background, no ground shadow, no text, no letters, no numbers, no logos, no watermark. Subject: '

export const STYLE_BADGE =
  'Flat vector achievement medal for a casual game: a chunky hexagonal badge with a thick sapphire blue rim and an electric yellow inner face, one bold simple white pictogram centered, subtle cel shading, isolated on a fully transparent background, no text, no letters, no numbers, no watermark. Pictogram: '

export const STYLE_CARD =
  'Painterly flat-shaded illustration for a collectible game card, chunky rounded shapes, deep charcoal background, electric yellow and sapphire blue light accents with soft lavender and pink highlights, cinematic vignette, portrait composition, no text, no letters, no logos, no watermark. Subject: '

export const STYLE_AVATAR =
  'Friendly avatar portrait for a social app, centered bust, chunky rounded cartoon shapes, flat cel shading, plain dark charcoal background, one electric yellow and one sapphire blue accent, square composition, no text, no logos, no watermark. Subject: '

export const STYLE_MAP =
  'Minimal glowing glyph for a node-graph skill tree, single simple pictogram made of thick rounded strokes, electric yellow strokes on a fully transparent background, centered, no text, no letters, no watermark. Pictogram: '

const HARDWARE: Record<string, string> = {
  'pc-4c8t': 'a small beige boxy home desktop tower from 2015 with one front intake fan and a tiny green power light, humble and cute',
  'pc-8c16t': 'a black mid-tower workstation PC with a tempered-glass side panel and sapphire blue fans glowing inside, sturdier than a home PC',
  'mac-mini-m4': 'a tiny silver aluminium mini desktop computer, rounded square, flat top, one small glowing yellow dot on the front',
  'rx-7600-xt': 'a compact dual-fan graphics card with a red-and-black shroud and one small red accent light, budget and friendly',
  'rtx-3060': 'a used dual-fan graphics card, dark grey plastic shroud with a faded sticker and a little dust on one fan, gold edge connector',
  'rx-9070-xt': 'a sleek triple-fan graphics card with a black shroud and red accent strip, modern and angular',
  'rtx-4070-ti-super': 'a clean triple-fan graphics card, silver and black shroud, thin sapphire blue accent line, mid-size',
  'rtx-3090': 'a massive three-slot graphics card with a silver X-shaped shroud and a big central fan, heavy and thick',
  'rx-7900-xtx': 'a large triple-fan graphics card, black shroud with three red accent stripes, imposing',
  'rtx-4090': 'a huge triple-fan gaming graphics card with a brushed gunmetal shroud, thick exposed heatsink fins and one sapphire blue accent light strip, slightly sagging under its own weight',
  'rtx-5080': 'a slim next-generation graphics card with a matte black shroud, two flow-through fans and a thin electric yellow line, futuristic',
  'mac-studio-m4-max': 'a chunky silver aluminium studio desktop computer, rounded box twice as tall as a mini, front ports, one yellow glow',
  'rtx-5090': 'a flagship graphics card, matte black shroud with two large flow-through fans and a bright electric yellow accent line, powerful',
  'radeon-pro-w7900': 'a professional workstation graphics card, black shroud with brushed gold accents, blower-style single fan, red status light',
  'rtx-a6000': 'a professional workstation graphics card with a gold-and-black blower shroud, dense fins, one yellow status light',
  'l4': 'a slim single-slot half-height datacenter accelerator card, plain silver metal shroud with no fans, minimal',
  'rtx-6000-ada': 'a premium workstation graphics card, black shroud with brushed gold accents and a blower fan, one electric yellow light',
  'a40': 'a passively cooled datacenter graphics card, plain dark metal shroud with a sapphire blue stripe, no fans',
  'l40s': 'a passively cooled datacenter graphics card, gunmetal shroud with a bright sapphire blue stripe and one yellow light, sturdy',
  'rtx-pro-6000': 'a premium professional graphics card with a black and gold shroud, two fans and a glowing electric yellow status strip, flagship',
  'a100-80': 'a passively cooled datacenter accelerator module, thick dark heatsink block with a sapphire blue edge, industrial',
  'mi300x': 'a large square datacenter accelerator module with a red accent stripe and a thick heatsink, industrial',
  'h100-80': 'a heavy datacenter accelerator module with a huge black heatsink block and a glowing sapphire blue strip, enterprise',
  'mi325x': 'a large datacenter accelerator module with a red accent stripe and a taller heatsink, industrial and heavy',
  'h200': 'a datacenter accelerator module with a huge black heatsink block, two sapphire blue strips and one yellow light, flagship',
  'b200': 'a next-generation datacenter accelerator module, matte black block with electric yellow edges and a subtle glow, futuristic',
  'b300': 'a next-generation datacenter accelerator module, matte black block with bright electric yellow edges and two glowing strips, powerful',
  'aws-p4d': 'a wide rack server chassis with eight identical accelerator modules glowing sapphire blue side by side, heavy handles and thick power cables',
  'azure-nd-mi300x': 'a wide rack server chassis with eight identical accelerator modules glowing red side by side, heavy handles and thick cables',
  'aws-p5': 'a wide rack server chassis with eight identical accelerator modules glowing sapphire blue, orange bezel accents, bundled cables',
  'aws-p5e': 'a wide rack server chassis with eight accelerator modules glowing sapphire and yellow, orange bezel accents, bundled cables',
  'aws-p6': 'a wide rack server chassis with eight matte black accelerator modules with electric yellow edges, orange bezel accents',
  'runpod-8xb300': 'a wide rack server chassis with eight matte black accelerator modules glowing electric yellow, purple bezel accents',
  'region-us-east': 'a stylized floating cloud made of chunky server blocks with tiny datacenter buildings on top, sapphire blue and electric yellow light beams',
  'region-eu-west': 'a stylized floating cloud made of chunky server blocks with a small lighthouse on top, sapphire and yellow beams',
  'region-ap-southeast': 'a stylized floating cloud made of chunky server blocks with a small pagoda roof on top, sapphire and yellow beams',
  'orbital-dc': 'a boxy satellite datacenter with wide solar panel wings and a glowing yellow antenna dish, orbiting a small blue planet',
  'dyson-swarm': 'a ring of tiny mirrored satellites orbiting a small glowing yellow sun, symmetrical, cosmic',
}

const MODELS: Record<string, string> = {
  sd15: 'a small vintage lantern-shaped generator projecting a soft grainy low-resolution portrait, cozy nostalgic feel, warm amber glow, slightly janky charm',
  sdxl: 'a larger crystal lantern projecting a crisp bright landscape, sharper and more confident, electric yellow rim light',
  'sd35-medium': 'a three-tiered crystal lantern projecting a detailed still life, balanced and precise, blue rim light',
  chroma: 'a prism splitting one white beam into a rainbow of glowing paint strokes, playful',
  'flux-schnell': 'a quick lightning-fast swirl of glowing particles snapping into a sharp cat portrait, motion streaks',
  'flux-dev': 'a swirling flux of glowing particles converging into a sharp photoreal eye, sapphire blue ribbons of light through dark space',
  'flux-kontext': 'two glowing picture frames connected by a ribbon of light, one image flowing into the other, editing magic',
  hidream: 'a sleeping figure made of soft clouds dreaming a vivid glowing landscape above its head',
  'qwen-image': 'a calligraphy brush painting a glowing picture out of thin air, ink swirls turning into pixels, elegant',
  'qwen-image-edit': 'a calligraphy brush retouching a glowing photograph, ink strokes fixing a corner, elegant and precise',
  flux2: 'a massive swirling galaxy of glowing particles converging into a razor-sharp photoreal eye, grand scale',
  'wan22-5b': 'a short film strip flowing like a small river of glowing frames, gentle motion blur, electric yellow light trails',
  ltx2: 'a fast lightning bolt shooting through a stack of film frames, dynamic motion, sapphire electric arcs, sense of speed',
  mochi: 'a soft bouncing mochi-like blob leaving a trail of glowing film frames, playful motion',
  cosmos: 'a film strip curving around a small planet with a robot arm reaching for it, physics and simulation vibe',
  'wan22-14b': 'a wide river of glowing film frames flowing like a cinematic waterfall, anamorphic flares, grand',
  'hunyuan-video-15': 'a dragon made of flowing film frames spiraling upward, cinematic lighting, majestic',
  'minimax-h3': 'a towering wall of glowing 2K film frames with sound waves rippling through them, epic scale',
  'hunyuan3d-21': 'a matte clay sculpture of a cute geometric creature rising out of a glowing wireframe grid, soft studio lighting',
  trellis: 'a lattice of glowing voxels assembling into a small clay fox, construction in progress',
  'ace-step': 'glowing sound waves rising like steps from a small synthesizer, musical and electric',
  'stable-audio': 'a calm circular sound wave rippling on a dark pool, soft blue and yellow glow',
  kling: 'a sleek chrome camera drone filming a glowing cityscape, cinematic beams',
  veo: 'a floating film camera made of light projecting a lush jungle scene, grand and polished',
  sora: 'a swirling doorway of light opening onto an impossible dreamlike city, cinematic',
  'runway-gen4': 'a film projector on a runway of light casting a moving scene into the night',
  'luma-ray': 'a beam of light refracting through a crystal into a moving landscape, elegant',
  vidu: 'a friendly floating screen with waves of motion rippling across it, bright and clean',
  hailuo: 'a glowing whale made of light swimming through a sea of film frames',
  ideogram: 'a bold graphic poster press stamping a glowing shape onto paper, crisp and geometric',
  recraft: 'a vector pen tool drawing a glowing clean illustration with anchor points, precise',
  'gpt-image': 'a glowing rounded square generator emitting a perfectly composed photograph, clean and smart',
  'nano-banana': 'a tiny glowing banana-shaped satellite beaming a vivid picture down to earth, playful',
  'grok-imagine': 'a swirling galaxy portal generating a glowing surreal picture, bold and cosmic',
  'flux-pro': 'a swirling flux of golden particles converging into a flawless photoreal portrait, premium',
}

const BADGES: Record<string, string> = {
  'badge-click': 'a cursor pointer hand',
  'badge-hardware': 'a graphics card',
  'badge-post': 'a paper plane',
  'badge-viral': 'a flame wrapped around a heart',
  'badge-quant': 'a cube being compressed by two arrows',
  'badge-video': 'a film clapperboard',
  'badge-cloud': 'a cloud with a lightning bolt',
  'badge-social': 'three simple people silhouettes',
  'badge-power': 'a lightning bolt inside a plug',
  'badge-season': 'two circular arrows',
  'badge-secret': 'a cracked egg with a question mark shape',
  'badge-money': 'a four-pointed diamond gem',
}

const AVATARS: Record<string, string> = {
  'av-robot': 'a friendly boxy robot with round yellow eyes',
  'av-cat-headphones': 'a grey cat wearing oversized blue headphones',
  'av-origami-fox': 'an origami paper fox',
  'av-blob-shades': 'a round yellow blob wearing sunglasses',
  'av-cactus': 'a smiling cactus in a blue pot',
  'av-retro-tv': 'a retro CRT television with a happy face on the screen',
  'av-jellyfish': 'a glowing jellyfish with tiny eyes',
  'av-toaster': 'a chrome toaster with two eyes and a slice of toast',
}

const MAP: Record<string, string> = {
  'map-hardware': 'a graphics card outline',
  'map-models': 'a brain made of nodes',
  'map-techniques': 'a wrench crossed with a sparkle',
  'map-infra': 'a lightning bolt over a server rack',
  'map-social': 'a speech bubble with a heart',
  'map-regions': 'a globe with a location pin',
  'map-api': 'a plug connecting to a cloud',
  'map-prestige': 'a crown with a refresh arrow',
  'map-hidden': 'an egg with a keyhole',
}

const UI: Record<string, string> = {
  'hero-aura':
    'A soft circular energy halo made of flowing translucent ribbon-like light strands in electric yellow, sapphire blue and pastel pink, hollow empty center, wispy glowing edges, perfectly symmetrical ring, on a flat pure black background, no text, no objects',
  'bg-backdrop':
    'A very dark charcoal abstract background with faint out-of-focus glowing node-graph wires and dots, subtle bokeh, extremely low contrast, no focal object, no text, wide landscape',
}

/** Thumbnail prompts written in the voice of the tier they imitate. */
const THUMBS: Record<string, string[]> = {
  sd15: [
    'a cat astronaut floating in space, digital art, highly detailed',
    'a cozy cabin in a snowy forest at night, warm windows, artstation',
    'portrait of a cyberpunk samurai, neon rain, bokeh',
    'a bowl of spaghetti shaped like a neural network, food photography',
    'a cute robot holding a yellow flower, studio lighting',
    'an isometric tiny island with a lighthouse, pastel colors',
  ],
  sdxl: [
    'a golden retriever wearing a tiny graduation cap, 85mm portrait, shallow depth of field',
    'macro photo of a dew-covered spider web at sunrise',
    'an art-deco poster of a rocket over a city, flat colors, no text',
    'a mossy stone owl statue in a rainforest, soft light',
    'a bento box arranged like a node graph, overhead food photography',
    'a lone surfer at dusk, long exposure, golden hour',
  ],
  flux: [
    'a hyperreal glass sculpture of a hummingbird on a charcoal table, studio light',
    'an editorial photo of a chef plating a dessert shaped like a planet',
    'a foggy Tokyo alley with a single yellow umbrella, cinematic',
    'a knitted wool spaceship on a wooden shelf, cozy',
    'a brutalist concrete library with a glowing blue atrium',
    'a fox made of autumn leaves mid-jump, dynamic',
  ],
  qwen: [
    'an ink-wash painting of a mountain village with a drone hovering above',
    'a paper-cut diorama of a coral reef, layered, colorful',
    'a vintage travel poster of a floating datacenter above the clouds, no text',
    'a still life of teacups arranged as a color palette, soft light',
    'a ceramic robot koi fish on a glazed tile, product photo',
    'a neon sign shaped like a cloud on a rainy brick wall, no text',
  ],
  'video-wan': [
    'a paper boat drifting through a puddle reflecting neon city lights, slow gentle motion, 3 second loop',
    'a cat slowly blinking in a sunbeam with dust motes floating, cozy, 3 second loop',
    'time-lapse of clouds rolling over a server farm at dawn, 3 second loop',
    'a coffee cup with steam curling into tiny node-graph shapes, cozy, 3 second loop',
    'fireflies rising over a still lake at night, 3 second loop',
    'a slow dolly through a corridor of glowing yellow lanterns, 3 second loop',
  ],
  'video-ltx': [
    'a hummingbird hovering at a red flower in slow motion, 3 second loop',
    'rain droplets racing down a train window with city lights beyond, 3 second loop',
    'a skateboarder landing a kickflip in a concrete parking garage, 3 second loop',
    'a marble rolling through a wooden maze, top-down, 3 second loop',
    'confetti falling in slow motion over an empty stage, 3 second loop',
    'a drone flyover of terraced rice fields at golden hour, 3 second loop',
  ],
  'video-hunyuan': [
    'a dragon flying over a glowing city at night, cinematic, 3 second loop',
    'an anime girl on a rooftop at sunset, wind in her hair, 3 second loop',
    'a whale swimming past the camera underwater, sunbeams, 3 second loop',
    'a giant mech powering up in a hangar, sparks, 3 second loop',
    'a glitching datamosh portrait of a person, digital artifacts, 3 second loop',
    'a neon retro arcade with flickering cabinets, 80s, 3 second loop',
  ],
  '3d': [
    'a chunky low-poly corgi, matte clay render, soft studio lighting, single object on a dark charcoal turntable',
    'a stylized retro game console, matte clay render, soft studio lighting, dark charcoal turntable',
    'a sprouting potted plant, matte clay render, soft studio lighting, dark charcoal turntable',
    'a tiny stone castle on a floating rock, matte clay render, dark charcoal turntable',
    'a cartoon rocket with round fins, matte clay render, dark charcoal turntable',
    'a mechanical beetle, matte clay render, soft studio lighting, dark charcoal turntable',
  ],
  audio: [
    'a lo-fi album cover: a glowing waveform over a cozy bedroom at night, soft purple and yellow, no text',
    'a synthwave album cover: a glowing waveform over a neon grid horizon at sunset, no text',
    'an orchestral album cover: a golden waveform over a misty concert hall, no text',
  ],
}

export interface ArtJob {
  id: string
  category: AssetEntry['category']
  family?: string
  video?: boolean
  prompt: string
  /** Suggested MCP route. */
  route: 'gpt-image' | 'flux-2-pro' | 'nano-banana' | 'video-ltx' | 'video-kling' | 'video-minimax'
  size: string
}

export function artJobs(): ArtJob[] {
  const jobs: ArtJob[] = []
  for (const a of ASSET_LIST) {
    const bare = a.id.replace(/^(hw|model)-/, '')
    if (a.category === 'hardware') jobs.push({ id: a.id, category: a.category, prompt: STYLE_ICON + HARDWARE[bare], route: 'gpt-image', size: '1024x1024' })
    else if (a.category === 'models') jobs.push({ id: a.id, category: a.category, prompt: STYLE_CARD + MODELS[bare], route: 'flux-2-pro', size: '2:3' })
    else if (a.category === 'badges') jobs.push({ id: a.id, category: a.category, prompt: STYLE_BADGE + BADGES[a.id], route: 'gpt-image', size: '1024x1024' })
    else if (a.category === 'avatars') jobs.push({ id: a.id, category: a.category, prompt: STYLE_AVATAR + AVATARS[a.id], route: 'nano-banana', size: '1:1' })
    else if (a.category === 'map') jobs.push({ id: a.id, category: a.category, prompt: STYLE_MAP + MAP[a.id], route: 'gpt-image', size: '1024x1024' })
    else if (a.category === 'ui') jobs.push({ id: a.id, category: a.category, prompt: UI[a.id], route: 'flux-2-pro', size: a.id === 'bg-backdrop' ? '16:9' : '1:1' })
    else if (a.category === 'thumbs') {
      const m = a.id.match(/^thumb-(.+)-(\d\d)$/)
      if (!m) continue
      const family = m[1]
      const idx = Number(m[2]) - 1
      const prompt = THUMBS[family]?.[idx]
      if (!prompt) continue
      const video = family.startsWith('video')
      jobs.push({
        id: a.id,
        category: a.category,
        family,
        video,
        prompt,
        route: video ? (family === 'video-ltx' ? 'video-ltx' : family === 'video-wan' ? 'video-kling' : 'video-minimax') : family === '3d' ? 'flux-2-pro' : 'nano-banana',
        size: video ? '16:9' : '1:1',
      })
    }
  }
  return jobs
}

/** Turn jobs into submit_batch items for the Comfy Cloud MCP. */
export function batchItems(jobs: ArtJob[]) {
  return jobs.map(j => {
    switch (j.route) {
      case 'gpt-image':
        return { tool: 'partner_generate', type: 'image', model: 'openai/images-generations', prompt: j.prompt, description: j.id, params: { model: 'gpt-image-2.5-sunburst', size: '1024x1024', quality: 'high', background: 'transparent' } }
      case 'flux-2-pro':
        return { tool: 'partner_generate', type: 'image', model: 'bfl/flux-2-pro', prompt: j.prompt, description: j.id, aspect_ratio: j.size }
      case 'nano-banana':
        return { tool: 'partner_generate', type: 'image', model: 'vertexai/nano-banana-2', prompt: j.prompt, description: j.id, aspect_ratio: j.size }
      case 'video-ltx':
        return { tool: 'partner_generate', type: 'video', model: 'ltx/ltx-2-5-t2v', prompt: j.prompt, description: j.id, params: { model: 'LTX-2.5 (Fast)', duration: '4', resolution: '1280x720', fps: '25', generate_audio: false } }
      case 'video-kling':
        return { tool: 'partner_generate', type: 'video', model: 'kling/kling-3.0-turbo-t2v', prompt: j.prompt, description: j.id, duration: 4, resolution: '720p', aspect_ratio: '16:9' }
      case 'video-minimax':
        return { tool: 'partner_generate', type: 'video', model: 'minimax/hailuo-03-t2v', prompt: j.prompt, description: j.id, resolution: '768P', aspect_ratio: '16:9', duration: 4 }
    }
  })
}

const isMain = process.argv[1]?.endsWith('art-prompts.ts')
if (isMain) {
  const cat = process.argv[2]
  const jobs = artJobs().filter(j => !cat || j.category === cat)
  const missing = jobs.filter(j => j.prompt.endsWith(': undefined') || j.prompt.includes('undefined'))
  if (missing.length) console.error('missing subjects:', missing.map(m => m.id))
  console.log(JSON.stringify(batchItems(jobs), null, 0))
  console.error(`${jobs.length} jobs`)
}
