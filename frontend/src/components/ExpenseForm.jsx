import { useMemo, useState } from 'react'
import { api } from '../services/index.js'
import { CATEGORIES } from '../lib/categories.js'
import {
  distribute,
  formatCents,
  formatMoney,
  formatBasisPoints,
  parseAmountToCents,
  parseBasisPoints,
  sumCents,
} from '../lib/money.js'
import { deriveBasisPoints } from '../lib/splits.js'
import { todayIso } from '../lib/dates.js'
import ErrorNotice from './ErrorNotice.jsx'

const MODES = [
  { id: 'equal', label: 'Equally' },
  { id: 'exact', label: 'Exact amounts' },
  { id: 'percent', label: 'Percentages' },
]

/**
 * SPEC §7.10–§7.15: add or edit an expense.
 *
 * Everything this form computes is feedback. The backend re-validates and
 * re-resolves the split on save (SPEC §8), and the amounts it stores are the
 * ones that count.
 */
export default function ExpenseForm({ trip, participants, identity, expense, onSaved, onCancel }) {
  const editing = Boolean(expense)

  // SPEC §7.11: the default included list is everyone currently in the trip.
  // On edit it is whoever was on the expense — someone who joined later is not
  // retroactively added.
  const initialIncluded = useMemo(() => {
    if (!editing) return new Set(participants.map((p) => p.id))
    return new Set(expense.splits.map((s) => s.participantId))
  }, [editing, expense, participants])

  // Split rows in canonical participant order, which is what distribute()
  // breaks ties on (SPEC §5).
  const orderedSplits = useMemo(() => {
    if (!editing) return []
    const byId = new Map(expense.splits.map((s) => [s.participantId, s.amountCents]))
    return participants
      .filter((p) => byId.has(p.id))
      .map((p) => ({ participantId: p.id, amountCents: byId.get(p.id) }))
  }, [editing, expense, participants])

  const [description, setDescription] = useState(expense?.description ?? '')
  const [amountText, setAmountText] = useState(
    expense ? formatCents(expense.amountCents).replace(/,/g, '') : '',
  )
  const [paidBy, setPaidBy] = useState(
    // SPEC §3: a known identity pre-fills the payer field.
    expense?.paidBy ?? identity?.participantId ?? participants[0]?.id ?? '',
  )
  const [date, setDate] = useState(expense?.date ?? todayIso())
  const [category, setCategory] = useState(expense?.category ?? '')
  const [splitType, setSplitType] = useState(expense?.splitType ?? 'equal')
  const [included, setIncluded] = useState(initialIncluded)

  const [exactText, setExactText] = useState(() => {
    if (!editing || expense.splitType !== 'exact') return {}
    return Object.fromEntries(orderedSplits.map((s) => [s.participantId, formatCents(s.amountCents)]))
  })

  const [percentText, setPercentText] = useState(() => {
    if (!editing || expense.splitType !== 'percent') return {}
    // Only resolved cents are stored (SPEC §4); this reconstructs the
    // percentages through distribute() so they still sum to exactly 100%.
    const points = deriveBasisPoints(orderedSplits)
    return Object.fromEntries(
      Object.entries(points).map(([id, bp]) => [id, formatBasisPoints(bp)]),
    )
  })

  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const includedParticipants = participants.filter((p) => included.has(p.id))
  const amountCents = parseAmountToCents(amountText) ?? 0

  function toggleIncluded(id) {
    setIncluded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // --- live split feedback ------------------------------------------------

  const equalPreview = useMemo(() => {
    if (splitType !== 'equal' || includedParticipants.length === 0 || amountCents <= 0) return null
    const amounts = distribute(amountCents, includedParticipants.map(() => 1))
    return new Map(includedParticipants.map((p, i) => [p.id, amounts[i]]))
  }, [splitType, includedParticipants, amountCents])

  const exactAssigned = sumCents(
    includedParticipants.map((p) => parseAmountToCents(exactText[p.id] ?? '') ?? 0),
  )
  const exactRemaining = amountCents - exactAssigned

  const percentAssigned = sumCents(
    includedParticipants.map((p) => parseBasisPoints(percentText[p.id] ?? '') ?? 0),
  )
  const percentRemaining = 10000 - percentAssigned

  // --- save ---------------------------------------------------------------

  async function onSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const payload = {
      description,
      amountCents,
      paidBy,
      date,
      category: category === '' ? null : category,
      splitType,
      participantIds: includedParticipants.map((p) => p.id),
      exactCents: Object.fromEntries(
        includedParticipants.map((p) => [p.id, parseAmountToCents(exactText[p.id] ?? '') ?? 0]),
      ),
      basisPoints: Object.fromEntries(
        includedParticipants.map((p) => [p.id, parseBasisPoints(percentText[p.id] ?? '') ?? 0]),
      ),
      createdBy: identity.participantId,
    }

    try {
      if (editing) await api.updateExpense(trip.token, expense.id, payload)
      else await api.createExpense(trip.token, payload)
      onSaved()
    } catch (caught) {
      setError(caught)
      setSaving(false)
    }
  }

  const fieldError = (field) => (error?.field === field ? error.message : null)

  // Errors for these fields are rendered next to the input they belong to.
  // Anything else — including an exact or percent split that does not add up —
  // has to surface at the top of the form, or a rejected save looks like a
  // button that simply did nothing.
  const inlineFields = new Set(['description', 'amountCents', 'paidBy', 'participantIds'])
  const generalError = error && !inlineFields.has(error.field) ? error : null

  return (
    <form onSubmit={onSubmit} noValidate>
      <ErrorNotice error={generalError} />

      <div className="field">
        <label htmlFor="expense-description">Description</label>
        <input
          id="expense-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Dinner at Ramiro"
          autoComplete="off"
          aria-invalid={fieldError('description') ? 'true' : undefined}
        />
        {fieldError('description') && <p className="field-error">{fieldError('description')}</p>}
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="expense-amount">Amount ({trip.currencyLabel})</label>
          <input
            id="expense-amount"
            type="text"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="0.00"
            autoComplete="off"
            aria-invalid={fieldError('amountCents') ? 'true' : undefined}
          />
          {fieldError('amountCents') && <p className="field-error">{fieldError('amountCents')}</p>}
        </div>

        <div className="field">
          <label htmlFor="expense-date">Date</label>
          <input
            id="expense-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="expense-paid-by">Paid by</label>
          <select
            id="expense-paid-by"
            value={paidBy}
            onChange={(e) => setPaidBy(e.target.value)}
            aria-invalid={fieldError('paidBy') ? 'true' : undefined}
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {fieldError('paidBy') && <p className="field-error">{fieldError('paidBy')}</p>}
        </div>

        {/* SPEC §7.21: optional, from a fixed list. */}
        <div className="field">
          <label htmlFor="expense-category">Category</label>
          <select
            id="expense-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">None</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label id="split-mode-label">Split</label>
        <div className="split-mode" role="group" aria-labelledby="split-mode-label">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-pressed={splitType === mode.id}
              onClick={() => setSplitType(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        {/* SPEC §7.11: show the included list explicitly rather than implying
            "everyone". */}
        <label id="split-people-label">
          Between {includedParticipants.length} of {participants.length}
        </label>
        <ul className="list" aria-labelledby="split-people-label">
          {participants.map((p) => {
            const isIncluded = included.has(p.id)
            return (
              <li key={p.id} className="split-row">
                <label>
                  <input
                    type="checkbox"
                    checked={isIncluded}
                    onChange={() => toggleIncluded(p.id)}
                    aria-label={p.name}
                  />
                  <span className="split-name">{p.name}</span>
                </label>

                {splitType === 'equal' && (
                  <span className="split-derived">
                    {isIncluded && equalPreview ? formatCents(equalPreview.get(p.id)) : ''}
                  </span>
                )}

                {splitType === 'exact' && (
                  <input
                    className="split-input"
                    type="text"
                    inputMode="decimal"
                    value={exactText[p.id] ?? ''}
                    disabled={!isIncluded}
                    placeholder="0.00"
                    aria-label={`Amount for ${p.name}`}
                    onChange={(e) => setExactText({ ...exactText, [p.id]: e.target.value })}
                  />
                )}

                {splitType === 'percent' && (
                  <input
                    className="split-input"
                    type="text"
                    inputMode="decimal"
                    value={percentText[p.id] ?? ''}
                    disabled={!isIncluded}
                    placeholder="0"
                    aria-label={`Percentage for ${p.name}`}
                    onChange={(e) => setPercentText({ ...percentText, [p.id]: e.target.value })}
                  />
                )}
              </li>
            )
          })}
        </ul>

        {fieldError('participantIds') && (
          <p className="field-error">{fieldError('participantIds')}</p>
        )}

        {/* SPEC §7.13: without the live "left to assign" indicator the mode is
            unusable. */}
        {splitType === 'exact' && (
          <p className={`assign-indicator ${exactRemaining === 0 ? 'assign-ok' : 'assign-off'}`}>
            <span>
              {exactRemaining === 0
                ? 'All assigned'
                : exactRemaining > 0
                  ? `${formatMoney(exactRemaining, trip.currencyLabel)} left to assign`
                  : `${formatMoney(-exactRemaining, trip.currencyLabel)} over`}
            </span>
            <span>
              {formatCents(exactAssigned)} / {formatCents(amountCents)}
            </span>
          </p>
        )}

        {/* SPEC §7.14: the same live indicator, against 100%. */}
        {splitType === 'percent' && (
          <p className={`assign-indicator ${percentRemaining === 0 ? 'assign-ok' : 'assign-off'}`}>
            <span>
              {percentRemaining === 0
                ? 'All assigned'
                : percentRemaining > 0
                  ? `${formatBasisPoints(percentRemaining)}% left to assign`
                  : `${formatBasisPoints(-percentRemaining)}% over`}
            </span>
            <span>{formatBasisPoints(percentAssigned)}% / 100%</span>
          </p>
        )}
      </div>

      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add expense'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  )
}
