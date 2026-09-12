/**
 * Number/time formatting for the UI. Pure functions, locale-independent (no `Intl`), so the
 * server and the client always render the same string and never disagree during hydration.
 */

/** Short-scale suffixes for every 10^3 step above 999. Index 0 is "thousand". */
export const NUM_SUFFIXES = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No'] as const

/** Insert thousands separators into a non-negative integer string. */
function groupDigits(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Full-precision grouped integer, e.g. `1,234,567`. */
export function formatInt(n: number): string {
  if (Number.isNaN(n)) return '0'
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞'
  const r = Math.round(Math.abs(n))
  return (n < 0 && r !== 0 ? '-' : '') + groupDigits(String(r))
}

/**
 * Compact game number.
 * - `|n| < 1000` → grouped integer (`999`)
 * - otherwise a mantissa with `digits + 1` significant figures plus a suffix
 *   (`1.50K`, `15.0K`, `150K`, `1.40M`, `75.0T`, `1.00Qi`)
 * - beyond the suffix table → `1.00e33`
 * NaN → `0`, ±Infinity → `∞`. Fixed decimals so ticking counters do not jitter in width.
 */
export function formatNum(n: number, digits = 2): string {
  if (Number.isNaN(n)) return '0'
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞'

  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const rounded = Math.round(abs)
  if (rounded < 1000) return sign + groupDigits(String(rounded))

  const maxDecimals = Math.max(0, Math.floor(digits))
  let tier = Math.floor(Math.log10(abs) / 3) - 1 // 0 → K
  let mantissa = abs / 1000 ** (tier + 1)
  let text = toSigFigs(mantissa, maxDecimals)
  // Rounding can carry (999.9K → "1000K"); bump into the next suffix.
  if (Number(text) >= 1000) {
    tier += 1
    mantissa /= 1000
    text = toSigFigs(mantissa, maxDecimals)
  }

  if (tier >= NUM_SUFFIXES.length) {
    const exp = Math.floor(Math.log10(abs))
    const m = abs / 10 ** exp
    return `${sign}${m.toFixed(maxDecimals)}e${exp}`
  }
  return sign + text + NUM_SUFFIXES[tier]
}

/**
 * Format a mantissa in [1, 1000) with `maxDecimals + 1` significant figures:
 * 1.2345 → "1.23", 12.345 → "12.3", 123.45 → "123" (for maxDecimals = 2).
 */
function toSigFigs(m: number, maxDecimals: number): string {
  const intDigits = m >= 100 ? 3 : m >= 10 ? 2 : 1
  const decimals = Math.max(0, maxDecimals - (intDigits - 1))
  return m.toFixed(decimals)
}

/** Credits per second: one decimal below 10 (`3.5/s`), compact above (`1.20K/s`). */
export function formatCps(n: number): string {
  if (Number.isNaN(n)) return '0.0/s'
  if (!Number.isFinite(n)) return `${n > 0 ? '∞' : '-∞'}/s`
  if (Math.abs(n) < 10) return `${n.toFixed(1)}/s`
  return `${formatNum(n)}/s`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * Human duration from seconds: `0:42`, `3:50`, `59:59`, `1h 02m`, `23h 59m`, `2d 4h`.
 * Negative/NaN → `0:00`, Infinity → `∞`.
 */
export function formatDuration(sec: number): string {
  if (Number.isNaN(sec) || sec <= 0) return '0:00'
  if (!Number.isFinite(sec)) return '∞'
  const total = Math.floor(sec)
  if (total < 3600) {
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${pad2(s)}`
  }
  if (total < 86400) {
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    return `${h}h ${pad2(m)}m`
  }
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  return `${d}d ${h}h`
}

/**
 * Signed percentage from a fraction: `0.25` → `+25%`, `-0.1` → `-10%`, `0.125` → `+12.5%`.
 * Up to one decimal, trailing `.0` dropped. Zero renders as `+0%`.
 */
export function formatPct(x: number): string {
  if (!Number.isFinite(x)) return x > 0 ? '+∞%' : x < 0 ? '-∞%' : '+0%'
  const pct = x * 100
  const abs = Math.abs(pct)
  let text = abs.toFixed(1)
  if (text.endsWith('.0')) text = text.slice(0, -2)
  if (Number(text) === 0) return '+0%'
  return `${pct < 0 ? '-' : '+'}${text}%`
}

/** Power draw: `650 W`, `1.2 kW`, `3.4 MW`, `1.1 GW`. */
export function formatWatts(w: number): string {
  if (!Number.isFinite(w)) return Number.isNaN(w) ? '0 W' : '∞ W'
  const abs = Math.abs(w)
  const sign = w < 0 ? '-' : ''
  if (abs < 1000) return `${sign}${Math.round(abs)} W`
  if (abs < 1e6) return `${sign}${(abs / 1e3).toFixed(1)} kW`
  if (abs < 1e9) return `${sign}${(abs / 1e6).toFixed(1)} MW`
  return `${sign}${(abs / 1e9).toFixed(1)} GW`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/**
 * Compact local date for feeds/save stamps: `Sep 13`, or `Sep 13, 2025` when the year differs
 * from `now`'s year. Uses the viewer's local time zone.
 */
export function formatCompactDate(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts)) return '–'
  const d = new Date(ts)
  const month = MONTHS[d.getMonth()] ?? '???'
  const day = d.getDate()
  const year = d.getFullYear()
  const nowYear = new Date(now).getFullYear()
  return year === nowYear ? `${month} ${day}` : `${month} ${day}, ${year}`
}
