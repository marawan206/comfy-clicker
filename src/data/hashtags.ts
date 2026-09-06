import type { HashtagDef } from '@/game/types'

/**
 * Hashtag catalog. `id === tag` (no '#'). Keywords are matched on word boundaries against the
 * lowercased prompt by `matchTags`; multi-word keywords match as a phrase. `kind` tags match any
 * post of that model kind for free; `family` tags get a small affinity bonus with that model family.
 */
export const HASHTAGS: HashtagDef[] = [
  // --- ComfyUI ecosystem ------------------------------------------------------
  {
    id: 'comfyui',
    tag: 'comfyui',
    keywords: ['comfy', 'comfyui', 'workflow', 'node', 'nodes', 'spaghetti', 'graph', 'ksampler'],
  },
  {
    id: 'wan22',
    tag: 'wan22',
    family: 'wan',
    keywords: ['wan', 'wan22', 'wan2', 'moe', 'i2v', 't2v'],
  },
  {
    id: 'ltx2',
    tag: 'ltx2',
    family: 'ltx',
    keywords: ['ltx', 'ltxv', 'ltx2', 'lightricks', 'realtime'],
  },
  {
    id: 'fluxkontext',
    tag: 'fluxkontext',
    family: 'flux',
    keywords: ['flux', 'kontext', 'bfl', 'schnell', 'dev'],
  },
  {
    id: 'qwenimage',
    tag: 'qwenimage',
    family: 'qwen',
    keywords: ['qwen', 'qwenimage', 'qwen-image', 'legible', 'typography'],
  },
  {
    id: 'sd15forever',
    tag: 'sd15forever',
    family: 'sd',
    keywords: ['sd15', 'sd1.5', 'stable diffusion', '512', 'dreambooth', 'controlnet'],
  },
  {
    id: 'sdxl',
    tag: 'sdxl',
    family: 'sd',
    keywords: ['sdxl', 'xl', 'refiner', '1024', 'juggernaut'],
  },
  {
    id: 'nodegraph',
    tag: 'nodegraph',
    keywords: ['nodegraph', 'noodle', 'noodles', 'subgraph', 'reroute', 'bypass', 'wire', 'wires'],
  },
  {
    id: 'customnodes',
    tag: 'customnodes',
    keywords: ['custom node', 'custom nodes', 'customnodes', 'manager', 'missing', 'extension', 'nodepack', 'pack'],
  },
  {
    id: 'comfycloud',
    tag: 'comfycloud',
    keywords: ['cloud', 'comfy cloud', 'comfycloud', 'hosted', 'serverless', 'gpu rental'],
  },
  {
    id: 'appmode',
    tag: 'appmode',
    keywords: ['app', 'app mode', 'appmode', 'widget', 'frontend', 'linear mode'],
  },
  {
    id: 'comfyhub',
    tag: 'comfyhub',
    keywords: ['hub', 'comfyhub', 'template', 'templates', 'share', 'publish', 'remix'],
  },
  {
    id: 'loratuesday',
    tag: 'loratuesday',
    keywords: ['lora', 'loras', 'finetune', 'finetuned', 'training', 'trigger word', 'tuesday'],
  },

  // --- Type tags (free +0.2 when the post kind matches) -----------------------
  {
    id: 'videogen',
    tag: 'videogen',
    kind: 'video',
    keywords: ['video', 'clip', 'reel', 'motion', 'frames', 'animate', 'animation', 'fps'],
  },
  {
    id: '3dgen',
    tag: '3dgen',
    kind: '3d',
    keywords: ['3d', 'mesh', 'glb', 'obj', 'sculpt', 'blender', 'printable', 'texture'],
  },
  {
    id: 'musicgen',
    tag: 'musicgen',
    kind: 'audio',
    keywords: ['song', 'music', 'beat', 'beats', 'audio', 'track', 'lyrics', 'bpm', 'synth'],
  },

  // --- Subjects & aesthetics --------------------------------------------------
  {
    id: 'cyberpunk',
    tag: 'cyberpunk',
    keywords: ['neon', 'cyber', 'city', 'rain', 'night', 'cyberpunk', 'chrome', 'hologram', 'megacity'],
  },
  {
    id: 'cozy',
    tag: 'cozy',
    keywords: ['cozy', 'cabin', 'blanket', 'fireplace', 'tea', 'candle', 'hygge', 'snow', 'sweater'],
  },
  {
    id: 'cats',
    tag: 'cats',
    keywords: ['cat', 'cats', 'kitten', 'kitty', 'tabby', 'meow', 'feline'],
  },
  {
    id: 'dragons',
    tag: 'dragons',
    keywords: ['dragon', 'dragons', 'wyvern', 'drake', 'scales', 'firebreathing'],
  },
  {
    id: 'anime',
    tag: 'anime',
    keywords: ['anime', 'manga', 'waifu', 'shonen', 'ghibli', 'chibi', 'mecha', 'isekai'],
  },
  {
    id: 'retro',
    tag: 'retro',
    keywords: ['retro', 'vintage', '80s', '90s', 'vhs', 'synthwave', 'crt', 'polaroid', 'arcade'],
  },
  {
    id: 'space',
    tag: 'space',
    keywords: ['space', 'astronaut', 'galaxy', 'planet', 'rocket', 'nebula', 'stars', 'orbit', 'moon'],
  },
  {
    id: 'underwater',
    tag: 'underwater',
    keywords: ['ocean', 'sea', 'coral', 'fish', 'jellyfish', 'underwater', 'reef', 'submarine', 'whale'],
  },
  {
    id: 'portrait',
    tag: 'portrait',
    keywords: ['portrait', 'face', 'headshot', 'selfie', 'closeup', 'close-up', 'profile'],
  },
  {
    id: 'foodporn',
    tag: 'foodporn',
    keywords: ['food', 'pizza', 'ramen', 'sushi', 'dessert', 'burger', 'cake', 'coffee', 'tacos'],
  },
  {
    id: 'architecture',
    tag: 'architecture',
    keywords: ['building', 'brutalist', 'house', 'tower', 'architecture', 'skyscraper', 'cathedral', 'interior'],
  },
  {
    id: 'robots',
    tag: 'robots',
    keywords: ['robot', 'robots', 'mech', 'android', 'cyborg', 'droid', 'automaton'],
  },
  {
    id: 'glitch',
    tag: 'glitch',
    keywords: ['glitch', 'datamosh', 'corrupted', 'artifacts', 'static', 'pixelsort', 'noise'],
  },
  {
    id: 'hackathon',
    tag: 'hackathon',
    keywords: ['hackathon', 'demo', 'judges', 'deadline', 'pitch', 'prototype', 'mvp', 'ship it'],
  },
]

/** Ids in catalog order. */
export const HASHTAG_IDS: string[] = HASHTAGS.map((h) => h.id)
