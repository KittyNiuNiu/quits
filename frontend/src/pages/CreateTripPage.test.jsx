import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../test/render.jsx'
import { resetMockBackend } from '../services/mockBackend.js'

beforeEach(() => {
  resetMockBackend()
})

describe('the create screen — SPEC §7.1', () => {
  it('states that a lost link cannot be recovered', () => {
    // SPEC §2: the create screen must state this.
    renderApp('/')
    expect(screen.getByText(/cannot be recovered/i)).toBeInTheDocument()
  })

  it('states the retention period', () => {
    // SPEC §9: stated on the create screen, since there is no account through
    // which anyone could request deletion.
    renderApp('/')
    expect(screen.getByText(/12 months/i)).toBeInTheDocument()
  })

  it('defaults the currency label to EUR', () => {
    renderApp('/')
    expect(screen.getByLabelText(/currency label/i)).toHaveValue('EUR')
  })

  it('does not ask for any other participants', () => {
    // SPEC §3: the creator does not pre-list other participants.
    renderApp('/')
    const textboxes = screen.getAllByRole('textbox')
    expect(textboxes).toHaveLength(3)
  })

  it('creates a trip and lands on it with the creator identified', async () => {
    const user = userEvent.setup()
    renderApp('/')

    await user.type(screen.getByLabelText(/trip name/i), 'Lisbon')
    await user.type(screen.getByLabelText(/your name/i), 'Anna')
    await user.click(screen.getByRole('button', { name: /create trip/i }))

    expect(await screen.findByRole('heading', { name: 'Lisbon' })).toBeInTheDocument()
    // SPEC §3: the creator is participant #1 and is identified on this device.
    expect(screen.getByText('Anna')).toBeInTheDocument()
  })

  it('shows the server-side rejection for an empty trip name', async () => {
    const user = userEvent.setup()
    renderApp('/')

    await user.type(screen.getByLabelText(/your name/i), 'Anna')
    await user.click(screen.getByRole('button', { name: /create trip/i }))

    // SPEC §8: the client never gates this on its own.
    expect(await screen.findByText(/give the trip a name/i)).toBeInTheDocument()
  })

  it('shows the server-side rejection for an empty creator name', async () => {
    const user = userEvent.setup()
    renderApp('/')

    await user.type(screen.getByLabelText(/trip name/i), 'Lisbon')
    await user.click(screen.getByRole('button', { name: /create trip/i }))

    expect(await screen.findByText(/enter your name/i)).toBeInTheDocument()
  })

  it('keeps a custom currency label', async () => {
    const user = userEvent.setup()
    renderApp('/')

    await user.clear(screen.getByLabelText(/currency label/i))
    await user.type(screen.getByLabelText(/currency label/i), 'USD')
    await user.type(screen.getByLabelText(/trip name/i), 'Vegas')
    await user.type(screen.getByLabelText(/your name/i), 'Anna')
    await user.click(screen.getByRole('button', { name: /create trip/i }))

    await waitFor(() => expect(screen.getByText(/USD 0\.00/)).toBeInTheDocument())
  })
})

describe('an unknown trip link', () => {
  it('does not pretend the trip exists', async () => {
    renderApp('/t/definitely-not-a-token')
    expect(await screen.findByRole('heading', { name: /nothing here/i })).toBeInTheDocument()
  })
})
