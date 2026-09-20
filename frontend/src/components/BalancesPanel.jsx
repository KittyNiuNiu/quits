import { formatMoney } from '../lib/money.js'

/**
 * SPEC §6 and §7.18–§7.20: net balances, the minimised transfer list, the trip
 * total and total paid per participant.
 */
export default function BalancesPanel({ trip, participants, balances, transfers, totalCents, identity }) {
  const nameOf = (id) => participants.find((p) => p.id === id)?.name ?? 'someone who left'
  const isYou = (id) => identity?.participantId === id

  return (
    <>
      <section className="card">
        <h2>Where everyone stands</h2>
        {balances.length === 0 ? (
          <p className="empty">Nobody has joined yet.</p>
        ) : (
          <div>
            {balances.map((balance) => {
              const name = nameOf(balance.participantId)
              const you = isYou(balance.participantId)
              return (
                <div className="balance-line" key={balance.participantId}>
                  <span>
                    <strong>{you ? 'You' : name}</strong>
                    {/* SPEC §7.20: total paid per participant. */}
                    <div className="faint">
                      paid {formatMoney(balance.paidCents, trip.currencyLabel)} · owes{' '}
                      {formatMoney(balance.owedCents, trip.currencyLabel)}
                    </div>
                  </span>
                  <span
                    className={
                      balance.netCents > 0
                        ? 'amount-positive'
                        : balance.netCents < 0
                          ? 'amount-negative'
                          : 'amount-settled'
                    }
                  >
                    {balance.netCents === 0
                      ? 'settled'
                      : balance.netCents > 0
                        ? `+${formatMoney(balance.netCents, trip.currencyLabel)}`
                        : `−${formatMoney(-balance.netCents, trip.currencyLabel)}`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Settling up</h2>
        {transfers.length === 0 ? (
          <p className="empty">Nothing to settle.</p>
        ) : (
          <div>
            {transfers.map((transfer, index) => {
              const from = nameOf(transfer.fromParticipantId)
              const to = nameOf(transfer.toParticipantId)
              // SPEC §6 and §3: phrased in second person for the identified
              // participant.
              const label = isYou(transfer.fromParticipantId)
                ? `You pay ${to}`
                : isYou(transfer.toParticipantId)
                  ? `${from} pays you`
                  : `${from} pays ${to}`
              return (
                <div className="transfer" key={`${transfer.fromParticipantId}-${transfer.toParticipantId}-${index}`}>
                  <span>{label}</span>
                  <span className="tabular">
                    <strong>{formatMoney(transfer.amountCents, trip.currencyLabel)}</strong>
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* SPEC §6: state in the UI that this is a computed view, so it does
            not read as an unfinished feature. */}
        <p className="notice notice-info" style={{ marginTop: '0.85rem', marginBottom: 0 }}>
          This list is recalculated from the expenses every time you open it. Quits does not record
          payments and nothing here can be marked as paid — once you have sent the money, it is
          settled between you. Deliberately: there is no half-finished state to keep in sync.
        </p>
      </section>

      <section className="card">
        <div className="balance-line" style={{ paddingTop: 0 }}>
          <strong>Trip total</strong>
          <span className="tabular">
            <strong>{formatMoney(totalCents, trip.currencyLabel)}</strong>
          </span>
        </div>
      </section>
    </>
  )
}
