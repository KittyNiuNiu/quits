/**
 * In-browser implementation of the backend contract.
 *
 * This exists so the whole app runs with no server. It is deliberately written
 * the way a server would be: it owns the data, it enforces every SPEC §8 rule
 * itself, and it computes balances and transfers before handing anything back.
 * The UI cannot reach around it, and swapping in `httpBackend` changes nothing
 * about how components behave.
 *
 * Data lives in localStorage so a refresh, or opening the share link in a
 * second tab, behaves like a real shared trip on one machine.
 */
import { ApiError, ErrorCode } from './errors.js'
import { CATEGORY_IDS } from '../lib/categories.js'
import { SPLIT_TYPES, resolveSplit } from '../lib/splits.js'
import { computeBalances, computeTransfers, computeTripTotal } from '../lib/balances.js'
import { sumCents } from '../lib/money.js'
import { readJson, writeJson } from '../lib/storage.js'

const STORAGE_KEY = 'quits.mock.v1'

// `seq` is a monotonic counter standing in for the autoincrement primary key a
// real database would provide. Two participants can be created inside the same
// millisecond, and SPEC §5's tie-break depends on creation order being stable,
// so timestamps alone are not a safe sort key.
const emptyDb = () => ({ trips: [], participants: [], expenses: [], splits: [], seq: 0 })

function nextSeq(db) {
  db.seq = (db.seq ?? 0) + 1
  return db.seq
}

function loadDb() {
  const db = readJson(STORAGE_KEY, null)
  if (!db || !Array.isArray(db.trips)) return emptyDb()
  return { ...emptyDb(), ...db }
}

function saveDb(db) {
  writeJson(STORAGE_KEY, db)
}

/** Test seam: wipe the mock's store. */
export function resetMockBackend() {
  writeJson(STORAGE_KEY, emptyDb())
}

// --- ids and tokens -------------------------------------------------------

