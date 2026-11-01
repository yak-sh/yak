// A temporary store owns its deadline and the resources that leave with it.
// The alarm keeps this receipt until every external deletion has succeeded.
import { drop } from './dispatch.ts'
import type { Env } from './env.ts'
import { META } from './release_index.ts'
import { Refused } from '@yaks/graph/errors'
import type { App, Space } from './directory.ts'
import { r2RawObjects } from './lib/objects.ts'

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

export let expired = async (env: Partial<Env>, value: Expiry) => {
  if (value.script) await drop(env as Env, value.script, true)
  if (value.source) {
    if (!env.BLOBS) throw new Error('temporary store has no file bucket')
    let files = r2RawObjects(env.BLOBS)
    await files.delete([
      value.source + META,
      ...await files.list(`${value.source}/private/`),
    ])
  }
}
