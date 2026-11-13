import type { DecimalMark } from '../types'

export type CellValue =
  | { kind: 'text'; text: string }
  | { kind: 'number'; value: number; decimals: number; percent: boolean }
  | { kind: 'date'; serial: number }

const CURRENCY = /^(?:€|\$|£|¥|EUR|USD|GBP|CHF)\s*|\s*(?:€|\$|£|¥|EUR|USD|GBP|CHF)$/i
const EXCEL_EPOCH_OFFSET = 25569

export function decimalMarkOf(samples: string[], fallback: DecimalMark): DecimalMark {
  let comma = 0
  let point = 0
  for (const sample of samples) {
    const s = sample.trim()
    if (/\d,\d{1,2}\s*%?$|\.\d{3},\d+/.test(s)) comma++
    else if (/\d\.\d{1,2}\s*%?$|,\d{3}\.\d+/.test(s)) point++
  }
  return comma === point ? fallback : comma > point ? ',' : '.'
}

function dateSerial(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 9999) return null
  const time = Date.UTC(year, month - 1, day)
  const check = new Date(time)
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null
  return time / 86_400_000 + EXCEL_EPOCH_OFFSET
}

function parseDate(s: string): number | null {
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s)
  if (german) return dateSerial(Number(german[3]), Number(german[2]), Number(german[1]))
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (iso) return dateSerial(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  return null
}

function normalize(raw: string): string {
  return raw
    .replace(CURRENCY, '')
    .replace(/\u2212/g, '-')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+%$/, '%')
    .trim()
}

export function parseCell(text: string, mark: DecimalMark): CellValue {
  const raw = text.trim()
  const serial = parseDate(raw)
  if (serial !== null) return { kind: 'date', serial }
  let s = normalize(raw)
  if (/\s/.test(s)) {
    if (!/^[-+(]?\d{1,3}(?: \d{3})+(?:[.,]\d+)?[%)-]?$/.test(s)) return { kind: 'text', text: raw }
    s = s.replace(/ /g, mark === ',' ? '.' : ',')
  }
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.endsWith('-') && !s.startsWith('-')) {
    negative = true
    s = s.slice(0, -1)
  }
  if (s.startsWith('-') || s.startsWith('+')) {
    negative = negative !== s.startsWith('-')
    s = s.slice(1)
  }
  const percent = s.endsWith('%')
  if (percent) s = s.slice(0, -1)
  const group = mark === ',' ? '\\.' : ','
  const decimal = mark === ',' ? ',' : '\\.'
  const pattern = new RegExp(`^(\\d{1,3}(?:${group}\\d{3})+|\\d+)(?:${decimal}(\\d+))?$`)
  const match = pattern.exec(s)
  if (!match || raw.length === 0) return { kind: 'text', text: raw }
  const whole = match[1].replace(new RegExp(group, 'g'), '')
  if ((whole.length > 1 && whole.startsWith('0')) || whole.length > 15) return { kind: 'text', text: raw }
  const fraction = match[2] ?? ''
  const value = Number(`${whole}.${fraction || '0'}`) * (negative ? -1 : 1)
  return { kind: 'number', value: percent ? value / 100 : value, decimals: fraction.length, percent }
}
