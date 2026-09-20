/**
 * Who this browser is, per trip.
 *
 * SPEC §3: identity lives only in localStorage and is a UI convenience. It
 * pre-fills the payer field and lets the balance view speak in second person.
 * Clearing it loses nothing — the participant and all the money stay in the
 * trip, and the same name can be re-selected without creating a duplicate.
 */
import { readJson, writeJson, removeKey } from './storage.js'

const keyFor = (token) => `quits.identity.${token}`

/**
 * @param {string} token
 * @returns {{participantId: string, name: string}|null}
 */
export function readIdentity(token) {
  const stored = readJson(keyFor(token), null)
  if (!stored || typeof stored.participantId !== 'string') return null
  return stored
}

export function writeIdentity(token, participant) {
  writeJson(keyFor(token), { participantId: participant.id, name: participant.name })
}

/** SPEC §3: the "Not you? Switch" control, for shared phones. */
export function clearIdentity(token) {
  removeKey(keyFor(token))
}
