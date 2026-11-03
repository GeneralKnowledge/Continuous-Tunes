/**
 * Numbers, ordinals, years, times and money as British English words.
 * ("one hundred and five", "twenty twenty-six", "five pounds fifty", "the third of November")
 */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES: [number, string][] = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
]

function under100(n: number): string {
  if (n < 20) return ONES[n]!
  const t = TENS[Math.floor(n / 10)]!
  return n % 10 ? `${t}-${ONES[n % 10]}` : t
}

function under1000(n: number, andIfNoHundreds = false): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h === 0) return andIfNoHundreds && r ? `and ${under100(r)}` : under100(r)
  return r ? `${ONES[h]} hundred and ${under100(r)}` : `${ONES[h]} hundred`
}

/** Cardinal number in words, British style ("and" after hundreds). Integers only. */
export function cardinal(n: number): string {
  if (!Number.isFinite(n)) return 'infinity'
  if (n < 0) return `minus ${cardinal(-n)}`
  n = Math.floor(n)
  if (n < 1000) return under1000(n)
  if (n >= 1e15) return digits(String(n))
  const parts: string[] = []
  let rest = n
  for (const [size, name] of SCALES) {
    if (rest >= size) {
      parts.push(`${cardinal(Math.floor(rest / size))} ${name}`)
      rest %= size
    }
  }
  // "one thousand and five": a remainder below 100 after a larger scale takes "and"
  if (rest) parts.push(under1000(rest, rest < 100))
  return parts.join(' ')
}

const ORDINAL_WORDS: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth',
  twelve: 'twelfth',
}

/** "twenty-one" → "twenty-first" */
export function ordinalWord(words: string): string {
  const m = /^(.*?)([a-z]+)$/.exec(words)
  if (!m) return words
  const [, head, last] = m as unknown as [string, string, string]
  let ord: string
  if (ORDINAL_WORDS[last]) ord = ORDINAL_WORDS[last]
  else if (last.endsWith('y')) ord = last.slice(0, -1) + 'ieth'
  else ord = last + 'th'
  return head + ord
}

export function ordinal(n: number): string {
  return ordinalWord(cardinal(n))
}

/** Digit by digit, with "oh" for zero (phone numbers, decimals). */
export function digits(s: string, zero = 'oh'): string {
  return [...s]
    .filter((ch) => ch >= '0' && ch <= '9')
    .map((ch) => (ch === '0' ? zero : ONES[Number(ch)]))
    .join(' ')
}

/** Years as people say them: 1984 "nineteen eighty-four", 2005 "two thousand and five", 2026 "twenty twenty-six". */
export function year(n: number): string {
  if (n < 1000 || n >= 10000) return cardinal(n)
  const hi = Math.floor(n / 100)
  const lo = n % 100
  if (n >= 2000 && n < 2010) return cardinal(n)
  if (lo === 0) return n % 1000 === 0 ? cardinal(n) : `${under100(hi)} hundred`
  if (lo < 10) return `${under100(hi)} oh ${ONES[lo]}`
  return `${under100(hi)} ${under100(lo)}`
}

/** "3.14" → "three point one four"; "-2.5" → "minus two point five". */
export function decimal(text: string): string {
  const neg = text.startsWith('-')
  const [int = '0', frac = ''] = text.replace(/^-/, '').replace(/,/g, '').split('.')
  const head = cardinal(Number(int))
  const tail = frac ? ` point ${digits(frac, 'zero')}` : ''
  return (neg ? 'minus ' : '') + head + tail
}

export const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december',
]

/** "the third of November twenty twenty-six" (British day-month order). */
export function date(day: number, month: number, yr?: number): string {
  const m = MONTHS[month - 1]
  if (!m || day < 1 || day > 31) return [cardinal(day), cardinal(month), yr ? cardinal(yr) : ''].join(' ').trim()
  return `the ${ordinal(day)} of ${m}${yr !== undefined ? ` ${year(yr)}` : ''}`
}

/** 24-hour or 12-hour clock: "10:30" "ten thirty", "9:05" "nine oh five", "12:00" "twelve o'clock". */
export function clock(h: number, m: number): string {
  if (m === 0) return `${cardinal(h)} o'clock`
  if (m < 10) return `${cardinal(h)} oh ${ONES[m]}`
  return `${cardinal(h)} ${under100(m)}`
}

const CURRENCIES: Record<string, [major: string, majorPlural: string, minor: string, minorPlural: string]> = {
  '£': ['pound', 'pounds', 'penny', 'pence'],
  $: ['dollar', 'dollars', 'cent', 'cents'],
  '€': ['euro', 'euros', 'cent', 'cents'],
}

/** "£5.50" → "five pounds fifty"; "$1" → "one dollar"; "£0.75" → "seventy-five pence". */
export function money(symbol: string, amount: string): string {
  const cur = CURRENCIES[symbol]
  const clean = amount.replace(/,/g, '')
  if (!cur) return decimal(clean)
  const [major, majors, minor, minors] = cur
  const [intPart = '0', fracPart = ''] = clean.split('.')
  const units = Number(intPart)
  const cents = fracPart ? Number(fracPart.padEnd(2, '0').slice(0, 2)) : 0
  if (units === 0 && cents > 0) return `${cardinal(cents)} ${cents === 1 ? minor : minors}`
  const head = `${cardinal(units)} ${units === 1 ? major : majors}`
  return cents ? `${head} ${cardinal(cents)}` : head
}
