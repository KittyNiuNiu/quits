import { describe, it, expect, beforeEach } from 'vitest'
import { mockBackend as backend, resetMockBackend } from './mockBackend.js'
import { ErrorCode } from './errors.js'
import { sumCents } from '../lib/money.js'

beforeEach(() => {
  resetMockBackend()
})

async function newTrip(overrides = {}) {
  return backend.createTrip({
    name: 'Lisbon',
    currencyLabel: 'EUR',
    creatorName: 'Anna',
    ...overrides,
  })
}

/** Expect a rejected call and return the ApiError for further assertions. */
async function failsWith(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  )
  expect(error, `expected the call to reject with ${code}`).not.toBeNull()
  expect(error.code).toBe(code)
  return error
}

describe('createTrip — SPEC §7.1', () => {
  it('returns the trip and the creator as participant #1', async () => {
    const { trip, participant } = await newTrip()
    expect(trip.name).toBe('Lisbon')
    expect(trip.currencyLabel).toBe('EUR')
    expect(participant.name).toBe('Anna')

    const view = await backend.getTrip(trip.token)
    expect(view.participants).toHaveLength(1)
    expect(view.participants[0].id).toBe(participant.id)
  })

  it('issues a URL-safe token of at least 128 bits', async () => {
    const { trip } = await newTrip()
    // SPEC §4: cryptographically random, >= 128 bits, URL-safe. 22 base64url
    // characters carry 132 bits.
    expect(trip.token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(trip.token.length).toBeGreaterThanOrEqual(22)
  })

  it('issues a different token for every trip', async () => {
    const a = await newTrip()
    const b = await newTrip({ name: 'Porto' })
    expect(a.trip.token).not.toBe(b.trip.token)
  })

  it('defaults the currency label to EUR', async () => {
    const { trip } = await newTrip({ currencyLabel: '   ' })
    expect(trip.currencyLabel).toBe('EUR')
  })

  it('rejects an empty trip name', async () => {
    await failsWith(newTrip({ name: '   ' }), ErrorCode.TRIP_NAME_EMPTY)
  })

  it('rejects an empty creator name', async () => {
    await failsWith(newTrip({ creatorName: '  ' }), ErrorCode.NAME_EMPTY)
  })

  it('trims whitespace off names', async () => {
    const { trip, participant } = await newTrip({ name: '  Lisbon  ', creatorName: '  Anna ' })
    expect(trip.name).toBe('Lisbon')
    expect(participant.name).toBe('Anna')
  })
})

describe('getTrip — SPEC §7.2', () => {
  it('rejects an unknown token', async () => {
    await failsWith(backend.getTrip('not-a-real-token'), ErrorCode.NOT_FOUND)
  })

  it('is readable without any identity', async () => {
    // SPEC §11.5: the read-only preview comes before the join screen.
    const { trip } = await newTrip()
    const view = await backend.getTrip(trip.token)
    expect(view.trip.name).toBe('Lisbon')
  })

  it('does not hand back a mutable reference to its own store', async () => {
    const { trip } = await newTrip()
    const view = await backend.getTrip(trip.token)
    view.participants[0].name = 'Tampered'
    const again = await backend.getTrip(trip.token)
    expect(again.participants[0].name).toBe('Anna')
  })
})

describe('joinTrip — SPEC §7.5 and §3', () => {
  it('adds a participant', async () => {
    const { trip } = await newTrip()
    const max = await backend.joinTrip(trip.token, 'Max')
    const view = await backend.getTrip(trip.token)
    expect(view.participants.map((p) => p.name)).toEqual(['Anna', 'Max'])
    expect(max.id).toBeTruthy()
  })

  it('rejects a taken name', async () => {
    const { trip } = await newTrip()
    const error = await failsWith(backend.joinTrip(trip.token, 'Anna'), ErrorCode.NAME_TAKEN)
    expect(error.message).toMatch(/taken/i)
  })

  it('compares names case-insensitively after trimming', async () => {
    const { trip } = await newTrip()
    await failsWith(backend.joinTrip(trip.token, '  aNNa  '), ErrorCode.NAME_TAKEN)
  })

  it('accepts a distinguishing suffix', async () => {
    // SPEC §3: the app tells the visitor to add a suffix rather than asking
    // "is this you?".
    const { trip } = await newTrip()
    const other = await backend.joinTrip(trip.token, 'Anna B')
    expect(other.name).toBe('Anna B')
  })

  it('rejects an empty name', async () => {
    const { trip } = await newTrip()
    await failsWith(backend.joinTrip(trip.token, '   '), ErrorCode.NAME_EMPTY)
  })

  it('orders participants by creation, which is what rounding ties use', async () => {
    const { trip } = await newTrip()
    await backend.joinTrip(trip.token, 'Max')
    await backend.joinTrip(trip.token, 'Sam')
    const view = await backend.getTrip(trip.token)
    expect(view.participants.map((p) => p.name)).toEqual(['Anna', 'Max', 'Sam'])
  })
})

describe('claimParticipant — SPEC §7.6', () => {
  it('binds to the existing participant instead of creating one', async () => {
    const { trip, participant } = await newTrip()
    const claimed = await backend.claimParticipant(trip.token, 'Anna')
    expect(claimed.id).toBe(participant.id)

    const view = await backend.getTrip(trip.token)
    expect(view.participants).toHaveLength(1)
  })

  it('matches case-insensitively', async () => {
    const { trip, participant } = await newTrip()
    const claimed = await backend.claimParticipant(trip.token, '  anna ')
    expect(claimed.id).toBe(participant.id)
  })

  it('rejects a name nobody in the trip uses', async () => {
    const { trip } = await newTrip()
    await failsWith(backend.claimParticipant(trip.token, 'Nobody'), ErrorCode.NOT_FOUND)
  })
})

describe('renameParticipant — SPEC §7.7', () => {
  it('renames', async () => {
    const { trip, participant } = await newTrip()
    await backend.renameParticipant(trip.token, participant.id, 'Anna K')
    const view = await backend.getTrip(trip.token)
    expect(view.participants[0].name).toBe('Anna K')
  })

  it('applies the same uniqueness check', async () => {
    const { trip } = await newTrip()
    const max = await backend.joinTrip(trip.token, 'Max')
    await failsWith(
      backend.renameParticipant(trip.token, max.id, 'anna'),
      ErrorCode.NAME_TAKEN,
    )
  })

  it('lets someone keep their own name, only recased', async () => {
    const { trip, participant } = await newTrip()
    const renamed = await backend.renameParticipant(trip.token, participant.id, 'ANNA')
    expect(renamed.name).toBe('ANNA')
  })

  it('rejects an empty name', async () => {
    const { trip, participant } = await newTrip()
    await failsWith(backend.renameParticipant(trip.token, participant.id, ' '), ErrorCode.NAME_EMPTY)
  })

  it('keeps expenses attached through a rename', async () => {
    const { trip, participant } = await newTrip()
    await backend.createExpense(trip.token, {
      description: 'Taxi',
      amountCents: 1000,
      paidBy: participant.id,
      splitType: 'equal',
      participantIds: [participant.id],
      createdBy: participant.id,
    })
    await backend.renameParticipant(trip.token, participant.id, 'Anna K')
    const view = await backend.getTrip(trip.token)
    expect(view.balances[0].paidCents).toBe(1000)
  })
})

describe('deleteParticipant — SPEC §7.8', () => {
  it('removes someone who never took part', async () => {
    const { trip } = await newTrip()
    const curious = await backend.joinTrip(trip.token, 'Curious')
    await backend.deleteParticipant(trip.token, curious.id)
    const view = await backend.getTrip(trip.token)
    expect(view.participants.map((p) => p.name)).toEqual(['Anna'])
  })

  it('refuses someone who is in a split', async () => {
    const { trip, participant } = await newTrip()
    const max = await backend.joinTrip(trip.token, 'Max')
    await backend.createExpense(trip.token, {
      description: 'Dinner',
      amountCents: 1000,
      paidBy: participant.id,
      splitType: 'equal',
      participantIds: [participant.id, max.id],
      createdBy: participant.id,
    })
    const error = await failsWith(
      backend.deleteParticipant(trip.token, max.id),
      ErrorCode.PARTICIPANT_IN_USE,
    )
    expect(error.details.splitCount).toBe(1)
  })

  it('refuses someone who paid but is not in the split', async () => {
    const { trip, participant } = await newTrip()
    const max = await backend.joinTrip(trip.token, 'Max')
    await backend.createExpense(trip.token, {
      description: 'Tickets',
      amountCents: 900,
      paidBy: max.id,
      splitType: 'equal',
      participantIds: [participant.id],
      createdBy: participant.id,
    })
    const error = await failsWith(
      backend.deleteParticipant(trip.token, max.id),
      ErrorCode.PARTICIPANT_IN_USE,
    )
    expect(error.details.paidCount).toBe(1)
    expect(error.details.splitCount).toBe(0)
  })

  it('allows removal once the last expense is gone', async () => {
    const { trip, participant } = await newTrip()
    const max = await backend.joinTrip(trip.token, 'Max')
    const expense = await backend.createExpense(trip.token, {
      description: 'Dinner',
      amountCents: 1000,
      paidBy: participant.id,
      splitType: 'equal',
      participantIds: [participant.id, max.id],
      createdBy: participant.id,
    })
    await backend.deleteExpense(trip.token, expense.id)
    await backend.deleteParticipant(trip.token, max.id)
    const view = await backend.getTrip(trip.token)
    expect(view.participants).toHaveLength(1)
  })
})

describe('createExpense — SPEC §7.10 and §8', () => {
  async function tripWithThree() {
    const { trip, participant: anna } = await newTrip()
    const max = await backend.joinTrip(trip.token, 'Max')
    const sam = await backend.joinTrip(trip.token, 'Sam')
    return { trip, anna, max, sam }
  }

  const base = (anna) => ({
    description: 'Dinner',
    amountCents: 1000,
    paidBy: anna.id,
    createdBy: anna.id,
    splitType: 'equal',
  })

  it('resolves an equal split to cents at save time', async () => {
    const { trip, anna, max, sam } = await tripWithThree()
    const expense = await backend.createExpense(trip.token, {
      ...base(anna),
      participantIds: [anna.id, max.id, sam.id],
    })
    expect(expense.splits).toEqual([
      { participantId: anna.id, amountCents: 334 },
      { participantId: max.id, amountCents: 333 },
      { participantId: sam.id, amountCents: 333 },
    ])
  })

  it('defaults the date to today', async () => {
    const { trip, anna } = await tripWithThree()
    const expense = await backend.createExpense(trip.token, {
      ...base(anna),
      participantIds: [anna.id],
    })
    expect(expense.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('accepts a past date and a future date', async () => {
    const { trip, anna } = await tripWithThree()
    const past = await backend.createExpense(trip.token, {
      ...base(anna),
      participantIds: [anna.id],
      date: '2001-01-01',
    })
    const future = await backend.createExpense(trip.token, {
      ...base(anna),
      participantIds: [anna.id],
      date: '2099-12-31',
    })
    expect(past.date).toBe('2001-01-01')
    expect(future.date).toBe('2099-12-31')
  })

  it('accepts a payer who is not in the split', async () => {
    const { trip, anna, max, sam } = await tripWithThree()
    const expense = await backend.createExpense(trip.token, {
      ...base(anna),
      amountCents: 900,
      paidBy: anna.id,
      participantIds: [max.id, sam.id],
    })
    expect(expense.splits.map((s) => s.participantId)).toEqual([max.id, sam.id])
  })

  it('rejects a zero or negative amount', async () => {
    const { trip, anna } = await tripWithThree()
    await failsWith(
      backend.createExpense(trip.token, {
        ...base(anna),
        amountCents: 0,
        participantIds: [anna.id],
      }),
      ErrorCode.AMOUNT_NOT_POSITIVE,
    )
    await failsWith(
      backend.createExpense(trip.token, {
        ...base(anna),
        amountCents: -100,
        participantIds: [anna.id],
      }),
      ErrorCode.AMOUNT_NOT_POSITIVE,
    )
  })

  it('rejects a non-integer amount, because money is always cents', async () => {
    const { trip, anna } = await tripWithThree()
    await failsWith(
      backend.createExpense(trip.token, {
        ...base(anna),
        amountCents: 10.5,
        participantIds: [anna.id],
      }),
      ErrorCode.AMOUNT_NOT_POSITIVE,
    )
  })

  it('rejects an empty description', async () => {
    const { trip, anna } = await tripWithThree()
    await failsWith(
      backend.createExpense(trip.token, {
        ...base(anna),
        description: '  ',
        participantIds: [anna.id],
      }),
      ErrorCode.DESCRIPTION_EMPTY,
    )
  })

  it('rejects an empty split', async () => {
    const { trip, anna } = await tripWithThree()
    await failsWith(
      backend.createExpense(trip.token, { ...base(anna), participantIds: [] }),
      ErrorCode.NO_PARTICIPANTS_IN_SPLIT,
    )
  })

  it('rejects a payer who is not in the trip', async () => {
    const { trip, anna } = await tripWithThree()
    await failsWith(
      backend.createExpense(trip.token, {
        ...base(anna),
        paidBy: 'p_someone_else',
        participantIds: [anna.id],
      }),
      ErrorCode.UNKNOWN_PARTICIPANT,
    )
  })

  it('rejects a category outside the fixed list', async () => {
    const { trip, anna } = await tripWithThree()
    await failsWith(
      backend.createExpense(trip.token, {
        ...base(anna),
        category: 'gambling',
        participantIds: [anna.id],
      }),
      ErrorCode.INVALID_CATEGORY,
    )
  })

  it('accepts a category from the fixed list, and none at all', async () => {
    const { trip, anna } = await tripWithThree()
    const withCategory = await backend.createExpense(trip.token, {
      ...base(anna),
      category: 'food',
      participantIds: [anna.id],
    })
    const without = await backend.createExpense(trip.token, {
      ...base(anna),
      participantIds: [anna.id],
    })
    expect(withCategory.category).toBe('food')
    expect(without.category).toBeNull()
  })

  it('rejects exact amounts that do not add up, and reports the difference', async () => {
    const { trip, anna, max } = await tripWithThree()
    const error = await failsWith(
      backend.createExpense(trip.token, {
        ...base(anna),
        splitType: 'exact',
        participantIds: [anna.id, max.id],
        exactCents: { [anna.id]: 600, [max.id]: 300 },
      }),
      ErrorCode.EXACT_SUM_MISMATCH,
    )
    expect(error.details.differenceCents).toBe(100)
  })

  it('reports a negative difference when exact amounts overshoot', async () => {
    const { trip, anna, max } = await tripWithThree()
    const error = await failsWith(
      backend.createExpense(trip.token, {
        ...base(anna),
        splitType: 'exact',
        participantIds: [anna.id, max.id],
        exactCents: { [anna.id]: 600, [max.id]: 600 },
      }),
      ErrorCode.EXACT_SUM_MISMATCH,
    )
    expect(error.details.differenceCents).toBe(-200)
  })

  it('accepts exact amounts that add up', async () => {
    const { trip, anna, max } = await tripWithThree()
    const expense = await backend.createExpense(trip.token, {
      ...base(anna),
      splitType: 'exact',
      participantIds: [anna.id, max.id],
      exactCents: { [anna.id]: 750, [max.id]: 250 },
    })
    expect(expense.splits).toEqual([
      { participantId: anna.id, amountCents: 750 },
      { participantId: max.id, amountCents: 250 },
    ])
  })

  it('rejects percentages that do not add up to 100%, and reports the gap', async () => {
    const { trip, anna, max } = await tripWithThree()
    const error = await failsWith(
      backend.createExpense(trip.token, {
        ...base(anna),
        splitType: 'percent',
        participantIds: [anna.id, max.id],
        basisPoints: { [anna.id]: 5000, [max.id]: 4000 },
      }),
      ErrorCode.PERCENT_SUM_MISMATCH,
    )
    expect(error.details.differenceBasisPoints).toBe(1000)
  })

  it('accepts percentages that add up to exactly 100%', async () => {
    const { trip, anna, max } = await tripWithThree()
    const expense = await backend.createExpense(trip.token, {
      ...base(anna),
      splitType: 'percent',
      participantIds: [anna.id, max.id],
      basisPoints: { [anna.id]: 3333, [max.id]: 6667 },
    })
    expect(sumCents(expense.splits.map((s) => s.amountCents))).toBe(1000)
  })

  it('ignores participants who are not in the trip', async () => {
    const { trip, anna } = await tripWithThree()
    const expense = await backend.createExpense(trip.token, {
      ...base(anna),
      participantIds: [anna.id, 'p_ghost'],
    })
    expect(expense.splits).toHaveLength(1)
  })

  it('lists expenses newest first', async () => {
    const { trip, anna } = await tripWithThree()
    await backend.createExpense(trip.token, {
      ...base(anna),
      description: 'First',
      participantIds: [anna.id],
    })
    await backend.createExpense(trip.token, {
      ...base(anna),
      description: 'Second',
      participantIds: [anna.id],
    })
    const view = await backend.getTrip(trip.token)
    expect(view.expenses.map((e) => e.description)).toEqual(['Second', 'First'])
  })

  it('records who entered it', async () => {
    const { trip, anna, max } = await tripWithThree()
    const expense = await backend.createExpense(trip.token, {
      ...base(anna),
      paidBy: anna.id,
      createdBy: max.id,
      participantIds: [anna.id],
    })
    expect(expense.createdBy).toBe(max.id)
  })
})

describe('updateExpense — SPEC §7.15', () => {
  async function seeded() {
    const { trip, participant: anna } = await newTrip()
    const max = await backend.joinTrip(trip.token, 'Max')
    const expense = await backend.createExpense(trip.token, {
      description: 'Dinner',
      amountCents: 1000,
      paidBy: anna.id,
      createdBy: anna.id,
      splitType: 'equal',
      participantIds: [anna.id, max.id],
    })
    return { trip, anna, max, expense }
  }

  it('replaces the splits when the amount changes', async () => {
    const { trip, anna, max, expense } = await seeded()
    const updated = await backend.updateExpense(trip.token, expense.id, {
      description: 'Dinner',
      amountCents: 2000,
      paidBy: anna.id,
      splitType: 'equal',
      participantIds: [anna.id, max.id],
    })
    expect(updated.splits).toEqual([
      { participantId: anna.id, amountCents: 1000 },
      { participantId: max.id, amountCents: 1000 },
    ])
  })

  it('recomputes when the split mode changes', async () => {
    const { trip, anna, max, expense } = await seeded()
    const updated = await backend.updateExpense(trip.token, expense.id, {
      description: 'Dinner',
      amountCents: 1000,
      paidBy: anna.id,
      splitType: 'exact',
      participantIds: [anna.id, max.id],
      exactCents: { [anna.id]: 900, [max.id]: 100 },
    })
    expect(updated.splitType).toBe('exact')
    expect(updated.splits).toEqual([
      { participantId: anna.id, amountCents: 900 },
      { participantId: max.id, amountCents: 100 },
    ])
  })

  it('drops a participant removed from the split', async () => {
    const { trip, anna, max, expense } = await seeded()
    const updated = await backend.updateExpense(trip.token, expense.id, {
      description: 'Dinner',
      amountCents: 1000,
      paidBy: anna.id,
      splitType: 'equal',
      participantIds: [anna.id],
    })
    expect(updated.splits).toEqual([{ participantId: anna.id, amountCents: 1000 }])
    const view = await backend.getTrip(trip.token)
    expect(view.balances.find((b) => b.participantId === max.id).owedCents).toBe(0)
  })

  it('keeps the original author', async () => {
    const { trip, anna, max, expense } = await seeded()
    const updated = await backend.updateExpense(trip.token, expense.id, {
      description: 'Dinner, edited by Max',
      amountCents: 1000,
      paidBy: anna.id,
      splitType: 'equal',
      participantIds: [anna.id, max.id],
    })
    expect(updated.createdBy).toBe(anna.id)
  })

  it('still validates on edit', async () => {
    const { trip, anna, expense } = await seeded()
    await failsWith(
      backend.updateExpense(trip.token, expense.id, {
        description: 'Dinner',
        amountCents: 0,
        paidBy: anna.id,
        splitType: 'equal',
        participantIds: [anna.id],
      }),
      ErrorCode.AMOUNT_NOT_POSITIVE,
    )
  })

  it('rejects an unknown expense', async () => {
    const { trip, anna } = await seeded()
    await failsWith(
      backend.updateExpense(trip.token, 'e_nope', {
        description: 'x',
        amountCents: 100,
        paidBy: anna.id,
        splitType: 'equal',
        participantIds: [anna.id],
      }),
      ErrorCode.NOT_FOUND,
    )
  })
})

describe('deleteExpense — SPEC §7.16', () => {
  it('removes the expense and its splits', async () => {
    const { trip, participant: anna } = await newTrip()
    const max = await backend.joinTrip(trip.token, 'Max')
    const expense = await backend.createExpense(trip.token, {
      description: 'Dinner',
      amountCents: 1000,
      paidBy: anna.id,
      createdBy: anna.id,
      splitType: 'equal',
      participantIds: [anna.id, max.id],
    })

    await backend.deleteExpense(trip.token, expense.id)

    const view = await backend.getTrip(trip.token)
    expect(view.expenses).toHaveLength(0)
    expect(view.totalCents).toBe(0)
    expect(view.balances.every((b) => b.netCents === 0)).toBe(true)
  })

  it('lets anyone with the link delete an expense they did not enter', async () => {
    // SPEC §2: this is deliberate.
    const { trip, participant: anna } = await newTrip()
    const max = await backend.joinTrip(trip.token, 'Max')
    const expense = await backend.createExpense(trip.token, {
      description: 'Dinner',
      amountCents: 1000,
      paidBy: anna.id,
      createdBy: anna.id,
      splitType: 'equal',
      participantIds: [anna.id, max.id],
    })
    // Max holds nothing but the link, and that is enough.
    await expect(backend.deleteExpense(trip.token, expense.id)).resolves.toBeUndefined()
  })
})

describe('trip isolation and activity', () => {
  it('keeps two trips entirely separate', async () => {
    const a = await newTrip({ name: 'Lisbon' })
    const b = await newTrip({ name: 'Porto', creatorName: 'Ben' })

    await backend.joinTrip(a.trip.token, 'Max')

    const viewA = await backend.getTrip(a.trip.token)
    const viewB = await backend.getTrip(b.trip.token)
    expect(viewA.participants).toHaveLength(2)
    expect(viewB.participants.map((p) => p.name)).toEqual(['Ben'])
  })

  it('allows the same name in two different trips', async () => {
    const a = await newTrip()
    const b = await newTrip({ name: 'Porto', creatorName: 'Ben' })
    await expect(backend.joinTrip(b.trip.token, 'Anna')).resolves.toBeTruthy()
    await failsWith(backend.joinTrip(a.trip.token, 'Anna'), ErrorCode.NAME_TAKEN)
  })

  it('advances last_activity_at on a write', async () => {
    // SPEC §4 and §9: this is what drives the 12-month retention job.
    const { trip } = await newTrip()
    const before = (await backend.getTrip(trip.token)).trip.lastActivityAt
    await backend.joinTrip(trip.token, 'Max')
    const after = (await backend.getTrip(trip.token)).trip.lastActivityAt
    expect(after >= before).toBe(true)
  })
})

describe('the SPEC §12 definition-of-done walkthrough', () => {
  it('survives ten expenses across all three modes with correct balances', async () => {
    const { trip, participant: anna } = await newTrip()
    const max = await backend.joinTrip(trip.token, 'Max')
    const sam = await backend.joinTrip(trip.token, 'Sam')
    const everyone = [anna.id, max.id, sam.id]

    const add = (input) =>
      backend.createExpense(trip.token, {
        paidBy: anna.id,
        createdBy: anna.id,
        splitType: 'equal',
        participantIds: everyone,
        ...input,
      })

    await add({ description: 'Dinner', amountCents: 1000 })
    await add({ description: 'Taxi', amountCents: 1, paidBy: max.id })
    await add({ description: 'Museum', amountCents: 4500, paidBy: sam.id, category: 'activities' })
    await add({ description: 'Coffee', amountCents: 780, participantIds: [anna.id, max.id] })
    await add({
      description: 'Groceries',
      amountCents: 3333,
      paidBy: max.id,
      splitType: 'percent',
      basisPoints: { [anna.id]: 3333, [max.id]: 3333, [sam.id]: 3334 },
    })
    await add({
      description: 'Hotel',
      amountCents: 24000,
      paidBy: sam.id,
      category: 'accommodation',
      splitType: 'exact',
      exactCents: { [anna.id]: 8000, [max.id]: 8000, [sam.id]: 8000 },
    })
    await add({
      description: 'Beers',
      amountCents: 2050,
      category: 'drinks',
      splitType: 'percent',
      basisPoints: { [anna.id]: 5000, [max.id]: 2500, [sam.id]: 2500 },
    })
    await add({
      description: 'Lunch',
      amountCents: 999,
      splitType: 'exact',
      exactCents: { [anna.id]: 333, [max.id]: 333, [sam.id]: 333 },
    })
    // SPEC §12.3: one where the payer is not in the split. Anna buys the
    // tickets for the other two.
    await add({ description: 'Ferry tickets', amountCents: 1700, participantIds: [max.id, sam.id] })
    await add({ description: 'Sunscreen', amountCents: 1299, paidBy: sam.id, category: 'shopping' })

    const view = await backend.getTrip(trip.token)

    expect(view.expenses).toHaveLength(10)
    expect(view.totalCents).toBe(1000 + 1 + 4500 + 780 + 3333 + 24000 + 2050 + 999 + 1700 + 1299)

    // Every expense's splits add up to the expense.
    for (const expense of view.expenses) {
      expect(sumCents(expense.splits.map((s) => s.amountCents))).toBe(expense.amountCents)
    }

    // The trip as a whole nets to zero.
    expect(sumCents(view.balances.map((b) => b.netCents))).toBe(0)

    // Every transfer is positive and the list settles everyone exactly.
    const settled = new Map(view.balances.map((b) => [b.participantId, b.netCents]))
    for (const transfer of view.transfers) {
      expect(transfer.amountCents).toBeGreaterThan(0)
      settled.set(transfer.fromParticipantId, settled.get(transfer.fromParticipantId) + transfer.amountCents)
      settled.set(transfer.toParticipantId, settled.get(transfer.toParticipantId) - transfer.amountCents)
    }
    expect([...settled.values()].every((v) => v === 0)).toBe(true)

    // SPEC §12.5: rename one person, and delete an unused one.
    await backend.renameParticipant(trip.token, max.id, 'Maximilian')
    const curious = await backend.joinTrip(trip.token, 'Curious')
    await backend.deleteParticipant(trip.token, curious.id)

    const final = await backend.getTrip(trip.token)
    expect(final.participants.map((p) => p.name)).toEqual(['Anna', 'Maximilian', 'Sam'])
  })
})
