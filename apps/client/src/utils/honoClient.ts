import { hc } from 'hono/client'
import type { AppType } from '../../../server/src/index'

const fallbackBaseUrl = import.meta.env.VITE_BACKEND_BASE_URL || "http://localhost:4002"

export const BASE_URL = typeof window !== 'undefined' ? window.location.origin : fallbackBaseUrl

export const client = hc<AppType>(BASE_URL, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => {
    return fetch(input, { ...init, credentials: 'include' })
  }
})
