/**
 * The backend contract.
 *
 * Every call the app makes to a backend is one of these methods. Components
 * and hooks import the `api` object from `src/services/index.js` and nothing
 * else — no component contains a fetch, a URL, or a storage key.
 *
 * Two implementations satisfy this contract:
 *   - `mockBackend.js`  in-browser, so the whole app runs with no server
 *   - `httpBackend.js`  the real thing, once a backend exists
 *
 * Shapes returned to the app (all money is integer cents):
 *
 *   Trip         { id, token, name, currencyLabel, createdAt, lastActivityAt }
 *   Participant  { id, name, createdAt }
 *   Expense      { id, description, amountCents, paidBy, date, category,
 *                  splitType, createdBy, createdAt,
 *                  splits: [{ participantId, amountCents }] }
 *   Balance      { participantId, paidCents, owedCents, netCents }
 *   Transfer     { fromParticipantId, toParticipantId, amountCents }
 *
 *   TripView     { trip, participants, expenses, balances, transfers,
 *                  totalCents }
 *
 * `participants` is always in canonical order — ascending `created_at` — which
 * is the order distribute() breaks its ties on (SPEC §5).
 *
 * Every method rejects with an ApiError from `errors.js`.
 */

/**
 * @typedef {object} QuitsBackend
 *
 * @property {(input: {name: string, currencyLabel: string, creatorName: string}) =>
 *   Promise<{trip: object, participant: object}>} createTrip
 *   SPEC §7.1. Returns the trip (carrying its secret token) and the creator as
 *   participant #1.
 *
 * @property {(token: string) => Promise<object>} getTrip
 *   SPEC §7.2. The whole TripView for a token, including computed balances and
 *   transfers. Readable without an identity (SPEC §11.5: preview first).
 *
 * @property {(token: string, name: string) => Promise<object>} joinTrip
 *   SPEC §7.5. Creates a participant. Rejects NAME_TAKEN if the name is
 *   already used in the trip, compared case-insensitively after trimming.
 *
 * @property {(token: string, name: string) => Promise<object>} claimParticipant
 *   SPEC §7.6 and §3. The "this is me on another device" path: binds to the
 *   existing participant with that name instead of creating one.
 *
 * @property {(token: string, participantId: string, name: string) =>
 *   Promise<object>} renameParticipant
 *   SPEC §7.7. Same uniqueness check as joining.
 *
 * @property {(token: string, participantId: string) => Promise<void>} deleteParticipant
 *   SPEC §7.8. Rejects PARTICIPANT_IN_USE unless the participant has zero
 *   expenses as payer and zero split rows.
 *
 * @property {(token: string, input: object) => Promise<object>} createExpense
 *   SPEC §7.10. Input: { description, amountCents, paidBy, date, category,
 *   splitType, participantIds, exactCents?, basisPoints?, createdBy }.
 *   Splits are resolved to cents at save time (SPEC §4).
 *
 * @property {(token: string, expenseId: string, input: object) =>
 *   Promise<object>} updateExpense
 *   SPEC §7.15. Same input as createExpense. Splits are recomputed and
 *   replaced, including when the split mode changes.
 *
 * @property {(token: string, expenseId: string) => Promise<void>} deleteExpense
 *   SPEC §7.16. Anyone with the link may delete any expense (SPEC §2).
 */

export const BACKEND_METHODS = [
  'createTrip',
  'getTrip',
  'joinTrip',
  'claimParticipant',
  'renameParticipant',
  'deleteParticipant',
  'createExpense',
  'updateExpense',
  'deleteExpense',
]

/**
 * Guard used by `index.js` so a half-written implementation fails loudly at
 * startup rather than at the first click.
 * @param {object} impl
 * @param {string} label
 */
export function assertImplementsBackend(impl, label) {
  const missing = BACKEND_METHODS.filter((m) => typeof impl?.[m] !== 'function')
  if (missing.length > 0) {
    throw new Error(`${label} does not implement the backend contract: missing ${missing.join(', ')}`)
  }
  return impl
}
