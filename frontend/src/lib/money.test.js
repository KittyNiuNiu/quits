import { describe, it, expect } from 'vitest'
import {
  distribute,
  parseAmountToCents,
  parseBasisPoints,
  formatCents,
  formatBasisPoints,
  formatMoney,
} from './money.js'

// --- SPEC.md §5: the required rounding table ------------------------------
// These tests are written against the specification, not the implementation.

describe('distribute() — SPEC §5 required cases', () => {
  it('1000 cents, 3 people, equal -> 334, 333, 333', () => {
    expect(distribute(1000, [1, 1, 1])).toEqual([334, 333, 333])
  })

  it('1 cent, 3 people, equal -> 1, 0, 0', () => {
    expect(distribute(1, [1, 1, 1])).toEqual([1, 0, 0])
  })

  it('10000 cents, weights 3333/3333/3334 -> 3333, 3333, 3334', () => {
    expect(distribute(10000, [3333, 3333, 3334])).toEqual([3333, 3333, 3334])
  })

  it('10000 cents, weights 3333/3333/3333 sums to 10000 and is deterministic', () => {
    const first = distribute(10000, [3333, 3333, 3333])
    expect(first.reduce((a, b) => a + b, 0)).toBe(10000)
    for (let i = 0; i < 5; i += 1) {
      expect(distribute(10000, [3333, 3333, 3333])).toEqual(first)
    }
  })
})

