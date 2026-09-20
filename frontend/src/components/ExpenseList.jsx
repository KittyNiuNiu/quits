import { formatMoney } from '../lib/money.js'
import { formatDate } from '../lib/dates.js'
import { getCategory } from '../lib/categories.js'

/**
 * SPEC §7.17: newest first, showing description, amount, payer, category and
 * "added by <name>".
 */
export default function ExpenseList({ trip, expenses, participants, canEdit, onEdit, onDelete }) {
  const nameOf = (id) => participants.find((p) => p.id === id)?.name ?? 'someone who left'

  if (expenses.length === 0) {
    return <p className="empty">No expenses yet. The first one starts the ledger.</p>
  }

  return (
    <ul className="list">
      {expenses.map((expense) => {
        const category = getCategory(expense.category)
        return (
          <li key={expense.id}>
            <div className="item">
              <div className="item-main">
                <div className="item-title">{expense.description}</div>
                <div className="item-meta">
                  {nameOf(expense.paidBy)} paid · {formatDate(expense.date)}
                  {category && (
                    <>
                      {' '}
                      <span className="category-tag">
                        {category.icon} {category.label}
                      </span>
                    </>
                  )}
                </div>
                <div className="faint">
                  Split {expense.splits.length === 1 ? 'with 1 person' : `${expense.splits.length} ways`} ·
                  added by {nameOf(expense.createdBy)}
                </div>
                {canEdit && (
                  <div className="btn-row" style={{ marginTop: '0.45rem' }}>
                    <button type="button" className="btn btn-small" onClick={() => onEdit(expense)}>
                      Edit
                    </button>
                    {/* SPEC §2: anyone with the link may delete any expense,
                        including ones they did not enter. */}
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={() => onDelete(expense)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              <div className="item-amount">{formatMoney(expense.amountCents, trip.currencyLabel)}</div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
