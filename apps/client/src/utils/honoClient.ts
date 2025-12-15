import { hc } from 'hono/client'
import type { AppType } from '../../../server/src/index'

export const BASE_URL = 'http://localhost:3001'

export const client = hc<AppType>(BASE_URL, {
  fetch: (input, init = {}) => {
    return fetch(input, { ...init, credentials: 'include' })
  }
})