import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../services/index.js'
import { useTrip } from '../hooks/useTrip.js'
import { useIdentity } from '../hooks/useIdentity.js'
import { formatMoney } from '../lib/money.js'
import Modal from '../components/Modal.jsx'
import ErrorNotice from '../components/ErrorNotice.jsx'
import ExpenseForm from '../components/ExpenseForm.jsx'
import ExpenseList from '../components/ExpenseList.jsx'
import BalancesPanel from '../components/BalancesPanel.jsx'
import PeoplePanel from '../components/PeoplePanel.jsx'
import JoinDialog from '../components/JoinDialog.jsx'
import ShareCard from '../components/ShareCard.jsx'
import NotFoundPage from './NotFoundPage.jsx'

const TABS = [
  { id: 'expenses', label: 'Expenses' },
  { id: 'balances', label: 'Balances' },
  { id: 'people', label: 'People' },
]

export default function TripPage() {
  const { token } = useParams()
  const { view, status, error, reload } = useTrip(token)
  const { identity, identify, forget } = useIdentity(token, view?.participants)

  const [tab, setTab] = useState('expenses')
  const [joining, setJoining] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [editingExpense, setEditingExpense] = useState(null)
  const [addingExpense, setAddingExpense] = useState(false)
  const [actionError, setActionError] = useState(null)

  if (status === 'loading') {
    return (
      <div className="page">
        <p className="empty">Loading trip…</p>
      </div>
    )
  }

  if (status === 'error') {
    return <NotFoundPage />
  }

  const { trip, participants, expenses, balances, transfers, totalCents } = view

  // SPEC §11.5: the join screen comes after a read-only preview. A visitor
  // sees the trip first and only names themselves when they want to change
  // something.
  const canEdit = Boolean(identity)

  function requireIdentity(action) {
    if (canEdit) action()
    else setJoining(true)
  }

  async function onIdentified(participant) {
    // Re-read the trip before claiming the identity, so the participant list
    // the identity is resolved against already contains the person who just
    // joined. The dialog stays up, showing its busy state, until both are in.
    await reload()
    identify(participant)
    setJoining(false)
  }

  async function deleteExpense(expense) {
    setActionError(null)
    try {
      await api.deleteExpense(trip.token, expense.id)
      await reload()
    } catch (caught) {
      setActionError(caught)
    }
  }

  async function afterExpenseSaved() {
    setAddingExpense(false)
    setEditingExpense(null)
    await reload()
  }

  return (
    <div className="page">
      <header className="app-header">
        <Link to="/" className="brand">
          Quits
        </Link>
        <div className="trip-title">
          <h1>{trip.name}</h1>
          <span className="trip-total">{formatMoney(totalCents, trip.currencyLabel)}</span>
        </div>
      </header>

      <div className="identity-bar">
        {canEdit ? (
          <>
            <span>
              You are <strong>{identity.name}</strong>
            </span>
            <span className="btn-row">
              {/* SPEC §7.9: "Not you? Switch", for shared phones. */}
              <button type="button" className="btn-link" onClick={forget}>
                Not you? Switch
              </button>
              <button type="button" className="btn-link" onClick={() => setSharing(true)}>
                Share
              </button>
            </span>
          </>
        ) : (
          <>
            <span>You are just looking. Join to add or change anything.</span>
            <button type="button" className="btn btn-small btn-primary" onClick={() => setJoining(true)}>
              Join this trip
            </button>
          </>
        )}
      </div>

      <nav className="tabs" role="tablist" aria-label="Trip sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <ErrorNotice error={actionError} />

      {tab === 'expenses' && (
        <>
          <button
            type="button"
            className="btn btn-primary btn-block"
            style={{ marginBottom: '0.75rem' }}
            onClick={() => requireIdentity(() => setAddingExpense(true))}
          >
            Add an expense
          </button>
          <section className="card">
            <ExpenseList
              trip={trip}
              expenses={expenses}
              participants={participants}
              canEdit={canEdit}
              onEdit={(expense) => requireIdentity(() => setEditingExpense(expense))}
              onDelete={(expense) => requireIdentity(() => deleteExpense(expense))}
            />
          </section>
        </>
      )}

      {tab === 'balances' && (
        <BalancesPanel
          trip={trip}
          participants={participants}
          balances={balances}
          transfers={transfers}
          totalCents={totalCents}
          identity={identity}
        />
      )}

      {tab === 'people' && (
        <>
          <PeoplePanel
            trip={trip}
            participants={participants}
            expenses={expenses}
            identity={identity}
            canEdit={canEdit}
            onChanged={reload}
          />
          <ShareCard trip={trip} />
        </>
      )}

      {joining && (
        <JoinDialog trip={trip} onIdentified={onIdentified} onClose={() => setJoining(false)} />
      )}

      {sharing && (
        <Modal title="Share this trip" onClose={() => setSharing(false)}>
          <ShareCard trip={trip} />
        </Modal>
      )}

      {(addingExpense || editingExpense) && (
        <Modal
          title={editingExpense ? 'Edit expense' : 'Add an expense'}
          onClose={() => {
            setAddingExpense(false)
            setEditingExpense(null)
          }}
        >
          <ExpenseForm
            trip={trip}
            participants={participants}
            identity={identity}
            expense={editingExpense}
            onSaved={afterExpenseSaved}
            onCancel={() => {
              setAddingExpense(false)
              setEditingExpense(null)
            }}
          />
        </Modal>
      )}
    </div>
  )
}