function randomBytes(length) {
  const bytes = new Uint8Array(length)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return bytes
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SPEC §4: cryptographically random, at least 128 bits, URL-safe. */
function newToken() {
  return base64Url(randomBytes(24))
}

function newId(prefix) {
  return `${prefix}_${base64Url(randomBytes(9))}`
}

// --- validation helpers ---------------------------------------------------

function normalizeName(name) {
  return typeof name === 'string' ? name.trim() : ''
}

/** SPEC §3: unique per trip, case-insensitive, after trimming. */
function sameName(a, b) {
  return a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US')
}

function requireTrip(db, token) {
  const trip = db.trips.find((t) => t.token === token)
  if (!trip) {
    throw new ApiError(ErrorCode.NOT_FOUND, 'That trip link is not valid.')
  }
  return trip
}

/**
 * SPEC §4: canonical ordering is ascending created_at. `seq` settles ties
 * within the same millisecond so the order — and therefore which participant
 * receives a leftover cent — never depends on a random id.
 */
function participantsOf(db, tripId) {
  return db.participants
    .filter((p) => p.tripId === tripId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.seq - b.seq)
}

function assertNameAvailable(db, tripId, name, exceptParticipantId = null) {
  const clash = participantsOf(db, tripId).find(
    (p) => p.id !== exceptParticipantId && sameName(p.name, name),
  )
  if (clash) {
    throw new ApiError(
      ErrorCode.NAME_TAKEN,
      `"${name}" is already taken in this trip. Add something to tell you apart, like "${name} B".`,
      { field: 'name', existingParticipantId: clash.id },
    )
  }
}

function touchTrip(trip) {
  trip.lastActivityAt = new Date().toISOString()
}

// --- expense validation, SPEC §8 -----------------------------------------

function validateExpenseInput(db, trip, input) {
  const participants = participantsOf(db, trip.id)
  const knownIds = new Set(participants.map((p) => p.id))

  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (description === '') {
    throw new ApiError(ErrorCode.DESCRIPTION_EMPTY, 'Give the expense a description.', {
      field: 'description',
    })
  }

  const amountCents = input.amountCents
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ApiError(ErrorCode.AMOUNT_NOT_POSITIVE, 'Enter an amount greater than zero.', {
      field: 'amountCents',
    })
  }

  // SPEC §4: the payer is one participant, and is NOT constrained to be in
  // the split.
  if (!knownIds.has(input.paidBy)) {
    throw new ApiError(ErrorCode.UNKNOWN_PARTICIPANT, 'Choose who paid.', { field: 'paidBy' })
  }

  if (!knownIds.has(input.createdBy)) {
    throw new ApiError(ErrorCode.UNKNOWN_PARTICIPANT, 'Join the trip before adding an expense.', {
      field: 'createdBy',
    })
  }

  if (!SPLIT_TYPES.includes(input.splitType)) {
    throw new ApiError(ErrorCode.INVALID_SPLIT_TYPE, 'Choose how to split this.', {
      field: 'splitType',
    })
  }

  const category = input.category ?? null
  if (category !== null && !CATEGORY_IDS.includes(category)) {
    throw new ApiError(ErrorCode.INVALID_CATEGORY, 'That is not a known category.', {
      field: 'category',
    })
  }

  // Keep the included list in canonical participant order, so distribute()
  // breaks ties on ascending created_at (SPEC §5).
  const requested = new Set(input.participantIds ?? [])
  const participantIds = participants.map((p) => p.id).filter((id) => requested.has(id))

  if (participantIds.length === 0) {
    throw new ApiError(
      ErrorCode.NO_PARTICIPANTS_IN_SPLIT,
      'Include at least one person in the split.',
      { field: 'participantIds' },
    )
  }

  if (input.splitType === 'exact') {
    const entered = participantIds.map((id) => input.exactCents?.[id] ?? 0)
    if (!entered.every((c) => Number.isInteger(c) && c >= 0)) {
      throw new ApiError(ErrorCode.AMOUNT_NOT_POSITIVE, 'Split amounts cannot be negative.', {
        field: 'exactCents',
      })
    }
    const difference = amountCents - sumCents(entered)
    if (difference !== 0) {
      throw new ApiError(
        ErrorCode.EXACT_SUM_MISMATCH,
        'The split amounts do not add up to the total.',
        { field: 'exactCents', differenceCents: difference },
      )
    }
  }

  if (input.splitType === 'percent') {
    const entered = participantIds.map((id) => input.basisPoints?.[id] ?? 0)
    if (!entered.every((b) => Number.isInteger(b) && b >= 0)) {
      throw new ApiError(ErrorCode.PERCENT_SUM_MISMATCH, 'Percentages cannot be negative.', {
        field: 'basisPoints',
        differenceBasisPoints: 10000 - sumCents(entered),
      })
    }
    const difference = 10000 - sumCents(entered)
    if (difference !== 0) {
      throw new ApiError(ErrorCode.PERCENT_SUM_MISMATCH, 'The percentages do not add up to 100%.', {
        field: 'basisPoints',
        differenceBasisPoints: difference,
      })
    }
  }

  return {
    description,
    amountCents,
    paidBy: input.paidBy,
    createdBy: input.createdBy,
    date: input.date || todayIso(),
    category,
    splitType: input.splitType,
    participantIds,
    exactCents: input.exactCents ?? {},
    basisPoints: input.basisPoints ?? {},
  }
}

function todayIso() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// --- read model -----------------------------------------------------------

function expensesOf(db, tripId) {
  return db.expenses
    .filter((e) => e.tripId === tripId)
    // SPEC §7.17: newest first, with `seq` settling same-millisecond ties.
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.seq - a.seq)
    .map((e) => ({
      ...e,
      splits: db.splits
        .filter((s) => s.expenseId === e.id)
        .map((s) => ({ participantId: s.participantId, amountCents: s.amountCents })),
    }))
}

function buildTripView(db, trip) {
  const participants = participantsOf(db, trip.id).map(({ tripId, seq, ...rest }) => rest)
  const expenses = expensesOf(db, trip.id).map(({ tripId, seq, ...rest }) => rest)
  const balances = computeBalances(participants, expenses)

  return structuredClone({
    trip: {
      id: trip.id,
      token: trip.token,
      name: trip.name,
      currencyLabel: trip.currencyLabel,
      createdAt: trip.createdAt,
      lastActivityAt: trip.lastActivityAt,
    },
    participants,
    expenses,
    balances,
    transfers: computeTransfers(balances),
    totalCents: computeTripTotal(expenses),
  })
}

