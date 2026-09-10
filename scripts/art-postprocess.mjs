#!/usr/bin/env node
/**
 * Turns raw MCP output in art-src/ into serving assets in public/art/ and refreshes src/data/assetIndex.json.
 *   art-src/<category>/<id>.png            -> public/art/<category>/<id>.webp (resized per category)
 *   art-src/sheets/<sheet>.png + <sheet>.json ({ cols, rows, ids[] }) -> sliced cells -> public/art/<category>/<id>.webp
 *   art-src/thumbs/<id>.mp4                -> copied (already ≤ 640px) + poster <id>.webp from first frame is NOT extracted (browser shows frame 0)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { execFileSync } from 'node:child_process'

function hasFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false }
}
const FFMPEG = hasFfmpeg()

const SIZES = { hardware: 256, models: [352, 528], ui: 1024, badges: 192, avatars: 160, thumbs: 512, map: 128 }
const SRC = 'art-src'
const OUT = 'public/art'

async function convert(input, category, id) {
  const outDir = path.join(OUT, category)
  mkdirSync(outDir, { recursive: true })
  const size = SIZES[category] ?? 512
  let img = sharp(input)
  if (Array.isArray(size)) img = img.resize(size[0], size[1], { fit: 'cover' })
  else img = img.resize(size, size, { fit: 'inside', withoutEnlargement: true })
  await img.webp({ quality: 84, alphaQuality: 90 }).toFile(path.join(outDir, `${id}.webp`))
}

async function sliceSheet(sheetPng, meta) {
  const { cols, rows, ids, category } = meta
  const image = sharp(sheetPng)
  const { width, height } = await image.metadata()
  const cw = Math.floor(width / cols)
  const ch = Math.floor(height / rows)
  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = ids[i++]
      if (!id) continue
      const tmp = path.join(SRC, 'sheets', `.cell-${id}.png`)
      await sharp(sheetPng).extract({ left: c * cw, top: r * ch, width: cw, height: ch }).trim({ threshold: 8 }).toFile(tmp)
      await convert(tmp, category, id)
    }
  }
}

async function main() {
  if (!existsSync(SRC)) return console.log('no art-src/ directory')
  for (const category of readdirSync(SRC)) {
    const dir = path.join(SRC, category)
    if (category === 'sheets') {
      for (const f of readdirSync(dir).filter(f => f.endsWith('.png') && !f.startsWith('.cell-'))) {
        const metaPath = path.join(dir, f.replace(/\.png$/, '.json'))
        if (!existsSync(metaPath)) { console.warn(`sheet without meta: ${f}`); continue }
        await sliceSheet(path.join(dir, f), JSON.parse(readFileSync(metaPath, 'utf8')))
      }
      continue
    }
    for (const f of readdirSync(dir)) {
      const id = f.replace(/\.(png|jpg|jpeg|webp|mp4)$/i, '')
      if (/\.mp4$/i.test(f)) {
        mkdirSync(path.join(OUT, category), { recursive: true })
        const dest = path.join(OUT, category, f)
        if (FFMPEG) {
          // 640 px wide, muted, web-optimised H.264 (~300–600 KB for a 4 s loop)
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, f), '-an', '-vf', 'scale=640:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dest])
        } else {
          copyFileSync(path.join(dir, f), dest)
        }
      } else if (/\.(png|jpg|jpeg|webp)$/i.test(f)) {
        await convert(path.join(dir, f), category, id)
      }
    }
  }
  const index = []
  if (existsSync(OUT)) for (const cat of readdirSync(OUT)) for (const f of readdirSync(path.join(OUT, cat))) index.push(`${cat}/${f}`)
  writeFileSync('src/data/assetIndex.json', JSON.stringify(index.sort(), null, 2) + '\n')
  console.log(`assetIndex.json: ${index.length} files`)
}
main().catch(e => { console.error(e); process.exit(1) })
