import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../test/render.jsx'
import { mockBackend as backend, resetMockBackend } from '../services/mockBackend.js'
import { api } from '../services/index.js'
import { writeIdentity } from '../lib/identity.js'

beforeEach(() => {
  resetMockBackend()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** A trip with Anna (identified on this device), Max and Sam. */
async function seedTrip({ identifyAs = 'anna' } = {}) {
  const { trip, participant: anna } = await backend.createTrip({
    name: 'Lisbon',
    currencyLabel: 'EUR',
    creatorName: 'Anna',
  })
  const max = await backend.joinTrip(trip.token, 'Max')
  const sam = await backend.joinTrip(trip.token, 'Sam')

  if (identifyAs === 'anna') writeIdentity(trip.token, anna)

  return { trip, anna, max, sam }
}

const openTab = async (user, name) => user.click(await screen.findByRole('tab', { name }))

async function openExpenseForm(user) {
  await user.click(await screen.findByRole('button', { name: /add an expense/i }))
  return screen.findByRole('dialog', { name: /add an expense/i })
}

describe('the read-only preview — SPEC §11.5', () => {
  it('shows the trip before asking anyone who they are', async () => {
    const { trip } = await seedTrip({ identifyAs: null })
    renderApp(`/t/${trip.token}`)

    expect(await screen.findByRole('heading', { name: 'Lisbon' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /join this trip/i })).toBeInTheDocument()
  })

  it('does not offer edit controls to someone who has not joined', async () => {
    const { trip, anna } = await seedTrip({ identifyAs: null })
    await backend.createExpense(trip.token, {
      description: 'Dinner',
      amountCents: 1000,
      paidBy: anna.id,
      createdBy: anna.id,
      splitType: 'equal',
      participantIds: [anna.id],
    })

    renderApp(`/t/${trip.token}`)

    expect(await screen.findByText('Dinner')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
  })

  it('asks a visitor to join when they try to add something', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip({ identifyAs: null })
    renderApp(`/t/${trip.token}`)

    await user.click(await screen.findByRole('button', { name: /add an expense/i }))

    expect(await screen.findByRole('dialog', { name: /join lisbon/i })).toBeInTheDocument()
  })
})

describe('joining — SPEC §7.5 and §3', () => {
  it('creates a participant and identifies this browser', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip({ identifyAs: null })
    renderApp(`/t/${trip.token}`)

    await user.click(await screen.findByRole('button', { name: /join this trip/i }))
    await user.type(screen.getByLabelText(/your name/i), 'Bea')
    await user.click(screen.getByRole('button', { name: /join trip/i }))

    expect(await screen.findByText(/you are/i)).toBeInTheDocument()
    expect(screen.getByText('Bea')).toBeInTheDocument()
  })

  it('rejects a taken name and tells the visitor to add a suffix', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip({ identifyAs: null })
    renderApp(`/t/${trip.token}`)

    await user.click(await screen.findByRole('button', { name: /join this trip/i }))
    await user.type(screen.getByLabelText(/your name/i), 'max')
    await user.click(screen.getByRole('button', { name: /join trip/i }))

    // SPEC §3: rejected at entry, with a message about a distinguishing
    // suffix. No "is this you?" and no fuzzy matching.
    expect(await screen.findByRole('alert')).toHaveTextContent(/already taken/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/max b/i)
  })

  it('offers the second-device path, which binds instead of duplicating', async () => {
    const user = userEvent.setup()
    const { trip, max } = await seedTrip({ identifyAs: null })
    renderApp(`/t/${trip.token}`)

    await user.click(await screen.findByRole('button', { name: /join this trip/i }))
    await user.type(screen.getByLabelText(/your name/i), 'Max')
    await user.click(screen.getByRole('button', { name: /join trip/i }))
    await user.click(await screen.findByRole('button', { name: /another device/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // SPEC §3: binds to the existing participant rather than creating one.
    const view = await backend.getTrip(trip.token)
    expect(view.participants).toHaveLength(3)
    expect(JSON.parse(localStorage.getItem(`quits.identity.${trip.token}`)).participantId).toBe(max.id)
  })

  it('lets a shared phone switch identity back to nobody', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    // SPEC §7.9: "Not you? Switch".
    await user.click(await screen.findByRole('button', { name: /not you\? switch/i }))

    expect(await screen.findByRole('button', { name: /join this trip/i })).toBeInTheDocument()
  })

  it('falls back to the identify screen when the stored identity is gone', async () => {
    // SPEC §3: cleared storage falls back to the identify screen, and the
    // existing name can be re-selected without creating a duplicate.
    const { trip } = await seedTrip()
    localStorage.removeItem(`quits.identity.${trip.token}`)
    renderApp(`/t/${trip.token}`)

    expect(await screen.findByRole('button', { name: /join this trip/i })).toBeInTheDocument()
  })

  it('drops an identity whose participant was removed from the trip', async () => {
    const { trip } = await seedTrip({ identifyAs: null })
    const curious = await backend.joinTrip(trip.token, 'Curious')
    writeIdentity(trip.token, curious)
    await backend.deleteParticipant(trip.token, curious.id)

    renderApp(`/t/${trip.token}`)

    expect(await screen.findByRole('button', { name: /join this trip/i })).toBeInTheDocument()
  })

  it('re-selecting an existing name does not create a duplicate', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip({ identifyAs: null })
    renderApp(`/t/${trip.token}`)

    await user.click(await screen.findByRole('button', { name: /join this trip/i }))
    await user.type(screen.getByLabelText(/your name/i), 'Anna')
    await user.click(screen.getByRole('button', { name: /join trip/i }))
    await user.click(await screen.findByRole('button', { name: /another device/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const view = await backend.getTrip(trip.token)
    expect(view.participants.map((p) => p.name)).toEqual(['Anna', 'Max', 'Sam'])
  })
})

describe('adding an expense — SPEC §7.10 to §7.14', () => {
  it('defaults to everyone currently in the trip, shown explicitly', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)

    // SPEC §7.11: the form shows the included list rather than implying
    // "everyone".
    expect(within(dialog).getByText(/between 3 of 3/i)).toBeInTheDocument()
    for (const name of ['Anna', 'Max', 'Sam']) {
      expect(within(dialog).getByRole('checkbox', { name })).toBeChecked()
    }
  })

  it('pre-fills the payer with the identified participant', async () => {
    const user = userEvent.setup()
    const { trip, anna } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)
    // SPEC §3: a known identity pre-fills the payer field.
    expect(within(dialog).getByLabelText(/paid by/i)).toHaveValue(anna.id)
  })

  it('saves an equal split and shows it in the list', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)
    await user.type(within(dialog).getByLabelText(/description/i), 'Dinner')
    await user.type(within(dialog).getByLabelText(/amount/i), '10.00')
    await user.click(within(dialog).getByRole('button', { name: /add expense/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // SPEC §7.17: description, amount, payer and "added by".
    expect(await screen.findByText('Dinner')).toBeInTheDocument()
    expect(screen.getByText(/anna paid/i)).toBeInTheDocument()
    expect(screen.getByText(/added by anna/i)).toBeInTheDocument()
    expect(screen.getAllByText('EUR 10.00').length).toBeGreaterThan(0)
  })

  it('previews the per-person share for an equal split', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)
    await user.type(within(dialog).getByLabelText(/amount/i), '10.00')

    // SPEC §5: 1000 cents three ways is 334 / 333 / 333, and the earliest
    // participant takes the odd cent.
    expect(within(dialog).getByText('3.34')).toBeInTheDocument()
    expect(within(dialog).getAllByText('3.33')).toHaveLength(2)
  })

  it('shows the live "left to assign" indicator in exact mode', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)
    await user.type(within(dialog).getByLabelText(/amount/i), '10.00')
    await user.click(within(dialog).getByRole('button', { name: /exact amounts/i }))

    // SPEC §7.13: without this indicator the mode is unusable.
    expect(within(dialog).getByText(/EUR 10\.00 left to assign/i)).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText(/amount for anna/i), '7.60')
    expect(within(dialog).getByText(/EUR 2\.40 left to assign/i)).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText(/amount for max/i), '2.40')
    expect(within(dialog).getByText(/all assigned/i)).toBeInTheDocument()
  })

  it('says how far over the exact amounts have gone', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)
    await user.type(within(dialog).getByLabelText(/amount/i), '10.00')
    await user.click(within(dialog).getByRole('button', { name: /exact amounts/i }))
    await user.type(within(dialog).getByLabelText(/amount for anna/i), '12.00')

    expect(within(dialog).getByText(/EUR 2\.00 over/i)).toBeInTheDocument()
  })

  it('refuses to save exact amounts that do not add up', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)
    await user.type(within(dialog).getByLabelText(/description/i), 'Dinner')
    await user.type(within(dialog).getByLabelText(/amount/i), '10.00')
    await user.click(within(dialog).getByRole('button', { name: /exact amounts/i }))
    await user.type(within(dialog).getByLabelText(/amount for anna/i), '3.00')
    await user.click(within(dialog).getByRole('button', { name: /^add expense$/i }))

    // SPEC §8: the server rejects it, and that is what the user sees.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/do not add up/i)
    expect(await backend.getTrip(trip.token)).toMatchObject({ totalCents: 0 })
  })

  it('shows the live indicator against 100% in percent mode', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)
    await user.type(within(dialog).getByLabelText(/amount/i), '100.00')
    await user.click(within(dialog).getByRole('button', { name: /percentages/i }))

    // SPEC §7.14: the same live indicator, against 100%.
    expect(within(dialog).getByText(/100% left to assign/i)).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText(/percentage for anna/i), '33.33')
    expect(within(dialog).getByText(/66\.67% left to assign/i)).toBeInTheDocument()
  })

  it('saves a percent split as integer basis points', async () => {
    const user = userEvent.setup()
    const { trip, anna, max, sam } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)
    await user.type(within(dialog).getByLabelText(/description/i), 'Groceries')
    await user.type(within(dialog).getByLabelText(/amount/i), '100.00')
    await user.click(within(dialog).getByRole('button', { name: /percentages/i }))
    await user.type(within(dialog).getByLabelText(/percentage for anna/i), '33.33')
    await user.type(within(dialog).getByLabelText(/percentage for max/i), '33.33')
    await user.type(within(dialog).getByLabelText(/percentage for sam/i), '33.34')
    await user.click(within(dialog).getByRole('button', { name: /^add expense$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const view = await backend.getTrip(trip.token)
    expect(view.expenses[0].splits).toEqual([
      { participantId: anna.id, amountCents: 3333 },
      { participantId: max.id, amountCents: 3333 },
      { participantId: sam.id, amountCents: 3334 },
    ])
  })

  it('lets the payer sit outside the split', async () => {
    const user = userEvent.setup()
    const { trip, anna, max, sam } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    // SPEC §4: paid_by is not constrained to be in the split. Anna buys the
    // ferry tickets and does not go.
    const dialog = await openExpenseForm(user)
    await user.type(within(dialog).getByLabelText(/description/i), 'Ferry tickets')
    await user.type(within(dialog).getByLabelText(/amount/i), '17.00')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Anna' }))
    await user.click(within(dialog).getByRole('button', { name: /^add expense$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const view = await backend.getTrip(trip.token)
    expect(view.expenses[0].paidBy).toBe(anna.id)
    expect(view.expenses[0].splits.map((s) => s.participantId)).toEqual([max.id, sam.id])
    expect(view.balances.find((b) => b.participantId === anna.id).netCents).toBe(1700)
  })

  it('refuses to save with nobody in the split', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)
    await user.type(within(dialog).getByLabelText(/description/i), 'Nothing')
    await user.type(within(dialog).getByLabelText(/amount/i), '5.00')
    for (const name of ['Anna', 'Max', 'Sam']) {
      await user.click(within(dialog).getByRole('checkbox', { name }))
    }
    await user.click(within(dialog).getByRole('button', { name: /^add expense$/i }))

    expect(await within(dialog).findByText(/at least one person/i)).toBeInTheDocument()
  })

  it('refuses a zero amount', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)
    await user.type(within(dialog).getByLabelText(/description/i), 'Free thing')
    await user.type(within(dialog).getByLabelText(/amount/i), '0')
    await user.click(within(dialog).getByRole('button', { name: /^add expense$/i }))

    expect(await within(dialog).findByText(/greater than zero/i)).toBeInTheDocument()
  })

  it('shows the category on the expense', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)
    await user.type(within(dialog).getByLabelText(/description/i), 'Dinner')
    await user.type(within(dialog).getByLabelText(/amount/i), '10.00')
    await user.selectOptions(within(dialog).getByLabelText(/category/i), 'food')
    await user.click(within(dialog).getByRole('button', { name: /^add expense$/i }))

    // SPEC §7.22: a label in the list, and nothing more — no breakdown screen.
    expect(await screen.findByText(/food/i)).toBeInTheDocument()
  })
})

