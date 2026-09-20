/**
 * HTTP implementation of the backend contract.
 *
 * Nothing in the app imports this directly. It becomes live when
 * VITE_API_BASE_URL is set (see `index.js`), at which point the mock steps
 * aside and no component changes.
 *
 * The route shapes below are what this frontend expects of the Python backend.
 * They are a proposal, not a decision — the backend framework is still open
 * (SPEC §11.1), and this file is the single place to adjust if the routes
 * land differently.
 */
import { ApiError, ErrorCode } from './errors.js'

export function createHttpBackend(baseUrl) {
  const root = baseUrl.replace(/\/+$/, '')

  async function request(method, path, body) {
    let response
    try {
      response = await fetch(`${root}${path}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (cause) {
      throw new ApiError(ErrorCode.NETWORK, 'Could not reach the server.', { cause })
    }

    if (response.status === 204) return undefined

    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (!response.ok) {
      // SPEC §8: the server is the authority on validation. Its error code and
      // message are what the UI shows.
      throw new ApiError(
        payload?.code ?? ErrorCode.NETWORK,
        payload?.message ?? 'Something went wrong.',
        payload?.details ?? {},
      )
    }

    return payload
  }

  const trip = (token) => `/api/trips/${encodeURIComponent(token)}`

  return {
    createTrip: (input) => request('POST', '/api/trips', input),
    getTrip: (token) => request('GET', trip(token)),
    joinTrip: (token, name) => request('POST', `${trip(token)}/participants`, { name }),
    claimParticipant: (token, name) => request('POST', `${trip(token)}/participants/claim`, { name }),
    renameParticipant: (token, participantId, name) =>
      request('PATCH', `${trip(token)}/participants/${encodeURIComponent(participantId)}`, { name }),
    deleteParticipant: (token, participantId) =>
      request('DELETE', `${trip(token)}/participants/${encodeURIComponent(participantId)}`),
    createExpense: (token, input) => request('POST', `${trip(token)}/expenses`, input),
    updateExpense: (token, expenseId, input) =>
      request('PUT', `${trip(token)}/expenses/${encodeURIComponent(expenseId)}`, input),
    deleteExpense: (token, expenseId) =>
      request('DELETE', `${trip(token)}/expenses/${encodeURIComponent(expenseId)}`),
  }
}
