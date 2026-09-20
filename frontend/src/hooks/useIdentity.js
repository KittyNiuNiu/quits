import { useCallback, useEffect, useMemo, useState } from 'react'
import { readIdentity, writeIdentity, clearIdentity } from '../lib/identity.js'

/**
 * SPEC §3: the browser's identity for one trip.
 *
 * The stored id is only a pointer. What counts is the participant the trip
 * actually contains, so the identity is *derived* from the loaded participant
 * list rather than kept as separate state that has to be reconciled with it.
 *
 * That matters because the list can legitimately be older than the identity —
 * the moment after joining, the last fetch predates the new participant. An
 * earlier version treated "not in the list" as proof the participant had been
 * deleted and cleared the stored identity, which sent someone who had just
 * joined back to the join screen and let them create a duplicate. Deriving
 * instead means a stale list resolves itself as soon as fresh data lands, and
 * nothing is destroyed on a guess.
 */
export function useIdentity(token, participants) {
  const [stored, setStored] = useState(() => readIdentity(token))

  useEffect(() => {
    setStored(readIdentity(token))
  }, [token])

  // The participant the stored id points at, once the trip has loaded.
  const participant =
    stored && participants ? (participants.find((p) => p.id === stored.participantId) ?? null) : null

  // Keep the cached name in step with a rename, which may have happened on
  // another device.
  useEffect(() => {
    if (participant && stored && participant.name !== stored.name) {
      writeIdentity(token, participant)
      setStored({ participantId: participant.id, name: participant.name })
    }
  }, [participant, stored, token])

  const identify = useCallback(
    (next) => {
      writeIdentity(token, next)
      setStored({ participantId: next.id, name: next.name })
    },
    [token],
  )

  // SPEC §3: "Not you? Switch", for shared phones.
  const forget = useCallback(() => {
    clearIdentity(token)
    setStored(null)
  }, [token])

  // A stored id that no longer matches anyone — a deleted participant, or a key
  // left over from another trip — simply reads as "not identified", and the
  // identify screen takes over. The dead key is inert and the next join
  // overwrites it, so there is no need to race a cleanup against a pending
  // fetch.
  const identity = useMemo(
    () => (participant ? { participantId: participant.id, name: participant.name } : null),
    [participant],
  )

  return { identity, identify, forget }
}
