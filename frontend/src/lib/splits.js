/**
 * Turning a split mode plus its inputs into resolved cents.
 *
 * SPEC §4: the split table always stores resolved cents. `split_type` records
 * how the rows were produced; nothing downstream reads it.
 *
 * Everything that divides a total calls distribute() from money.js. There is
 * no second rounding path in this file.
 */
import { distribute, sumCents } from './money.js'

export const SPLIT_TYPES = ['equal', 'exact', 'percent']

/**
 * Resolve a split into integer cents per participant.
 *
 * @param {object} args
 * @param {number} args.amountCents the expense total
 * @param {'equal'|'exact'|'percent'} args.splitType
 * @param {string[]} args.participantIds included participants, in canonical
 *   order (ascending `created_at`) so distribute()'s tie-break is correct
 * @param {Record<string, number>} [args.exactCents] per-participant cents, for
 *   `exact`
 * @param {Record<string, number>} [args.basisPoints] per-participant integer
 *   basis points, for `percent`
 * @returns {Array<{participantId: string, amountCents: number}>}
 */
export function resolveSplit({
  amountCents,
  splitType,
  participantIds,
  exactCents = {},
  basisPoints = {},
}) {
  if (!SPLIT_TYPES.includes(splitType)) {
    throw new TypeError(`resolveSplit: unknown split type "${splitType}"`)
  }
  if (participantIds.length === 0) {
    throw new RangeError('resolveSplit: needs at least one participant')
  }

  if (splitType === 'exact') {
    // SPEC §5: exact does not distribute. The entered amounts are the rows.
    return participantIds.map((participantId) => ({
      participantId,
      amountCents: exactCents[participantId] ?? 0,
    }))
  }

  const weights =
    splitType === 'equal'
      ? participantIds.map(() => 1)
      : participantIds.map((id) => basisPoints[id] ?? 0)

  const amounts = distribute(amountCents, weights)
  return participantIds.map((participantId, i) => ({
    participantId,
    amountCents: amounts[i],
  }))
}

/**
 * Seed percent inputs when editing an expense that was entered as `percent`.
 *
 * Only resolved cents are stored (SPEC §4), so the original percentages are
 * not available. Distributing 10000 basis points weighted by the stored cents
 * reconstructs them through the same single rounding function, and is
 * guaranteed to sum to exactly 10000 so the form's live indicator starts
 * balanced.
 *
 * @param {Array<{participantId: string, amountCents: number}>} splits in
 *   canonical participant order
 * @returns {Record<string, number>} participant id -> integer basis points
 */
export function deriveBasisPoints(splits) {
  const weights = splits.map((s) => s.amountCents)
  if (sumCents(weights) === 0) {
    return Object.fromEntries(splits.map((s) => [s.participantId, 0]))
  }
  const points = distribute(10000, weights)
  return Object.fromEntries(splits.map((s, i) => [s.participantId, points[i]]))
}
