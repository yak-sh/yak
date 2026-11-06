import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { serve } from './unseen.ts'

// And what a write's reply costs: it says what broke across the space's apps
// (unseen.ts `serve`) from the space's tracker, so its cost does not grow
// with the apps the space holds, and an app nobody opens is never woken by a
// write beside it (T-123502). With nothing open the tracker is the only door
// it knocks on.
let writeCost = (() => {
  let knocked: string[] = []
  let door = (name: string, answer?: unknown) => ({
    fetch: () => {
      knocked.push(name)
      return Promise.resolve(Response.json(answer))
    },
  })
  let env = {
    TRACKER_SECRET: 'secret',
    TRACKER: door('tracker', []),
    DIRECTORY: door('directory'),
    STORE: {
      idFromName: () => (knocked.push('store'), {}),
      get: () => door('store'),
    },
  } as unknown as Env
  let space = { eid: 'sp', slug: 'sp', trashed: null } as unknown as Space
  return { env, space, knocked }
})()
test('a write costs the same however many apps its space holds', async () => {
  let { env, space, knocked } = writeCost
  assertEquals(
    await serve(
      env,
      space,
      { person: 'ada', role: 'owner' },
      undefined,
      false,
      async (env) => {
        // Ticket cryptography belongs to tracker/ticket's tests. This reply still
        // reaches the tracker door, and no directory or app store.
        let response = await env.TRACKER!.fetch(
          new Request('https://tracker.internal/query'),
        )
        let rows = await response.json() as unknown[]
        assertEquals(rows, [])
        return new Map<string, never[]>()
      },
    ),
    [],
  )
  assertEquals(knocked, ['tracker'])
})
