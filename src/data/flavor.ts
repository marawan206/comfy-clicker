/**
 * Flavor text pools. Pure data. The UI picks from these with `pick(rng, arr)`
 * or a rotating index. Keep lines short enough for a single ticker/toast row.
 */

/** A one-tap prompt idea. `keywords` are plain words expected to hit hashtag/thumbnail keyword lists. */
export interface PromptChip {
  text: string
  keywords: string[]
}

/** Scrolling in-game news. */
export const TICKER_LINES: string[] = [
  'BREAKING: custom node updates itself, breaks three others in solidarity.',
  'Local creator discovers --lowvram flag, finally sleeps.',
  'ComfyUI-Manager reports 4,000 nodes installed. User remembers using six.',
  'Study: 94% of workflows are spaghetti. The other 6% are subgraphs hiding spaghetti.',
  "New model drops. VRAM requirement described as 'aspirational'.",
  'CUDA out of memory. CUDA also out of patience.',
  'Sage Attention adopted by everyone who could get the wheel to build.',
  'Comfy Desktop update adds a button. Community divided on the button.',
  "Trending: #wan22. Also trending: 'why is my video three seconds long'.",
  'Cloud provider announces spot pricing. Spot promptly reclaimed.',
  'RTX 5090 restock lasts eleven seconds. Scalpers thank the community.',
  'AMD user reports ROCm works. Screenshots requested. Silence.',
  "Fixed seed produces the same image twice. Reproducibility declared 'suspicious'.",
  'ComfyHub workflow hits 10k runs. Author still unsure what node 47 does.',
  'Mac Studio owner generates an image. Coffee finished first.',
  'App Mode lets clients use your workflow without seeing it. Clients relieved.',
  "Datacenter installs immersion cooling. Operator reports 'weird smell, faster'.",
  "Founder reposts a workflow. Server load described as 'a learning experience'.",
  "Negative prompt 'bad hands' removed. Hands still bad, now confident.",
  "Quantization to Q4 saves 12 GB. Output now 'painterly'.",
  'New template pack ships. Fourteen templates, one that works out of the box.',
  "Power grid operator asks local creator to 'please stop'.",
  'Comfy Cloud queue reaches zero. Engineers investigate the anomaly.',
  'TeaCache halves generation time. Purists demand the slow version back.',
  'Workflow screenshot posted. Node connections classified as abstract art.',
  'H100 rental prices drop. Wallets remain empty for unrelated reasons.',
  'xformers wheel finally matches torch version. Torch updates.',
  'Video model outputs 121 frames of a cat looking concerned. Viral.',
  'Update breaks nothing. Users confused, file bug report.',
  "LoRA trained on 12 images now considered 'the style'.",
  "Region us-comfy-1 announced. Latency: 'vibes-based'.",
  "Prompt engineer adds 'masterpiece, best quality'. Model unimpressed.",
  'Second AZ deployed. Both go down together in a show of unity.',
  'Overclocked 3060 beats expectations, loses to 3090. Order restored.',
  'Hashtag research reveals people like cats. Funding renewed.',
  'InfiniBand cable ordered. Arrives before the second GPU.',
  'Solar farm powers render farm. Weather is now a dependency.',
  'API node generates in 8 seconds. Local GPU feels judged.',
  'Kubernetes operator deployed. Nobody knows who deployed it.',
  "Analyst: 'Credits aren't real.' Credits: 'Neither is your VRAM budget.'",
]

/** One-tap prompt ideas for the studio. */
export const PROMPT_CHIPS: PromptChip[] = [
  { text: 'a cat wearing a tiny raincoat in a neon alley', keywords: ['cat', 'neon', 'cyberpunk', 'rain'] },
  { text: 'cinematic portrait, rim light, 85mm', keywords: ['portrait', 'cinematic', 'photography'] },
  { text: 'isometric cozy apartment with too many plants', keywords: ['isometric', 'cozy', 'interior', 'plants'] },
  { text: 'retro pixel art spaceship landing on a moon', keywords: ['pixel', 'retro', 'space', 'spaceship'] },
  { text: 'watercolor mountain village at dawn', keywords: ['watercolor', 'landscape', 'mountain', 'village'] },
  { text: 'anime girl eating ramen in the rain', keywords: ['anime', 'ramen', 'food', 'rain'] },
  { text: 'macro shot of a dewdrop on a spider web', keywords: ['macro', 'nature', 'photography'] },
  { text: 'brutalist concrete cathedral in fog', keywords: ['architecture', 'brutalist', 'fog', 'moody'] },
  { text: 'low poly fox in an autumn forest', keywords: ['lowpoly', 'fox', 'forest', '3d'] },
  { text: 'product shot of a sneaker floating in water', keywords: ['product', 'sneaker', 'fashion', 'water'] },
  { text: 'film noir detective under a flickering sign', keywords: ['noir', 'detective', 'cinematic', 'night'] },
  { text: 'golden hour surfer, long exposure', keywords: ['sunset', 'ocean', 'surf', 'photography'] },
  { text: 'robot barista pouring latte art', keywords: ['robot', 'coffee', 'scifi', 'cozy'] },
  { text: 'vintage car drifting through a desert highway', keywords: ['car', 'desert', 'retro', 'cinematic'] },
  { text: 'underwater city lit by bioluminescent jellyfish', keywords: ['underwater', 'ocean', 'city', 'fantasy'] },
  { text: 'oil painting of a dragon reading a newspaper', keywords: ['dragon', 'painting', 'fantasy', 'funny'] },
  { text: 'streetwear lookbook, flash photography, Tokyo', keywords: ['fashion', 'streetwear', 'tokyo', 'portrait'] },
  { text: 'cozy cabin interior, snow outside, fireplace', keywords: ['cozy', 'interior', 'winter', 'snow'] },
  { text: 'synthwave sunset over a grid horizon', keywords: ['synthwave', 'retro', 'sunset', 'neon'] },
  { text: 'claymation frog giving a TED talk', keywords: ['claymation', 'frog', 'funny', 'animation'] },
  { text: 'ancient library with floating books', keywords: ['fantasy', 'library', 'magic', 'interior'] },
  { text: 'timelapse of a flower blooming in a greenhouse', keywords: ['nature', 'flower', 'timelapse', 'plants'] },
  { text: 'top-down ramen bowl, steam rising, studio light', keywords: ['food', 'ramen', 'product', 'photography'] },
  { text: 'astronaut walking a corgi on Mars', keywords: ['space', 'astronaut', 'dog', 'funny'] },
]

