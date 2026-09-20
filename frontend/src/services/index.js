/**
 * The one place the app talks to a backend.
 *
 * Components and hooks import `api` from here. No component builds a URL,
 * calls fetch, or reaches into the mock's storage.
 *
 * The real HTTP backend is the default. The in-browser mock still satisfies
 * the same contract and is still the thing the test suite runs against, but
 * it is now opt-in rather than the fallback — so a misconfigured app fails
 * loudly against a missing server instead of quietly serving different data
 * from localStorage.
 *
 * Resolution order:
 *   1. under the test runner  -> mock, so tests stay offline and deterministic
 *   2. VITE_API_MOCK=true     -> mock, to run the UI with no server at all
 *   3. VITE_API_BASE_URL set  -> that server
 *   4. otherwise              -> DEFAULT_BASE_URL
 */
import { assertImplementsBackend } from './contract.js'
import { mockBackend } from './mockBackend.js'
import { createHttpBackend } from './httpBackend.js'

const env = import.meta.env ?? {}

// Where the backend runs in local development. Any other environment sets
// VITE_API_BASE_URL at build time; the hosting target is still an open
// decision (SPEC §11.3), so there is no production default to put here.
const DEFAULT_BASE_URL = 'http://localhost:8000'

const underTest = env.VITEST === 'true' || env.MODE === 'test'
const forceMock = env.VITE_API_MOCK === 'true'

export const apiMode = underTest || forceMock ? 'mock' : 'http'

export const apiBaseUrl =
  apiMode === 'http' ? (env.VITE_API_BASE_URL || DEFAULT_BASE_URL) : null

if (apiMode === 'http' && env.PROD && !env.VITE_API_BASE_URL) {
  // A production build pointing at localhost reaches the viewer's own machine,
  // not the server. Better to say so than to fail mysteriously in the field.
  console.warn(
    `[quits] Built without VITE_API_BASE_URL, so the app will call ${DEFAULT_BASE_URL}. ` +
      'Set it at build time for any real deployment.',
  )
}

export const api = assertImplementsBackend(
  apiMode === 'http' ? createHttpBackend(apiBaseUrl) : mockBackend,
  apiMode === 'http' ? 'httpBackend' : 'mockBackend',
)

export { ApiError, ErrorCode, isApiError } from './errors.js'
export { BACKEND_METHODS } from './contract.js'
