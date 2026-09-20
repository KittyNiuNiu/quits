import { useState } from 'react'
import { api, ErrorCode } from '../services/index.js'
import Modal from './Modal.jsx'
import ErrorNotice from './ErrorNotice.jsx'

/**
 * SPEC §3 and §7.5–§7.6: the identify screen.
 *
 * A taken name is rejected outright with a message telling the visitor to add
 * a distinguishing suffix. The app does not ask "is this you?" and does not
 * attempt fuzzy matching — but it does offer the explicit "this is me on
 * another device" path, which binds to the existing participant instead of
 * creating one.
 */
export default function JoinDialog({ trip, onIdentified, onClose }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const nameTaken = error?.code === ErrorCode.NAME_TAKEN

  async function join(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const participant = await api.joinTrip(trip.token, name)
      onIdentified(participant)
    } catch (caught) {
      setError(caught)
      setBusy(false)
    }
  }

  async function claim() {
    setBusy(true)
    setError(null)
    try {
      const participant = await api.claimParticipant(trip.token, name)
      onIdentified(participant)
    } catch (caught) {
      setError(caught)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Join ${trip.name}`} onClose={onClose}>
      <form onSubmit={join} noValidate>
        <div className="field">
          <label htmlFor="join-name">Your name</label>
          <input
            id="join-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            placeholder="Max"
            autoComplete="off"
            autoFocus
            aria-invalid={error ? 'true' : undefined}
          />
          <p className="field-hint">
            This is how you appear on every expense. It is kept on this device only, and you can
            change it later.
          </p>
        </div>

        <ErrorNotice error={error} />

        {/* SPEC §3: the same person on a second device is told the name is
            taken, and needs a path that binds rather than duplicates. */}
        {nameTaken && (
          <div className="notice notice-info">
            <p style={{ margin: '0 0 0.6rem' }}>
              Already you? If you are the {name.trim()} who joined on another device, pick up that
              identity instead of creating a second one.
            </p>
            <button type="button" className="btn btn-small" onClick={claim} disabled={busy}>
              That&rsquo;s me — I&rsquo;m on another device
            </button>
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Joining…' : 'Join trip'}
        </button>
      </form>
    </Modal>
  )
}
