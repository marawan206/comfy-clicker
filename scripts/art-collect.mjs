#!/usr/bin/env node
/**
 * Download ready outputs from a saved get_batch_output JSON into art-src/<category>/<label>.<ext>.
 *   node scripts/art-collect.mjs <batch-output.json> [--force]
 * Category is derived from the label prefix (hw-, badge-, map-, model-, av-, thumb-, hero-aura, bg-backdrop).
 */
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const [file, ...flags] = process.argv.slice(2)
const force = flags.includes('--force')
const data = JSON.parse(readFileSync(file, 'utf8'))
const outputs = data.outputs ?? []

function categoryFor(label) {
  if (label.startsWith('hw-')) return 'hardware'
  if (label.startsWith('badge-')) return 'badges'
  if (label.startsWith('map-')) return 'map'
  if (label.startsWith('model-')) return 'models'
  if (label.startsWith('av-')) return 'avatars'
  if (label.startsWith('thumb-')) return 'thumbs'
  if (label === 'hero-aura' || label === 'bg-backdrop') return 'ui'
  return 'misc'
}

function fieldsOf(o) {
  // Tolerate a few plausible shapes: {label, url, filename} or {job_label, results:[{url, filename}]}
  let label = o.label ?? o.job_label ?? o.description ?? o.job?.label
  if (!label && o.suggested_save_path) label = o.suggested_save_path.match(/comfy_(.+?)(?:-\d+)?\.\w+$/)?.[1]
  if (!label && o.filename_prefix) label = o.filename_prefix.replace(/^comfy_partner_[^_]+_/, '')
  const results = o.results ?? o.files ?? (o.url ? [o] : [])
  return { label, results }
}

let done = 0, skipped = 0, failed = 0
const queue = []
for (const o of outputs) {
  const { label, results } = fieldsOf(o)
  if (!label) { console.warn('no label for output', JSON.stringify(o).slice(0, 120)); continue }
  results.forEach((r, i) => {
    const url = r.url ?? r.download_url
    if (!url) return
    const name = r.filename ?? r.suggested_save_path ?? ''
    const ext = (name.match(/\.(png|jpg|jpeg|webp|mp4|webm|gif)$/i)?.[1] ?? (url.includes('video') ? 'mp4' : 'png')).toLowerCase()
    const suffix = results.length > 1 ? `-${i + 1}` : ''
    const dir = path.join('art-src', categoryFor(label))
    mkdirSync(dir, { recursive: true })
    const dest = path.join(dir, `${label}${suffix}.${ext}`)
    queue.push({ url, dest, label })
  })
}

async function run(job) {
  if (!force && existsSync(job.dest) && statSync(job.dest).size > 1000) { skipped++; return }
  try {
    execFileSync('curl', ['-sL', '--fail-with-body', '--retry', '3', '--retry-delay', '1', '--connect-timeout', '20', '-o', job.dest + '.part', job.url], { stdio: 'pipe' })
    execFileSync('mv', ['-f', job.dest + '.part', job.dest])
    done++
  } catch (e) {
    failed++
    console.error('failed', job.label, String(e.message).slice(0, 120))
  }
}

const CONCURRENCY = 4
let idx = 0
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (idx < queue.length) {
    const job = queue[idx++]
    await run(job)
  }
}))
console.log(`downloaded ${done}, skipped ${skipped}, failed ${failed}, pending in batch: ${(data.pending ?? []).length}`)
