/**
 * The error vocabulary shared by every backend implementation.
 *
 * SPEC §8: validation is enforced server-side. These codes are what the
 * service layer reports back; the UI maps them to messages and field
 * highlights but never treats a client-side check as the gate.
 */
export const ErrorCode = {
  NOT_FOUND: 'not_found',
  TRIP_NAME_EMPTY: 'trip_name_empty',
  NAME_EMPTY: 'name_empty',
  NAME_TAKEN: 'name_taken',
  DESCRIPTION_EMPTY: 'description_empty',
  AMOUNT_NOT_POSITIVE: 'amount_not_positive',
  NO_PARTICIPANTS_IN_SPLIT: 'no_participants_in_split',
  EXACT_SUM_MISMATCH: 'exact_sum_mismatch',
  PERCENT_SUM_MISMATCH: 'percent_sum_mismatch',
  PARTICIPANT_IN_USE: 'participant_in_use',
  UNKNOWN_PARTICIPANT: 'unknown_participant',
  INVALID_CATEGORY: 'invalid_category',
  INVALID_SPLIT_TYPE: 'invalid_split_type',
  NETWORK: 'network',
}

export class ApiError extends Error {
  /**
   * @param {string} code one of ErrorCode
   * @param {string} message human-readable, safe to show
   * @param {object} [details] e.g. { field, differenceCents, differenceBasisPoints }
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }

  get field() {
    return this.details.field ?? null
  }
}

export function isApiError(error) {
  return error instanceof ApiError
}
