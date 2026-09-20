import { useState } from 'react'

/** SPEC §7.3: copy the share link. */
export default function ShareCard({ trip }) {
  const [copied, setCopied] = useState(false)
  const url = `${globalThis.location?.origin ?? ''}/t/${trip.token}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused; the link is on screen to select.
      setCopied(false)
    }
  }

  return (
    <section className="card">
      <h2>Share this trip</h2>
      <code className="share-link">{url}</code>
      <button type="button" className="btn btn-primary btn-block" onClick={copy}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
      {/* SPEC §2: possession of the link is the only credential. */}
      <p className="faint" style={{ marginTop: '0.6rem' }}>
        Anyone with this link can see and change everything in the trip. There is no password and no
        way to recover it if it is lost.
      </p>
    </section>
  )
}