function writeSplits(db, expenseId, splits) {
  db.splits = db.splits.filter((s) => s.expenseId !== expenseId)
  for (const split of splits) {
    db.splits.push({ expenseId, participantId: split.participantId, amountCents: split.amountCents })
  }
}

// Every method is async so the mock and a real HTTP backend are
// indistinguishable to callers.
const tick = () => Promise.resolve()

export const mockBackend = {
  async createTrip({ name, currencyLabel, creatorName }) {
    await tick()
    const db = loadDb()

    const tripName = normalizeName(name)
    if (tripName === '') {
      throw new ApiError(ErrorCode.TRIP_NAME_EMPTY, 'Give the trip a name.', { field: 'name' })
    }

    const creator = normalizeName(creatorName)
    if (creator === '') {
      throw new ApiError(ErrorCode.NAME_EMPTY, 'Enter your name.', { field: 'creatorName' })
    }

    const now = new Date().toISOString()
    const trip = {
      id: newId('trip'),
      token: newToken(),
      name: tripName,
      // SPEC §4: display string only, default EUR.
      currencyLabel: normalizeName(currencyLabel) || 'EUR',
      createdAt: now,
      lastActivityAt: now,
    }
    // SPEC §3: the creator is participant #1 and pre-lists nobody else.
    const participant = {
      id: newId('p'),
      tripId: trip.id,
      name: creator,
      createdAt: now,
      seq: nextSeq(db),
    }

    db.trips.push(trip)
    db.participants.push(participant)
    saveDb(db)

    const { tripId, seq, ...publicParticipant } = participant
    return structuredClone({ trip, participant: publicParticipant })
  },

  async getTrip(token) {
    await tick()
    const db = loadDb()
    return buildTripView(db, requireTrip(db, token))
  },

  async joinTrip(token, name) {
    await tick()
    const db = loadDb()
    const trip = requireTrip(db, token)

    const clean = normalizeName(name)
    if (clean === '') {
      throw new ApiError(ErrorCode.NAME_EMPTY, 'Enter your name.', { field: 'name' })
    }
    assertNameAvailable(db, trip.id, clean)

    const participant = {
      id: newId('p'),
      tripId: trip.id,
      name: clean,
      createdAt: new Date().toISOString(),
      seq: nextSeq(db),
    }
    db.participants.push(participant)
    touchTrip(trip)
    saveDb(db)

    const { tripId, seq, ...publicParticipant } = participant
    return structuredClone(publicParticipant)
  },

  // SPEC §3 and §7.6: "this is me on another device" binds to the existing
  // participant rather than creating one. It is also what a visitor whose
  // localStorage was cleared uses to get their identity back.
  async claimParticipant(token, name) {
    await tick()
    const db = loadDb()
    const trip = requireTrip(db, token)

    const clean = normalizeName(name)
    if (clean === '') {
      throw new ApiError(ErrorCode.NAME_EMPTY, 'Enter your name.', { field: 'name' })
    }

    const existing = participantsOf(db, trip.id).find((p) => sameName(p.name, clean))
    if (!existing) {
      throw new ApiError(ErrorCode.NOT_FOUND, `Nobody in this trip is called "${clean}".`, {
        field: 'name',
      })
    }

    const { tripId, seq, ...publicParticipant } = existing
    return structuredClone(publicParticipant)
  },

  async renameParticipant(token, participantId, name) {
    await tick()
    const db = loadDb()
    const trip = requireTrip(db, token)

    const participant = db.participants.find((p) => p.id === participantId && p.tripId === trip.id)
    if (!participant) {
      throw new ApiError(ErrorCode.NOT_FOUND, 'That person is not in this trip.')
    }

    const clean = normalizeName(name)
    if (clean === '') {
      throw new ApiError(ErrorCode.NAME_EMPTY, 'Enter a name.', { field: 'name' })
    }
    assertNameAvailable(db, trip.id, clean, participantId)

    participant.name = clean
    touchTrip(trip)
    saveDb(db)

    const { tripId, seq, ...publicParticipant } = participant
    return structuredClone(publicParticipant)
  },

  // SPEC §7.8: only when they have zero expenses as payer and zero split rows.
  async deleteParticipant(token, participantId) {
    await tick()
    const db = loadDb()
    const trip = requireTrip(db, token)

    const participant = db.participants.find((p) => p.id === participantId && p.tripId === trip.id)
    if (!participant) {
      throw new ApiError(ErrorCode.NOT_FOUND, 'That person is not in this trip.')
    }

    const tripExpenseIds = new Set(db.expenses.filter((e) => e.tripId === trip.id).map((e) => e.id))
    const paidCount = db.expenses.filter(
      (e) => e.tripId === trip.id && e.paidBy === participantId,
    ).length
    const splitCount = db.splits.filter(
      (s) => tripExpenseIds.has(s.expenseId) && s.participantId === participantId,
    ).length

    if (paidCount > 0 || splitCount > 0) {
      throw new ApiError(
        ErrorCode.PARTICIPANT_IN_USE,
        `${participant.name} is on existing expenses and cannot be removed.`,
        { paidCount, splitCount },
      )
    }

    db.participants = db.participants.filter((p) => p.id !== participantId)
    touchTrip(trip)
    saveDb(db)
  },

  async createExpense(token, input) {
    await tick()
    const db = loadDb()
    const trip = requireTrip(db, token)
    const clean = validateExpenseInput(db, trip, input)

    const expense = {
      id: newId('e'),
      tripId: trip.id,
      description: clean.description,
      amountCents: clean.amountCents,
      paidBy: clean.paidBy,
      date: clean.date,
      category: clean.category,
      splitType: clean.splitType,
      createdBy: clean.createdBy,
      createdAt: new Date().toISOString(),
      seq: nextSeq(db),
    }

    db.expenses.push(expense)
    // SPEC §4: splits are resolved to cents at save time.
    writeSplits(db, expense.id, resolveSplit(clean))
    touchTrip(trip)
    saveDb(db)

    const { tripId, seq, ...rest } = expense
    return structuredClone({
      ...rest,
      splits: db.splits
        .filter((s) => s.expenseId === expense.id)
        .map((s) => ({ participantId: s.participantId, amountCents: s.amountCents })),
    })
  },

  // SPEC §7.15: splits are recomputed and replaced on save, including when the
  // split mode changes.
  async updateExpense(token, expenseId, input) {
    await tick()
    const db = loadDb()
    const trip = requireTrip(db, token)

    const expense = db.expenses.find((e) => e.id === expenseId && e.tripId === trip.id)
    if (!expense) {
      throw new ApiError(ErrorCode.NOT_FOUND, 'That expense no longer exists.')
    }

    const clean = validateExpenseInput(db, trip, { createdBy: expense.createdBy, ...input })

    Object.assign(expense, {
      description: clean.description,
      amountCents: clean.amountCents,
      paidBy: clean.paidBy,
      date: clean.date,
      category: clean.category,
      splitType: clean.splitType,
    })

    writeSplits(db, expense.id, resolveSplit(clean))
    touchTrip(trip)
    saveDb(db)

    const { tripId, seq, ...rest } = expense
    return structuredClone({
      ...rest,
      splits: db.splits
        .filter((s) => s.expenseId === expense.id)
        .map((s) => ({ participantId: s.participantId, amountCents: s.amountCents })),
    })
  },

  // SPEC §2: anyone with the link may delete any expense, including ones they
  // did not enter. This is deliberate.
  async deleteExpense(token, expenseId) {
    await tick()
    const db = loadDb()
    const trip = requireTrip(db, token)

    const expense = db.expenses.find((e) => e.id === expenseId && e.tripId === trip.id)
    if (!expense) {
      throw new ApiError(ErrorCode.NOT_FOUND, 'That expense no longer exists.')
    }

    db.expenses = db.expenses.filter((e) => e.id !== expenseId)
    db.splits = db.splits.filter((s) => s.expenseId !== expenseId)
    touchTrip(trip)
    saveDb(db)
  },
}
