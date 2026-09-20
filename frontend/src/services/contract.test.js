import { describe, it, expect } from 'vitest'
import { BACKEND_METHODS, assertImplementsBackend } from './contract.js'
import { mockBackend } from './mockBackend.js'
import { createHttpBackend } from './httpBackend.js'
import { api, apiMode } from './index.js'

/**
 * The point of the services layer is that the app cannot tell the two
 * implementations apart. These tests are what keeps that true as methods are
 * added.
 */
describe('the backend contract', () => {
  it('is satisfied by the mock', () => {
    expect(() => assertImplementsBackend(mockBackend, 'mockBackend')).not.toThrow()
  })

  it('is satisfied by the HTTP backend', () => {
    expect(() => assertImplementsBackend(createHttpBackend('https://example.test'), 'http')).not.toThrow()
  })

  it('is satisfied by whichever implementation the app actually imports', () => {
    for (const method of BACKEND_METHODS) {
      expect(typeof api[method], `api.${method}`).toBe('function')
    }
  })

  it('exposes exactly the same surface from both implementations', () => {
    const http = createHttpBackend('https://example.test')
    const callable = (impl) => Object.keys(impl).filter((k) => typeof impl[k] === 'function').sort()
    expect(callable(http)).toEqual(callable(mockBackend).filter((k) => k !== 'resetMockBackend'))
  })

  it('fails loudly on an incomplete implementation', () => {
    expect(() => assertImplementsBackend({ getTrip: () => {} }, 'half')).toThrow(/missing/)
  })
})

describe('which implementation is live', () => {
  it('is the mock under the test runner, never the network', () => {
    // The real HTTP backend is the app's default. If that leaked into the
    // test run, every component test would start making network calls and
    // fail for reasons that have nothing to do with the code under test.
    expect(apiMode).toBe('mock')
    expect(api).toBe(mockBackend)
  })
})

describe('the HTTP backend', () => {
  it('turns a failed fetch into an ApiError rather than leaking a TypeError', async () => {
    const backend = createHttpBackend('https://example.test')
    const original = globalThis.fetch
    globalThis.fetch = () => Promise.reject(new Error('offline'))
    try {
      await expect(backend.getTrip('abc')).rejects.toMatchObject({ name: 'ApiError', code: 'network' })
    } finally {
      globalThis.fetch = original
    }
  })

  it('surfaces the server error code, because the server is the authority', async () => {
    const backend = createHttpBackend('https://example.test')
    const original = globalThis.fetch
    globalThis.fetch = () =>
      Promise.resolve({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({
            code: 'exact_sum_mismatch',
            message: 'off by a bit',
            details: { differenceCents: 100 },
          }),
      })
    try {
      await expect(backend.createExpense('abc', {})).rejects.toMatchObject({
        code: 'exact_sum_mismatch',
        details: { differenceCents: 100 },
      })
    } finally {
      globalThis.fetch = original
    }
  })

  it('puts the trip token in the path so the link stays the only credential', async () => {
    const backend = createHttpBackend('https://example.test/')
    const seen = []
    const original = globalThis.fetch
    globalThis.fetch = (url) => {
      seen.push(url)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
    }
    try {
      await backend.getTrip('tok en/1')
      expect(seen[0]).toBe('https://example.test/api/trips/tok%20en%2F1')
    } finally {
      globalThis.fetch = original
    }
  })
})
