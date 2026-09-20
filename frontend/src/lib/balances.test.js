import { describe, it, expect } from 'vitest'
import { computeBalances, computeTransfers, computeTripTotal } from './balances.js'
import { sumCents } from './money.js'

const people = (...names) => names.map((name) => ({ id: name, name }))

const expense = (paidBy, amountCents, splits) => ({
  paidBy,
  amountCents,
  splits: Object.entries(splits).map(([participantId, cents]) => ({
    participantId,
    amountCents: cents,
  })),
})

describe('computeBalances() — SPEC §6', () => {
  it('nets what someone paid against what they owe', () => {
    const balances = computeBalances(people('anna', 'max'), [
      expense('anna', 1000, { anna: 500, max: 500 }),
    ])
    expect(balances).toEqual([
      { participantId: 'anna', paidCents: 1000, owedCents: 500, netCents: 500 },
      { participantId: 'max', paidCents: 0, owedCents: 500, netCents: -500 },
    ])
  })

  it('handles a payer who is not in the split', () => {
    // SPEC §4: paid_by is not constrained to be in the split. Anna buys the
    // tickets and does not go.
    const balances = computeBalances(people('anna', 'max', 'sam'), [
      expense('anna', 900, { max: 450, sam: 450 }),
    ])
    expect(balances).toEqual([
      { participantId: 'anna', paidCents: 900, owedCents: 0, netCents: 900 },
      { participantId: 'max', paidCents: 0, owedCents: 450, netCents: -450 },
      { participantId: 'sam', paidCents: 0, owedCents: 450, netCents: -450 },
    ])
  })

  it('reports zeroes for someone with no expenses at all', () => {
    const balances = computeBalances(people('anna', 'newcomer'), [
      expense('anna', 500, { anna: 500 }),
    ])
    expect(balances[1]).toEqual({
      participantId: 'newcomer',
      paidCents: 0,
      owedCents: 0,
      netCents: 0,
    })
  })

  it('always nets out to zero across the trip', () => {
    const balances = computeBalances(people('a', 'b', 'c'), [
      expense('a', 1000, { a: 334, b: 333, c: 333 }),
      expense('b', 777, { a: 259, b: 259, c: 259 }),
      expense('c', 1, { a: 1 }),
    ])
    expect(sumCents(balances.map((b) => b.netCents))).toBe(0)
  })
})

describe('computeTransfers() — SPEC §6', () => {
  const netsOf = (balances) =>
    balances.map((b) => ({ participantId: b.id, netCents: b.net }))

  it('produces a single transfer for a simple debt', () => {
    expect(
      computeTransfers(netsOf([{ id: 'anna', net: 500 }, { id: 'max', net: -500 }])),
    ).toEqual([{ fromParticipantId: 'max', toParticipantId: 'anna', amountCents: 500 }])
  })

  it('returns nothing when everyone is square', () => {
    expect(computeTransfers(netsOf([{ id: 'anna', net: 0 }, { id: 'max', net: 0 }]))).toEqual([])
  })

  it('matches the largest creditor against the largest debtor', () => {
    const transfers = computeTransfers(
      netsOf([
        { id: 'anna', net: 6000 },
        { id: 'ben', net: 1000 },
        { id: 'cal', net: -3000 },
        { id: 'dee', net: -4000 },
      ]),
    )
    expect(transfers).toEqual([
      { fromParticipantId: 'dee', toParticipantId: 'anna', amountCents: 4000 },
      { fromParticipantId: 'cal', toParticipantId: 'anna', amountCents: 2000 },
      { fromParticipantId: 'cal', toParticipantId: 'ben', amountCents: 1000 },
    ])
  })

  it('settles every debt exactly', () => {
    const balances = netsOf([
      { id: 'a', net: 1234 },
      { id: 'b', net: -500 },
      { id: 'c', net: -734 },
      { id: 'd', net: 0 },
    ])
    const transfers = computeTransfers(balances)
    const settled = new Map(balances.map((b) => [b.participantId, b.netCents]))
    for (const t of transfers) {
      settled.set(t.fromParticipantId, settled.get(t.fromParticipantId) + t.amountCents)
      settled.set(t.toParticipantId, settled.get(t.toParticipantId) - t.amountCents)
    }
    expect([...settled.values()].every((v) => v === 0)).toBe(true)
  })

  it('never needs more transfers than there are people', () => {
    const balances = netsOf([
      { id: 'a', net: 3000 },
      { id: 'b', net: 2000 },
      { id: 'c', net: -1500 },
      { id: 'd', net: -1500 },
      { id: 'e', net: -2000 },
    ])
    expect(computeTransfers(balances).length).toBeLessThanOrEqual(balances.length - 1)
  })

  it('is deterministic for tied amounts, falling back to participant order', () => {
    const balances = netsOf([
      { id: 'a', net: 1000 },
      { id: 'b', net: 1000 },
      { id: 'c', net: -1000 },
      { id: 'd', net: -1000 },
    ])
    const first = computeTransfers(balances)
    expect(computeTransfers(balances)).toEqual(first)
    expect(first[0].toParticipantId).toBe('a')
  })

  it('never invents a zero-value transfer', () => {
    const transfers = computeTransfers(
      netsOf([{ id: 'a', net: 100 }, { id: 'b', net: 0 }, { id: 'c', net: -100 }]),
    )
    expect(transfers.every((t) => t.amountCents > 0)).toBe(true)
  })
})

describe('computeTripTotal()', () => {
  it('sums every expense', () => {
    expect(computeTripTotal([{ amountCents: 1000 }, { amountCents: 250 }])).toBe(1250)
  })

  it('is zero for an empty trip', () => {
    expect(computeTripTotal([])).toBe(0)
  })
})
