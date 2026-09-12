import { describe, expect, it } from 'vitest'
import {
  formatCompactDate,
  formatCps,
  formatDuration,
  formatInt,
  formatNum,
  formatPct,
  formatWatts,
} from '@/game/format'

describe('formatNum', () => {
  it('renders plain integers below 1000', () => {
    expect(formatNum(0)).toBe('0')
    expect(formatNum(7)).toBe('7')
    expect(formatNum(999)).toBe('999')
    expect(formatNum(42.7)).toBe('43')
  })

  it('switches to K at 1000 with 3 significant figures', () => {
    expect(formatNum(1000)).toBe('1.00K')
    expect(formatNum(1500)).toBe('1.50K')
    expect(formatNum(15_000)).toBe('15.0K')
    expect(formatNum(150_000)).toBe('150K')
  })

  it('walks the suffix ladder', () => {
    expect(formatNum(1.4e6)).toBe('1.40M')
    expect(formatNum(2.5e9)).toBe('2.50B')
    expect(formatNum(7.5e13)).toBe('75.0T')
    expect(formatNum(1e15)).toBe('1.00Qa')
    expect(formatNum(1e18)).toBe('1.00Qi')
    expect(formatNum(1e21)).toBe('1.00Sx')
    expect(formatNum(1e24)).toBe('1.00Sp')
    expect(formatNum(1e27)).toBe('1.00Oc')
    expect(formatNum(1e30)).toBe('1.00No')
  })

  it('falls back to exponent notation past the table', () => {
    expect(formatNum(1e33)).toBe('1.00e33')
    expect(formatNum(4.2e35)).toBe('4.20e35')
  })

  it('carries rounding into the next suffix', () => {
    expect(formatNum(999_999)).toBe('1.00M')
    expect(formatNum(999.6)).toBe('1.00K')
    expect(formatNum(999.4)).toBe('999')
  })

  it('honours the digits argument', () => {
    expect(formatNum(1500, 0)).toBe('2K')
    expect(formatNum(1500, 1)).toBe('1.5K')
    expect(formatNum(15_500, 1)).toBe('16K')
    expect(formatNum(1234.6, 3)).toBe('1.235K')
  })

  it('handles negatives, NaN and infinities', () => {
    expect(formatNum(-1500)).toBe('-1.50K')
    expect(formatNum(-42)).toBe('-42')
    expect(formatNum(NaN)).toBe('0')
    expect(formatNum(Infinity)).toBe('∞')
    expect(formatNum(-Infinity)).toBe('-∞')
  })
})

describe('formatInt', () => {
  it('groups thousands', () => {
    expect(formatInt(999)).toBe('999')
    expect(formatInt(1000)).toBe('1,000')
    expect(formatInt(1_234_567.4)).toBe('1,234,567')
    expect(formatInt(-1_234_567)).toBe('-1,234,567')
    expect(formatInt(NaN)).toBe('0')
  })
})

describe('formatCps', () => {
  it('shows one decimal below 10', () => {
    expect(formatCps(0)).toBe('0.0/s')
    expect(formatCps(0.25)).toBe('0.3/s')
    expect(formatCps(3.14)).toBe('3.1/s')
    expect(formatCps(9.99)).toBe('10.0/s')
  })

  it('uses compact numbers at 10 and above', () => {
    expect(formatCps(10)).toBe('10/s')
    expect(formatCps(999)).toBe('999/s')
    expect(formatCps(1200)).toBe('1.20K/s')
    expect(formatCps(NaN)).toBe('0.0/s')
  })
})

describe('formatDuration', () => {
  it('formats m:ss under an hour', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(42)).toBe('0:42')
    expect(formatDuration(230)).toBe('3:50')
    expect(formatDuration(3599)).toBe('59:59')
    expect(formatDuration(65.9)).toBe('1:05')
  })

  it('formats hours and minutes under a day', () => {
    expect(formatDuration(3600)).toBe('1h 00m')
    expect(formatDuration(3720)).toBe('1h 02m')
    expect(formatDuration(86_399)).toBe('23h 59m')
  })

  it('formats days and hours', () => {
    expect(formatDuration(86_400)).toBe('1d 0h')
    expect(formatDuration(2 * 86_400 + 4 * 3600 + 59 * 60)).toBe('2d 4h')
  })

  it('handles garbage', () => {
    expect(formatDuration(-5)).toBe('0:00')
    expect(formatDuration(NaN)).toBe('0:00')
    expect(formatDuration(Infinity)).toBe('∞')
  })
})

describe('formatPct', () => {
  it('signs and trims', () => {
    expect(formatPct(0.25)).toBe('+25%')
    expect(formatPct(-0.1)).toBe('-10%')
    expect(formatPct(0.125)).toBe('+12.5%')
    expect(formatPct(0)).toBe('+0%')
    expect(formatPct(2)).toBe('+200%')
  })
})

describe('formatWatts', () => {
  it('scales units', () => {
    expect(formatWatts(650)).toBe('650 W')
    expect(formatWatts(1200)).toBe('1.2 kW')
    expect(formatWatts(3_400_000)).toBe('3.4 MW')
    expect(formatWatts(1.1e9)).toBe('1.1 GW')
    expect(formatWatts(0)).toBe('0 W')
  })
})

describe('formatCompactDate', () => {
  it('omits the year when it matches now', () => {
    const now = new Date(2026, 8, 13, 12).getTime()
    expect(formatCompactDate(new Date(2026, 8, 13).getTime(), now)).toBe('Sep 13')
    expect(formatCompactDate(new Date(2026, 0, 1).getTime(), now)).toBe('Jan 1')
  })

  it('appends the year otherwise', () => {
    const now = new Date(2026, 8, 13, 12).getTime()
    expect(formatCompactDate(new Date(2025, 11, 31).getTime(), now)).toBe('Dec 31, 2025')
    expect(formatCompactDate(NaN, now)).toBe('–')
  })
})
