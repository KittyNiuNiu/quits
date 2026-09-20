import { render } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import CreateTripPage from '../pages/CreateTripPage.jsx'
import TripPage from '../pages/TripPage.jsx'
import NotFoundPage from '../pages/NotFoundPage.jsx'

/** Render the real routes at a given path, so tests exercise the app as shipped. */
export function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<CreateTripPage />} />
        <Route path="/t/:token" element={<TripPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>,
  )
}