describe('editing and deleting — SPEC §7.15 and §7.16', () => {
  async function tripWithDinner() {
    const seeded = await seedTrip()
    await backend.createExpense(seeded.trip.token, {
      description: 'Dinner',
      amountCents: 3000,
      paidBy: seeded.anna.id,
      createdBy: seeded.anna.id,
      splitType: 'equal',
      participantIds: [seeded.anna.id, seeded.max.id, seeded.sam.id],
    })
    return seeded
  }

  it('edits an expense, switching split mode, and replaces the splits', async () => {
    const user = userEvent.setup()
    const { trip, anna, max, sam } = await tripWithDinner()
    renderApp(`/t/${trip.token}`)

    await user.click(await screen.findByRole('button', { name: /^edit$/i }))
    const dialog = await screen.findByRole('dialog', { name: /edit expense/i })

    await user.click(within(dialog).getByRole('button', { name: /exact amounts/i }))
    await user.type(within(dialog).getByLabelText(/amount for anna/i), '10.00')
    await user.type(within(dialog).getByLabelText(/amount for max/i), '15.00')
    await user.type(within(dialog).getByLabelText(/amount for sam/i), '5.00')
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const view = await backend.getTrip(trip.token)
    expect(view.expenses[0].splitType).toBe('exact')
    expect(view.expenses[0].splits).toEqual([
      { participantId: anna.id, amountCents: 1000 },
      { participantId: max.id, amountCents: 1500 },
      { participantId: sam.id, amountCents: 500 },
    ])
  })

  it('pre-fills the form with what was saved', async () => {
    const user = userEvent.setup()
    const { trip } = await tripWithDinner()
    renderApp(`/t/${trip.token}`)

    await user.click(await screen.findByRole('button', { name: /^edit$/i }))
    const dialog = await screen.findByRole('dialog', { name: /edit expense/i })

    expect(within(dialog).getByLabelText(/description/i)).toHaveValue('Dinner')
    expect(within(dialog).getByLabelText(/amount \(/i)).toHaveValue('30.00')
  })

  it('reopens a percent expense with percentages that already add to 100%', async () => {
    const user = userEvent.setup()
    const { trip, anna, max, sam } = await seedTrip()
    await backend.createExpense(trip.token, {
      description: 'Groceries',
      amountCents: 10000,
      paidBy: anna.id,
      createdBy: anna.id,
      splitType: 'percent',
      participantIds: [anna.id, max.id, sam.id],
      basisPoints: { [anna.id]: 5000, [max.id]: 2500, [sam.id]: 2500 },
    })

    renderApp(`/t/${trip.token}`)
    await user.click(await screen.findByRole('button', { name: /^edit$/i }))
    const dialog = await screen.findByRole('dialog', { name: /edit expense/i })

    expect(within(dialog).getByLabelText(/percentage for anna/i)).toHaveValue('50')
    expect(within(dialog).getByText(/all assigned/i)).toBeInTheDocument()
  })

  it('deletes an expense', async () => {
    const user = userEvent.setup()
    const { trip } = await tripWithDinner()
    renderApp(`/t/${trip.token}`)

    await user.click(await screen.findByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(screen.queryByText('Dinner')).not.toBeInTheDocument())
    expect((await backend.getTrip(trip.token)).expenses).toHaveLength(0)
  })

  it('lets someone delete an expense another person entered', async () => {
    // SPEC §2: deliberate. Possession of the link is the only credential.
    const user = userEvent.setup()
    const { trip, anna, max } = await seedTrip()
    await backend.createExpense(trip.token, {
      description: "Max's dinner",
      amountCents: 1000,
      paidBy: max.id,
      createdBy: max.id,
      splitType: 'equal',
      participantIds: [max.id],
    })
    writeIdentity(trip.token, anna)

    renderApp(`/t/${trip.token}`)
    await user.click(await screen.findByRole('button', { name: /^delete$/i }))

    await waitFor(async () => expect((await backend.getTrip(trip.token)).expenses).toHaveLength(0))
  })
})

describe('balances — SPEC §6 and §7.18 to §7.20', () => {
  it('phrases the transfer in second person for the identified participant', async () => {
    const user = userEvent.setup()
    const { trip, anna, max } = await seedTrip()
    await backend.createExpense(trip.token, {
      description: 'Dinner',
      amountCents: 9000,
      paidBy: max.id,
      createdBy: max.id,
      splitType: 'equal',
      participantIds: [anna.id, max.id],
    })

    renderApp(`/t/${trip.token}`)
    await openTab(user, 'Balances')

    // SPEC §6: rendered as "Max pays Anna", and in second person for you.
    expect(await screen.findByText('You pay Max')).toBeInTheDocument()
    expect(screen.getByText('EUR 45.00')).toBeInTheDocument()
  })

  it('phrases it the other way round when you are owed', async () => {
    const user = userEvent.setup()
    const { trip, anna, max } = await seedTrip()
    await backend.createExpense(trip.token, {
      description: 'Dinner',
      amountCents: 9000,
      paidBy: anna.id,
      createdBy: anna.id,
      splitType: 'equal',
      participantIds: [anna.id, max.id],
    })

    renderApp(`/t/${trip.token}`)
    await openTab(user, 'Balances')

    expect(await screen.findByText('Max pays you')).toBeInTheDocument()
  })

  it('names both people when neither of them is you', async () => {
    const user = userEvent.setup()
    const { trip, max, sam } = await seedTrip()
    await backend.createExpense(trip.token, {
      description: 'Dinner',
      amountCents: 9000,
      paidBy: max.id,
      createdBy: max.id,
      splitType: 'equal',
      participantIds: [max.id, sam.id],
    })

    renderApp(`/t/${trip.token}`)
    await openTab(user, 'Balances')

    expect(await screen.findByText('Sam pays Max')).toBeInTheDocument()
  })

  it('shows the trip total and what each person paid', async () => {
    const user = userEvent.setup()
    const { trip, anna, max } = await seedTrip()
    await backend.createExpense(trip.token, {
      description: 'Dinner',
      amountCents: 9000,
      paidBy: anna.id,
      createdBy: anna.id,
      splitType: 'equal',
      participantIds: [anna.id, max.id],
    })

    renderApp(`/t/${trip.token}`)
    await openTab(user, 'Balances')

    expect(await screen.findByText(/trip total/i)).toBeInTheDocument()
    expect(screen.getByText(/paid EUR 90\.00/)).toBeInTheDocument()
  })

  it('says that transfers are computed and nothing can be marked paid', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)
    await openTab(user, 'Balances')

    // SPEC §6: state this in the UI so it does not read as unfinished.
    expect(await screen.findByText(/does not record payments/i)).toBeInTheDocument()
  })

  it('reports everyone settled on an empty trip', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)
    await openTab(user, 'Balances')

    expect(await screen.findByText(/nothing to settle/i)).toBeInTheDocument()
    expect(screen.getAllByText('settled')).toHaveLength(3)
  })
})

