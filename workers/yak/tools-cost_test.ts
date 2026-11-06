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
  let door = (name: string, answer: unknown = null) => {
    let response = Response.json(answer)
    return {
      response,
      fetch: () => {
        knocked.push(name)
        return Promise.resolve(response)
      },
    }
  }
  let tracker = door('tracker', [])
  let env = {
    TRACKER_SECRET: 'secret',
    TRACKER: tracker,
    DIRECTORY: door('directory'),
    STORE: {
      idFromName: () => (knocked.push('store'), {}),
      get: () => door('store'),
    },
  } as unknown as Env
  let space = { eid: 'sp', slug: 'sp', trashed: null } as unknown as Space
  return { env, space, knocked, tracker }
})()
let trackerRequest = new Request('https://tracker.internal/query')
let trackerRows = await writeCost.tracker.response.clone().json() as unknown[]
assertEquals(trackerRows, [])
let noBreaks = new Map<string, never[]>()
let readTracker = async (env: Env) => {
  // Ticket cryptography belongs to tracker/ticket's tests. This reply still
  // reaches the tracker door, and no directory or app store.
  await env.TRACKER!.fetch(trackerRequest)
  return noBreaks
}

test('a write costs the same however many apps its space holds', async () => {
  let { env, space, knocked } = writeCost
  assertEquals(
    await serve(
      env,
      space,
      { person: 'ada', role: 'owner' },
      undefined,
      false,
      readTracker,
    ),
    [],
  )
  assertEquals(knocked, ['tracker'])
})
