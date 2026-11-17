// All scope polls share one conditional read. A version is acknowledged by a
// poll only after its bug read succeeds, so a failed read remains due.
import type { Clock } from '@yaks/fp'
import { system } from '@yaks/fp'
import type { Doors } from './poll.ts'
import { platform, Unavailable } from './remote.ts'

export type Changes = {
  version: (scope?: string) => Promise<string | undefined>
  scopes: () => Promise<string[]>
  close: () => void
}

export let changes = (
  doors: Doors,
  { every = 30_000, clock = system }: { every?: number; clock?: Clock } = {},
): Changes => {
  let tag: string | undefined, next = -Infinity
  let scopes = new Map<string, string | undefined>()
  let pending: Promise<void>
  let running = false
  let stop = new AbortController()
  let read = async () => {
    if (!doors.changes) throw Error('Tracker has no change feed')
    let got = await doors.changes(tag, stop.signal)
    if (!got.ok) {
      throw got.status >= 500 ? new Unavailable(got.error) : Error(got.error)
    }
    if (got.unchanged) return
    let legacy = got.value as { scopes?: unknown }
    if (
      !got.tag && Array.isArray(legacy?.scopes) &&
      legacy.scopes.every((scope) => typeof scope == 'string')
    ) {
      scopes = new Map(
        [platform, ...legacy.scopes].map((scope) => [scope, undefined]),
      )
      tag = undefined
      return
    }
    let value = got.value as { scopes?: { scope: string; tag: string }[] }
    if (
      !got.tag || !Array.isArray(value?.scopes) ||
      value.scopes.some((s) =>
        typeof s.scope != 'string' || typeof s.tag != 'string'
      )
    ) throw Error('Tracker returned an invalid change feed')
    for (let scope of value.scopes) scopes.set(scope.scope, scope.tag)
    tag = got.tag
  }
  let fresh = () => {
    if (!running && clock.now() >= next) {
      next = clock.now() + every
      running = true
      pending = read().finally(() => running = false)
    }
    return pending
  }
  return {
    version: async (scope = platform) => {
      await fresh()
      return scopes.get(scope)
    },
    scopes: async () => {
      await fresh()
      return [...scopes.keys()].filter((scope) => scope != platform)
    },
    close: () => stop.abort(),
  }
}