describe('people — SPEC §7.7 and §7.8', () => {
  it('renames someone in two taps from the trip screen', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    await openTab(user, 'People')
    await user.click((await screen.findAllByRole('button', { name: /rename/i }))[0])
    const input = screen.getByLabelText(/new name/i)
    await user.clear(input)
    await user.type(input, 'Anna K')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(async () => {
      const rows = await screen.findAllByRole('listitem')
      expect(within(rows[0]).getByText(/Anna K/)).toBeInTheDocument()
    })
  })

  it('rejects a rename to a name already in the trip', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    await openTab(user, 'People')
    await user.click((await screen.findAllByRole('button', { name: /rename/i }))[0])
    const input = screen.getByLabelText(/new name/i)
    await user.clear(input)
    await user.type(input, 'max')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already taken/i)
  })

  it('removes someone who never took part', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    await openTab(user, 'People')
    const rows = await screen.findAllByRole('listitem')
    await user.click(within(rows[2]).getByRole('button', { name: /remove/i }))

    await waitFor(() => expect(screen.queryByText('Sam')).not.toBeInTheDocument())
  })

  it('disables removal for someone on an expense, and says why', async () => {
    const user = userEvent.setup()
    const { trip, anna, max } = await seedTrip()
    await backend.createExpense(trip.token, {
      description: 'Dinner',
      amountCents: 1000,
      paidBy: anna.id,
      createdBy: anna.id,
      splitType: 'equal',
      participantIds: [anna.id, max.id],
    })

    renderApp(`/t/${trip.token}`)
    await openTab(user, 'People')

    const rows = await screen.findAllByRole('listitem')
    // SPEC §7.8: the control is disabled with an explanation.
    expect(within(rows[0]).getByRole('button', { name: /remove/i })).toBeDisabled()
    expect(within(rows[0]).getByText(/can.t be removed/i)).toBeInTheDocument()
    // Sam joined and never took part, so Sam can still go.
    expect(within(rows[2]).getByRole('button', { name: /remove/i })).toBeEnabled()
  })

  it('shows the share link and says the link is the only credential', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    await openTab(user, 'People')

    // SPEC §7.3.
    expect(await screen.findByText(new RegExp(trip.token.slice(0, 8)))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument()
  })
})

