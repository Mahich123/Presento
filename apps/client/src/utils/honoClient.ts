import { hc } from 'hono/client'
import type { AppType } from '../../../server/src/index'

export const BASE_URL = import.meta.env.VITE_BACKEND_BASE_URL || "http://localhost:4002"

export const client = hc<AppType>(BASE_URL, {
  fetch: (input, init = {}) => {
    return fetch(input, { ...init, credentials: 'include' })
  }
})