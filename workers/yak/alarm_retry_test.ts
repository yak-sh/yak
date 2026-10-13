// A store's alarm run the runtime cut off is reported by the retry that
// follows it (graph.ts `alarm`): a kill for the CPU or memory limit leaves none
// of our code running to say so. A run the runtime moved to a new instance is
// no failure, and the instance it was moved off tells the new one.
import { clock, equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { within } from './defects.ts'
import { doorOf } from './door.ts'
import { type State, Store } from './graph.ts'
import { KERNEL } from './meta.ts'
import { replaced } from '@yaks/durable-object'
import { state } from './testing.ts'

let NAME = 'ada/notes'
let APP = '0b9b6c1e-6f43-4a51-9d1c-3f1e2a7c8d90'
let GONE = 'Connection closed: this Durable Object instance is no longer ' +
  'active. Reconnect or retry the request.'

// One object's storage, the instances the runtime runs it on, and what
// reached the tracker. An instance the runtime moves off finds its own SQL
// refusing it in the runtime's words, as `replaced` reads it.
let object = async () => {
  let held = state(NAME)
  let rows: Bundle[] = []
  let current: Store
  let env = {
    ERRORS: { send: (s: Bundle[]) => (rows.push(...s), Promise.resolve()) },
    STORE: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: (req: Request) => current.fetch(req) }),
    },
  }
  let instance = () => {
    let moved = false
    let { exec } = held.storage.sql
    let sql = Object.assign(Object.create(held.storage.sql), {
      exec: (...args: Parameters<typeof exec>) => {
        if (moved) throw new Error(GONE)
        return exec(...args)
      },
    })
    let own: State = {
      ...held,
      storage: Object.assign(Object.create(held.storage), { sql }),
    }
    let store = current = new Store(own, env)
    let alarm = (retryCount = 0) =>
      within(
        env,
        {},
        () => store.alarm(retryCount ? { isRetry: true, retryCount } : {}),
        clock(),
        { replaced: () => replaced(own.storage) },
      )
    return { alarm, move: () => void (moved = true) }
  }
  let first = instance()
  await doorOf((req) => current.fetch(req), NAME, {
    eid: APP,
    access: 'private',
  })('/vocab', { method: 'POST', body: '{}' }, KERNEL)
  let reported = () =>
    rows.flatMap((r) =>
      r.exception ? [(r.error as { tags: Record<string, string> }).tags] : []
    )
  return { first, instance, reported }
}

test('the retry after a kill reports it, tagged with its store and app', async () => {
  let o = await object()
  await o.instance().alarm(1)
  equal(o.reported(), [{ request: 'alarm', store: NAME, app: APP, retry: '1' }])
})

test('a run the runtime moved hands over, and its retry reports nothing', async () => {
  let o = await object()
  await o.first.alarm()
  o.first.move()
  let next = o.instance()
  await o.first.alarm().catch(() => {})
  await next.alarm(1)
  equal(o.reported(), [])
})
