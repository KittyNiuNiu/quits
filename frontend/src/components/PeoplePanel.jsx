import { useMemo, useState } from 'react'
import { api } from '../services/index.js'
import ErrorNotice from './ErrorNotice.jsx'

/**
 * SPEC §7.7 and §7.8: rename anyone, and delete anyone who has not
 * participated in a single expense.
 *
 * Renaming is reachable in two taps from the trip screen — under this join
 * model it is routine, not an edge case.
 */
export default function PeoplePanel({ trip, participants, expenses, identity, canEdit, onChanged }) {
  const [editingId, setEditingId] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // SPEC §7.8: usage decides whether the delete control is live. The backend
  // enforces it too; this only drives the button state and its explanation.
  const usage = useMemo(() => {
    const counts = new Map(participants.map((p) => [p.id, { paid: 0, split: 0 }]))
    for (const expense of expenses) {
      const payer = counts.get(expense.paidBy)
      if (payer) payer.paid += 1
      for (const split of expense.splits) {
        const entry = counts.get(split.participantId)
        if (entry) entry.split += 1
      }
    }
    return counts
  }, [participants, expenses])

  function startRename(participant) {
    setEditingId(participant.id)
    setDraftName(participant.name)
    setError(null)
  }

  async function saveRename(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.renameParticipant(trip.token, editingId, draftName)
      setEditingId(null)
      await onChanged()
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(false)
    }
  }

  async function remove(participant) {
    setBusy(true)
    setError(null)
    try {
      await api.deleteParticipant(trip.token, participant.id)
      await onChanged()
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>People</h2>
      <ErrorNotice error={error} />

      <ul className="list">
        {participants.map((participant) => {
          const counts = usage.get(participant.id) ?? { paid: 0, split: 0 }
          const isUsed = counts.paid > 0 || counts.split > 0
          const you = identity?.participantId === participant.id

          if (editingId === participant.id) {
            return (
              <li key={participant.id}>
                <form className="item" onSubmit={saveRename} style={{ display: 'block' }}>
                  <div className="field">
                    <label htmlFor={`rename-${participant.id}`}>New name</label>
                    <input
                      id={`rename-${participant.id}`}
                      type="text"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      autoComplete="off"
                      autoFocus
                    />
                  </div>
                  <div className="btn-row">
                    <button type="submit" className="btn btn-small btn-primary" disabled={busy}>
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setEditingId(null)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </li>
            )
          }

          return (
            <li key={participant.id}>
              <div className="item">
                <div className="item-main">
                  <div className="item-title">
                    {participant.name}
                    {you && <span className="faint"> · you</span>}
                  </div>
                  <div className="item-meta">
                    {isUsed
                      ? `On ${counts.split} ${counts.split === 1 ? 'expense' : 'expenses'}${
                          counts.paid > 0 ? `, paid for ${counts.paid}` : ''
                        }`
                      : 'Not on any expense yet'}
                  </div>
                  {canEdit && (
                    <div className="btn-row" style={{ marginTop: '0.45rem' }}>
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => startRename(participant)}
                        disabled={busy}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="btn btn-small btn-danger"
                        onClick={() => remove(participant)}
                        disabled={busy || isUsed}
                        title={
                          isUsed
                            ? `${participant.name} is on existing expenses, so removing them would change what everyone owes.`
                            : undefined
                        }
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  {canEdit && isUsed && (
                    <p className="faint" style={{ marginTop: '0.3rem' }}>
                      Can&rsquo;t be removed — they are on existing expenses. Removing them would
                      change what everyone else owes.
                    </p>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <p className="faint" style={{ marginTop: '0.75rem' }}>
        Anyone with the link can rename or remove people here. Removing only works for someone who
        joined and never took part in an expense.
      </p>
    </section>
  )
}
