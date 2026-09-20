import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/index.js'
import { writeIdentity } from '../lib/identity.js'
import ErrorNotice from '../components/ErrorNotice.jsx'

/**
 * SPEC §7.1: create a trip from a name, a currency label and the creator's
 * name. The creator becomes participant #1 and does not pre-list anyone else.
 */
export default function CreateTripPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [currencyLabel, setCurrencyLabel] = useState('EUR')
  const [creatorName, setCreatorName] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function onSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const { trip, participant } = await api.createTrip({ name, currencyLabel, creatorName })
      writeIdentity(trip.token, participant)
      navigate(`/t/${trip.token}`, { replace: true })
    } catch (caught) {
      setError(caught)
      setSaving(false)
    }
  }

  const fieldError = (field) => (error?.field === field ? error.message : null)

  return (
    <div className="page">
      <header className="app-header">
        <span className="brand">Quits</span>
        <h1 style={{ marginTop: '0.4rem' }}>Start a trip</h1>
        <p className="muted" style={{ marginTop: '0.35rem' }}>
          Split what everyone spends on a trip or at an event. One link, no accounts.
        </p>
      </header>

      <form className="card" onSubmit={onSubmit} noValidate>
        <ErrorNotice error={error && !error.field ? error : null} />

        <div className="field">
          <label htmlFor="trip-name">Trip name</label>
          <input
            id="trip-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Lisbon, March"
            autoComplete="off"
            aria-invalid={fieldError('name') ? 'true' : undefined}
          />
          {fieldError('name') && <p className="field-error">{fieldError('name')}</p>}
        </div>

        <div className="field">
          <label htmlFor="currency-label">Currency label</label>
          <input
            id="currency-label"
            type="text"
            value={currencyLabel}
            onChange={(e) => setCurrencyLabel(e.target.value)}
            placeholder="EUR"
            autoComplete="off"
          />
          {/* SPEC §4: display string only. No conversion logic anywhere. */}
          <p className="field-hint">
            Shown next to every amount, like <span className="tabular">EUR 24.50</span>. Quits never
            converts between currencies — one trip, one label.
          </p>
        </div>

        <div className="field">
          <label htmlFor="creator-name">Your name</label>
          <input
            id="creator-name"
            type="text"
            value={creatorName}
            onChange={(e) => setCreatorName(e.target.value)}
            placeholder="Anna"
            autoComplete="off"
            aria-invalid={fieldError('creatorName') ? 'true' : undefined}
          />
          {fieldError('creatorName') && <p className="field-error">{fieldError('creatorName')}</p>}
          <p className="field-hint">
            Everyone else joins by opening the link and entering their own name.
          </p>
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
          {saving ? 'Creating…' : 'Create trip'}
        </button>
      </form>

      {/* SPEC §2: the create screen must state that there is no recovery. */}
      <div className="notice notice-warn">
        <strong>Keep the link.</strong> Whoever has the trip link has full access to it, and can add,
        edit or delete anything. There are no accounts and no passwords, so a lost link cannot be
        recovered — there is nothing to recover it to. Save it somewhere before you close the tab.
      </div>

      {/* SPEC §9: the retention period is stated on the create screen. */}
      <p className="faint">
        Trips are deleted automatically 12 months after the last change. There is no manual delete:
        with a shared link and no owner, one careless tap would destroy everyone&rsquo;s data.
      </p>
    </div>
  )
}
