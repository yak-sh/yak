// Expiry suspends temporary stores with their original receipt and bytes.
// Time passing never authorizes a permanent purge.
import { Refused } from '@yaks/graph/errors'
import type { App, Space } from './directory.ts'

export type Context = { app: App; space: Space }
export type Expiry = {
  at: number
  source?: string
  script?: string
  context?: Context
}

export let expiring = (value: unknown): Expiry => {
  let v = value as Partial<Expiry> | null
  if (
    !v || typeof v.at != 'number' || !Number.isSafeInteger(v.at) || v.at < 1
  ) {
    throw new Refused('expires.at must be a positive epoch millisecond')
  }
  for (let key of ['source', 'script'] as const) {
    if (v[key] != null && (typeof v[key] != 'string' || !v[key])) {
      throw new Refused(`expires.${key} must be a nonempty string`)
    }
  }
  return {
    at: v.at,
    ...(v.source ? { source: v.source } : {}),
    ...(v.script ? { script: v.script } : {}),
    ...(v.context ? { context: v.context } : {}),
  }
}

/** Move an expiry receipt into retained trash before removing its alarm work. */
export let expired = async (storage: {
  put?(key: string, value: unknown): Promise<void>
  delete?(key: string): Promise<unknown>
}, value: Expiry) => {
  await storage.put?.('trashed', value)
  await storage.delete?.('expires')
}