/** Rotating status lines under the Generate button. */
export const CLICK_LINES: string[] = [
  'Queue Prompt',
  'Sampling step 20/20',
  'VAE decoding…',
  'Loading checkpoint (again)',
  'Prompt executed in 0.0 seconds',
  'KSampler: 100%',
  'Resolving missing custom nodes…',
  'Generating. Probably.',
  'One more, then bed.',
  'Seed: 42',
  'CFG 7. Always 7.',
  'Executing node 47',
  'Cache hit. Nice.',
  'torch.cuda.empty_cache()',
  'Saving image_00001_.png',
  'Ctrl+Enter works too',
  'Clip skip: 2',
  'Batch of one',
  'Euler a, 20 steps, karras',
  'Denoise 1.0. Living dangerously.',
]

/** Shown on a flopped post card. */
export const FLOP_LINES: string[] = [
  'Six fingers. Seven, on closer inspection.',
  'The cat has become a chair.',
  'Watermark from a stock site that no longer exists.',
  'Text reads "SNAF LRPOM". Nobody bought the poster.',
  'Posted at 3 a.m. to an audience of one bot.',
  'The algorithm saw it and looked away.',
  'Someone commented "workflow?" and left.',
  'Reposted by no one. Not even the account that reposts everything.',
  'Face detailer made the face worse. Impressively.',
  'It was a video of a static image.',
  '"Nice". One like, from you, by accident.',
  'Ratio: 1 like, 4 comments about the hands.',
  'The frame interpolation interpolated the wrong frames.',
  'Aspect ratio: wrong for every platform simultaneously.',
]

/** Shown on a viral post card. */
export const VIRAL_LINES: string[] = [
  'Reposted by three accounts you have never heard of and one you have.',
  'Comments: 400 "workflow?", 12 "is this AI", 1 "what LoRA".',
  'Somebody made a reaction video of your video.',
  'A brand asked for the "raw files". You sent the PNG.',
  'Stitched, dueted, and screenshotted into a meme.',
  'The founders saw it. The founders did not comment. The founders liked it.',
  'Your notifications are a slideshow now.',
  'A news site embedded it with the wrong credit. Still counts.',
  'Someone tried to sell it as an NFT. In this economy.',
  'Top comment: "this is why I bought a 4090". Same.',
  'Added to 2,000 collections named "inspo".',
  'A discord server was created about it. It has rules.',
  'Trending under a hashtag you did not use.',
  'Quote-tweeted by a person with a blue check and strong opinions.',
]

/** Offline earnings report headers. */
export const OFFLINE_LINES: string[] = [
  'While you were gone, the GPUs kept humming.',
  'The queue ran. The fans ran. The electricity bill ran.',
  'Comfy Sleep Mode engaged.',
  'Idle hands, busy CUDA cores.',
  'Your rig missed you. It also did not notice.',
  'Rendered in your absence. No supervision, no complaints.',
  'You left. The samplers did not.',
  'The cluster kept the lights on. Literally.',
  'Overnight batch complete. Please review 400 images.',
  'Back so soon? The 3090 had just warmed up.',
  'Uptime maintained. Snacks not.',
  'Offline, but the workflow was not.',
]

/** Loading screen / splash lines. */
export const LOADING_LINES: string[] = [
  'Loading checkpoint…',
  'Resolving custom node dependencies…',
  'Compiling ROCm kernels (38 minutes remaining)…',
  'Installing the correct torch. The other correct torch.',
  'Reticulating subgraphs…',
  'Untangling spaghetti…',
  'Warming the VAE…',
  'Reading 400 lines of red text in the console…',
  'Restarting ComfyUI. Restarting ComfyUI again.',
  'Downloading a 23 GB safetensors over hotel wifi…',
  'Checking ComfyUI-Manager for updates…',
  'Applying --lowvram out of caution…',
  'Locating the missing node from the screenshot…',
  'Pinning nodes to the canvas…',
  'Choosing a sampler. Choosing Euler anyway.',
  'Allocating VRAM optimistically…',
  'Fetching trending hashtags from a spreadsheet…',
  'Convincing xformers this is the right CUDA…',
  'Preloading the templates nobody reads…',
  'Almost there. The bar is decorative.',
]
