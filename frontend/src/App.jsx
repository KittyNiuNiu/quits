import { Routes, Route } from 'react-router-dom'
import CreateTripPage from './pages/CreateTripPage.jsx'
import TripPage from './pages/TripPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CreateTripPage />} />
      {/* SPEC §2: the trip URL carries the secret token, and holding it is the
          only credential. There is nothing else to check. */}
      <Route path="/t/:token" element={<TripPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