describe('identifying after a switch — regression', () => {
  it('identifies the new guest and creates exactly one participant', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    await user.click(await screen.findByRole('button', { name: /not you\? switch/i }))
    await user.click(await screen.findByRole('button', { name: /add an expense/i }))

    const dialog = await screen.findByRole('dialog', { name: /join lisbon/i })
    await user.type(within(dialog).getByLabelText(/your name/i), 'Bea')
    await user.click(within(dialog).getByRole('button', { name: /join trip/i }))

    expect(await screen.findByText('Bea')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /join this trip/i })).not.toBeInTheDocument()

    const view = await backend.getTrip(trip.token)
    expect(view.participants.map((p) => p.name)).toEqual(['Anna', 'Max', 'Sam', 'Bea'])
  })

  it('holds the new identity even when the trip reload is slower than the join', async () => {
    // The identity is validated against the trip's participant list. If that
    // list is still the one fetched before the join, the new participant is
    // missing from it — and treating that as "this person is gone" throws the
    // identity away and sends the visitor back to the join screen, where they
    // join again and create a duplicate.
    const user = userEvent.setup()
    const { trip } = await seedTrip({ identifyAs: null })

    const realGetTrip = api.getTrip.bind(api)
    vi.spyOn(api, 'getTrip').mockImplementation(async (token) => {
      const view = await realGetTrip(token)
      await new Promise((resolve) => setTimeout(resolve, 50))
      return view
    })

    renderApp(`/t/${trip.token}`)

    await user.click(await screen.findByRole('button', { name: /join this trip/i }))
    await user.type(screen.getByLabelText(/your name/i), 'Bea')
    await user.click(screen.getByRole('button', { name: /join trip/i }))

    expect(await screen.findByText('Bea')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /join this trip/i })).not.toBeInTheDocument()
    expect((await realGetTrip(trip.token)).participants).toHaveLength(4)
  })

  it('keeps someone identified while an unrelated reload is in flight', async () => {
    const user = userEvent.setup()
    const { trip } = await seedTrip()
    renderApp(`/t/${trip.token}`)

    const dialog = await openExpenseForm(user)
    await user.type(within(dialog).getByLabelText(/description/i), 'Dinner')
    await user.type(within(dialog).getByLabelText(/amount/i), '10.00')
    await user.click(within(dialog).getByRole('button', { name: /^add expense$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Still Anna afterwards, not bounced back to the join bar.
    expect(screen.getByText('Anna')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /join this trip/i })).not.toBeInTheDocument()
  })
})
