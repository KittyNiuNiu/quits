/**
 * localStorage access, wrapped so a browser that refuses it (private mode,
 * blocked site data) degrades instead of throwing.
 *
 * SPEC §3: identity lives only in localStorage and is a UI convenience. All
 * financial data lives in the trip, so losing this is never data loss.
 */

function storage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readJson(key, fallback = null) {
  try {
    const raw = storage()?.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeJson(key, value) {
  try {
    storage()?.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeKey(key) {
  try {
    storage()?.removeItem(key)
    return true
  } catch {
    return false
  }
}
