import { describe, it, expect } from 'vitest'
import { resolveSplit, deriveBasisPoints } from './splits.js'
import { sumCents } from './money.js'

// SPEC §4: the split table always stores resolved cents, whatever the mode.

describe('resolveSplit() — equal', () => {
  it('splits evenly and hands the odd cent to the earliest participant', () => {
    expect(
      resolveSplit({ amountCents: 1000, splitType: 'equal', participantIds: ['a', 'b', 'c'] }),
    ).toEqual([
      { participantId: 'a', amountCents: 334 },
      { participantId: 'b', amountCents: 333 },
      { participantId: 'c', amountCents: 333 },
    ])
  })

  it('gives one person the whole amount', () => {
    expect(resolveSplit({ amountCents: 4500, splitType: 'equal', participantIds: ['a'] })).toEqual([
      { participantId: 'a', amountCents: 4500 },
    ])
  })
})

describe('resolveSplit() — exact', () => {
  it('uses the entered amounts as the split rows without distributing', () => {
    expect(
      resolveSplit({
        amountCents: 1000,
        splitType: 'exact',
        participantIds: ['a', 'b'],
        exactCents: { a: 600, b: 400 },
      }),
    ).toEqual([
      { participantId: 'a', amountCents: 600 },
      { participantId: 'b', amountCents: 400 },
    ])
  })

  it('allows a zero row', () => {
    // SPEC §4: a split row's amount may be 0.
    expect(
      resolveSplit({
        amountCents: 1000,
        splitType: 'exact',
        participantIds: ['a', 'b'],
        exactCents: { a: 1000, b: 0 },
      }),
    ).toEqual([
      { participantId: 'a', amountCents: 1000 },
      { participantId: 'b', amountCents: 0 },
    ])
  })
})

describe('resolveSplit() — percent', () => {
  it('treats percentages as integer basis points', () => {
    expect(
      resolveSplit({
        amountCents: 10000,
        splitType: 'percent',
        participantIds: ['a', 'b', 'c'],
        basisPoints: { a: 3333, b: 3333, c: 3334 },
      }),
    ).toEqual([
      { participantId: 'a', amountCents: 3333 },
      { participantId: 'b', amountCents: 3333 },
      { participantId: 'c', amountCents: 3334 },
    ])
  })

  it('still sums to the total when the percentages do not divide cleanly', () => {
    const rows = resolveSplit({
      amountCents: 999,
      splitType: 'percent',
      participantIds: ['a', 'b', 'c'],
      basisPoints: { a: 3333, b: 3333, c: 3334 },
    })
    expect(sumCents(rows.map((r) => r.amountCents))).toBe(999)
  })

  it('gives a zero-percent participant a zero row rather than dropping them', () => {
    expect(
      resolveSplit({
        amountCents: 5000,
        splitType: 'percent',
        participantIds: ['a', 'b'],
        basisPoints: { a: 10000, b: 0 },
      }),
    ).toEqual([
      { participantId: 'a', amountCents: 5000 },
      { participantId: 'b', amountCents: 0 },
    ])
  })
})

describe('resolveSplit() — rejected inputs', () => {
  it('rejects an unknown split type', () => {
    expect(() =>
      resolveSplit({ amountCents: 100, splitType: 'weighted', participantIds: ['a'] }),
    ).toThrow()
  })

  it('rejects an empty participant list', () => {
    expect(() => resolveSplit({ amountCents: 100, splitType: 'equal', participantIds: [] })).toThrow()
  })
})

describe('deriveBasisPoints()', () => {
  // Only resolved cents are stored, so editing a percent expense has to
  // reconstruct the percentages. They must always sum to exactly 100%, or the
  // form's live indicator would open in an invalid state.
  it('round-trips a clean percentage split', () => {
    const points = deriveBasisPoints([
      { participantId: 'a', amountCents: 5000 },
      { participantId: 'b', amountCents: 2500 },
      { participantId: 'c', amountCents: 2500 },
    ])
    expect(points).toEqual({ a: 5000, b: 2500, c: 2500 })
  })

  it('always sums to exactly 10000 basis points', () => {
    const points = deriveBasisPoints([
      { participantId: 'a', amountCents: 333 },
      { participantId: 'b', amountCents: 333 },
      { participantId: 'c', amountCents: 334 },
    ])
    expect(sumCents(Object.values(points))).toBe(10000)
  })

  it('reproduces the original cents when fed back through resolveSplit', () => {
    const splits = [
      { participantId: 'a', amountCents: 3333 },
      { participantId: 'b', amountCents: 3333 },
      { participantId: 'c', amountCents: 3334 },
    ]
    const basisPoints = deriveBasisPoints(splits)
    expect(
      resolveSplit({
        amountCents: 10000,
        splitType: 'percent',
        participantIds: ['a', 'b', 'c'],
        basisPoints,
      }),
    ).toEqual(splits)
  })

  it('handles an all-zero split without dividing by zero', () => {
    expect(deriveBasisPoints([{ participantId: 'a', amountCents: 0 }])).toEqual({ a: 0 })
  })
})
