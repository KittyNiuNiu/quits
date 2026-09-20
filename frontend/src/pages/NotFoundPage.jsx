import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="page">
      <header className="app-header">
        <Link to="/" className="brand">
          Quits
        </Link>
      </header>
      <div className="card">
        <h1>Nothing here</h1>
        <p className="muted">
          That link does not point at a trip. Check that you copied the whole thing — the part after{' '}
          <code>/t/</code> is what identifies the trip.
        </p>
        <Link to="/" className="btn btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
          Start a trip
        </Link>
      </div>
    </div>
  )
}