describe('distribute() — the sum guarantee', () => {
  // SPEC §5: "sum(distribute(t, w)) == t for all inputs"
  const totals = [0, 1, 2, 3, 7, 99, 100, 101, 999, 1000, 12345, 99999, 1000000]
  const weightSets = [
    [1],
    [1, 1],
    [1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [3333, 3333, 3334],
    [3333, 3333, 3333],
    [1, 2, 3, 4],
    [5000, 2500, 2500],
    [1, 0, 0],
    [0, 0, 1],
    [9998, 1, 1],
  ]

  for (const total of totals) {
    for (const weights of weightSets) {
      it(`sums to ${total} for weights [${weights}]`, () => {
        const parts = distribute(total, weights)
        expect(parts).toHaveLength(weights.length)
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
        expect(parts.every(Number.isInteger)).toBe(true)
      })
    }
  }

  it('holds for randomised inputs', () => {
    let seed = 42
    const rand = (n) => {
      // deterministic LCG so a failure is reproducible
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let round = 0; round < 500; round += 1) {
      const n = 1 + rand(8)
      const weights = Array.from({ length: n }, () => rand(1000))
      if (weights.reduce((a, b) => a + b, 0) === 0) weights[0] = 1
      const total = rand(500000)
      const parts = distribute(total, weights)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
    }
  })
})

describe('distribute() — leftover ordering', () => {
  // SPEC §5: leftover cents go one each in descending order of fractional
  // remainder; ties broken by ascending participant created_at, which is the
  // order the weights are passed in.
  it('gives the leftover cent to the earliest participant on a tie', () => {
    expect(distribute(10, [1, 1, 1, 1, 1, 1, 1])).toEqual([2, 2, 2, 1, 1, 1, 1])
  })

  it('prefers the larger fractional remainder over participant order', () => {
    // total 100, weights [1, 2]: base = [33, 66], remainders 1/3 and 2/3.
    // The leftover cent goes to the second participant, not the first.
    expect(distribute(100, [1, 2])).toEqual([33, 67])
  })

  it('gives nothing to a zero weight', () => {
    expect(distribute(1000, [1, 0, 1])).toEqual([500, 0, 500])
  })
})

describe('distribute() — rejected inputs', () => {
  it('rejects a negative total', () => {
    expect(() => distribute(-1, [1, 1])).toThrow()
  })

  it('rejects a non-integer total', () => {
    expect(() => distribute(10.5, [1, 1])).toThrow()
  })

  it('rejects an empty weight list', () => {
    expect(() => distribute(100, [])).toThrow()
  })

  it('rejects weights summing to zero', () => {
    expect(() => distribute(100, [0, 0])).toThrow()
  })

  it('rejects a negative weight', () => {
    expect(() => distribute(100, [2, -1])).toThrow()
  })

  it('rejects a non-integer weight', () => {
    expect(() => distribute(100, [1.5, 1])).toThrow()
  })
})

// --- Parsing and formatting ----------------------------------------------
// SPEC §5: no floating-point arithmetic touches money at any point.

describe('parseAmountToCents()', () => {
  it('parses whole amounts', () => {
    expect(parseAmountToCents('12')).toBe(1200)
  })

  it('parses two decimal places', () => {
    expect(parseAmountToCents('12.40')).toBe(1240)
  })

  it('parses one decimal place', () => {
    expect(parseAmountToCents('12.4')).toBe(1240)
  })

  it('parses a leading decimal point', () => {
    expect(parseAmountToCents('.05')).toBe(5)
  })

  it('parses amounts that a float would mangle', () => {
    // 0.1 + 0.2 territory: these must be exact.
    expect(parseAmountToCents('0.1')).toBe(10)
    expect(parseAmountToCents('0.2')).toBe(20)
    expect(parseAmountToCents('0.29')).toBe(29)
    expect(parseAmountToCents('1.005')).toBeNull()
    expect(parseAmountToCents('8.115')).toBeNull()
  })

  it('accepts grouped thousands and surrounding whitespace', () => {
    expect(parseAmountToCents(' 1,234.56 ')).toBe(123456)
    expect(parseAmountToCents('1,000,000')).toBe(100000000)
  })

  it('rejects more than two decimal places', () => {
    expect(parseAmountToCents('12.404')).toBeNull()
  })

  it('rejects junk', () => {
    expect(parseAmountToCents('')).toBeNull()
    expect(parseAmountToCents('abc')).toBeNull()
    expect(parseAmountToCents('-5')).toBeNull()
    expect(parseAmountToCents('1.2.3')).toBeNull()
    expect(parseAmountToCents('.')).toBeNull()
    expect(parseAmountToCents('1e3')).toBeNull()
    expect(parseAmountToCents(null)).toBeNull()
  })
})

describe('parseBasisPoints()', () => {
  it('parses whole percentages', () => {
    expect(parseBasisPoints('50')).toBe(5000)
    expect(parseBasisPoints('100')).toBe(10000)
  })

  it('parses fractional percentages as integer basis points', () => {
    expect(parseBasisPoints('33.33')).toBe(3333)
    expect(parseBasisPoints('0.01')).toBe(1)
    expect(parseBasisPoints('12.5')).toBe(1250)
  })

  it('rejects more than two decimal places', () => {
    expect(parseBasisPoints('33.333')).toBeNull()
  })

  it('rejects junk and negatives', () => {
    expect(parseBasisPoints('')).toBeNull()
    expect(parseBasisPoints('-1')).toBeNull()
    expect(parseBasisPoints('abc')).toBeNull()
  })
})

describe('formatCents()', () => {
  it('formats with en-US grouping and two decimals', () => {
    expect(formatCents(0)).toBe('0.00')
    expect(formatCents(5)).toBe('0.05')
    expect(formatCents(50)).toBe('0.50')
    expect(formatCents(1240)).toBe('12.40')
    expect(formatCents(123456)).toBe('1,234.56')
    expect(formatCents(100000000)).toBe('1,000,000.00')
  })

  it('formats negatives', () => {
    expect(formatCents(-123456)).toBe('-1,234.56')
    expect(formatCents(-5)).toBe('-0.05')
  })
})

describe('formatMoney()', () => {
  // SPEC §10 / §11.4: the currency label is display-only and renders as a
  // prefix, e.g. "EUR 1,234.56".
  it('prefixes the currency label', () => {
    expect(formatMoney(123456, 'EUR')).toBe('EUR 1,234.56')
    expect(formatMoney(4500, 'USD')).toBe('USD 45.00')
  })

  it('keeps the minus sign on the number, not the label', () => {
    expect(formatMoney(-4500, 'EUR')).toBe('EUR -45.00')
  })

  it('survives an empty label', () => {
    expect(formatMoney(4500, '')).toBe('45.00')
  })
})

describe('formatBasisPoints()', () => {
  it('renders basis points as a percentage string', () => {
    expect(formatBasisPoints(3333)).toBe('33.33')
    expect(formatBasisPoints(5000)).toBe('50')
    expect(formatBasisPoints(10000)).toBe('100')
    expect(formatBasisPoints(1250)).toBe('12.5')
    expect(formatBasisPoints(1)).toBe('0.01')
    expect(formatBasisPoints(0)).toBe('0')
  })
})
