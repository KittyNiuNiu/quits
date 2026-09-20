import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/index.js'

/**
 * Loads a trip by token through the services layer and re-reads it after every
 * write, so balances and transfers always come back computed by the backend
 * rather than being patched up locally.
 */
export function useTrip(token) {
  const [view, setView] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      const next = await api.getTrip(token)
      setView(next)
      setStatus('ready')
      setError(null)
      return next
    } catch (caught) {
      setError(caught)
      setStatus('error')
      return null
    }
  }, [token])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    api.getTrip(token).then(
      (next) => {
        if (cancelled) return
        setView(next)
        setStatus('ready')
      },
      (caught) => {
        if (cancelled) return
        setError(caught)
        setStatus('error')
      },
    )
    return () => {
      cancelled = true
    }
  }, [token])

  return { view, status, error, reload }
}
