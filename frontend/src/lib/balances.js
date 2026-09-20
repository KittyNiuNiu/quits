/**
 * SPEC §6: balances and the settlement view.
 *
 * Transfers are a computed view. Nothing is stored, nothing can be marked
 * paid, and the app has no concept of an outstanding balance after people
 * start actually sending money.
 */
import { sumCents } from './money.js'

/**
 * Net balance per participant.
 *
 * SPEC §6: (sum of amount_cents on expenses they paid) − (sum of their split
 * rows). Positive means the trip owes them; negative means they owe the trip.
 *
 * @param {Array<{id: string}>} participants in canonical order
 * @param {Array<{paidBy: string, amountCents: number, splits: Array<{participantId: string, amountCents: number}>}>} expenses
 * @returns {Array<{participantId: string, paidCents: number, owedCents: number, netCents: number}>}
 */
export function computeBalances(participants, expenses) {
  const paid = new Map(participants.map((p) => [p.id, 0]))
  const owed = new Map(participants.map((p) => [p.id, 0]))

  for (const expense of expenses) {
    if (paid.has(expense.paidBy)) {
      paid.set(expense.paidBy, paid.get(expense.paidBy) + expense.amountCents)
    }
    for (const split of expense.splits) {
      if (owed.has(split.participantId)) {
        owed.set(split.participantId, owed.get(split.participantId) + split.amountCents)
      }
    }
  }

  return participants.map((p) => ({
    participantId: p.id,
    paidCents: paid.get(p.id),
    owedCents: owed.get(p.id),
    netCents: paid.get(p.id) - owed.get(p.id),
  }))
}

/**
 * Minimised transfer list.
 *
 * SPEC §6: computed greedily — repeatedly match the largest creditor against
 * the largest debtor. Ties fall back to canonical participant order so the
 * same trip always renders the same list.
 *
 * @param {Array<{participantId: string, netCents: number}>} balances in
 *   canonical participant order
 * @returns {Array<{fromParticipantId: string, toParticipantId: string, amountCents: number}>}
 */
export function computeTransfers(balances) {
  const creditors = balances
    .map((b, index) => ({ id: b.participantId, amount: b.netCents, index }))
    .filter((b) => b.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.index - b.index)

  const debtors = balances
    .map((b, index) => ({ id: b.participantId, amount: -b.netCents, index }))
    .filter((b) => b.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.index - b.index)

  const transfers = []
  let c = 0
  let d = 0

  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c]
    const debtor = debtors[d]
    const amountCents = Math.min(creditor.amount, debtor.amount)

    if (amountCents > 0) {
      transfers.push({
        fromParticipantId: debtor.id,
        toParticipantId: creditor.id,
        amountCents,
      })
    }

    creditor.amount -= amountCents
    debtor.amount -= amountCents
    if (creditor.amount === 0) c += 1
    if (debtor.amount === 0) d += 1
  }

  return transfers
}

/**
 * SPEC §6: the trip total, alongside balances.
 * @param {Array<{amountCents: number}>} expenses
 * @returns {number}
 */
export function computeTripTotal(expenses) {
  return sumCents(expenses.map((e) => e.amountCents))
}
