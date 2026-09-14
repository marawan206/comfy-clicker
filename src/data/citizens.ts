/**
 * Handles for the citizens who run your published workflows.
 *
 * Invented on the spot from two pools and a suffix, so the hub feels populated without ever
 * borrowing a real account name. `citizens.ts` picks the parts; nothing here is balance.
 */

/** First half of a handle. ComfyUI vocabulary, a little worn. */
export const CITIZEN_PREFIXES: readonly string[] = [
  'latent',
  'vram',
  'denoise',
  'ksampler',
  'cfg',
  'lora',
  'tensor',
  'pixel',
  'noise',
  'vae',
  'clip',
  'subgraph',
  'checkpoint',
  'inpaint',
  'upscale',
  'prompt',
  'seed',
  'batch',
  'queue',
  'node',
  'fp8',
  'q4',
  'euler',
  'dpm',
  'karras',
]

/** Second half. Who they are when they are not queueing prompts. */
export const CITIZEN_SUFFIXES: readonly string[] = [
  'goblin',
  'enjoyer',
  'gremlin',
  'wizard',
  'farmer',
  'tourist',
  'hoarder',
  'apprentice',
  'sommelier',
  'archivist',
  'trucker',
  'barista',
  'lurker',
  'maximalist',
  'minimalist',
  'skeptic',
  'nomad',
  'janitor',
  'gardener',
  'librarian',
]

/** What they say in the activity list when a run lands. One is picked per run. */
export const CITIZEN_LINES: readonly string[] = [
  'ran it twice, kept the second one',
  'swapped the checkpoint and ran it anyway',
  'asked if there is a Colab version',
  'ran it on a laptop GPU, somehow',
  'left a comment that is just a fire emoji',
  'ran it at 4 steps to see what happens',
  'reported a missing custom node that is not missing',
  'ran it, then ran it again at 2x',
  'saved it to a folder called final_FINAL',
  'ran it and asked for the prompt, which is right there',
  'forked it, changed the seed, called it theirs',
  'ran the whole batch overnight',
]
