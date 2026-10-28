import './testing.ts'
import { equal, match, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import type { OutboxStore, Pending } from '@yaks/sync'
import { liveClient, quiet } from './live_client.ts'
import { scopedOutbox } from './outbox.ts'

let saved = new Map<string, Map<string, Pending<Bundle[]>>>()
let scopes: string[] = []
let open = (scope: string): OutboxStore<Bundle[]> => {
  scopes.push(scope)
  let rows = saved.get(scope) ?? new Map<string, Pending<Bundle[]>>()
  saved.set(scope, rows)
  return {
    load: () => Promise.resolve(structuredClone([...rows.values()])),
    put: (entry) => {
      rows.set(entry.key, structuredClone(entry))
      return Promise.resolve()
    },
    remove: (key) => {
      rows.delete(key)
      return Promise.resolve()
    },
  }
}
let page = (fetch: (request: Request) => Promise<Response>) =>
  liveClient({
    url: 'https://box.test',
    fetch,
    connect: quiet,
    report: () => {},
    changed: () => {},
    ready: () => {},
    frame: () => {},
    outbox: scopedOutbox({
      endpoint: 'https://box.test/web/apply',
      storage: 'notes',
      owner: () => Promise.resolve('alice'),
      open,
    }),
  })
let intent = [{
  entity: { eid: 'precious-write' },
  doc: { title: 'Keep this' },
}]
let attempts: { key: string | null; sent: Bundle[] }[] = []
let parked: Pending<Bundle[]>[] = []
let lost = page(async (request) => {
  attempts.push({
    key: request.headers.get('idempotency-key'),
    sent: await request.json(),
  })
  parked = structuredClone(
    [...saved.values()].flatMap((rows) => [...rows.values()]),
  )
  throw new TypeError('The host accepted the write, but its response was lost')
})
let failure = await Promise.resolve(lost.box.mutate(intent)).catch((error) =>
  error
)
lost.box.close()

let reloaded = page(async (request) => {
  let sent = await request.json()
  attempts.push({ key: request.headers.get('idempotency-key'), sent })
  return Response.json(sent)
})
await new Promise<void>((resolve) => {
  let stop = reloaded.box.wire!.onPending(() => {
    if (reloaded.box.wire!.pending().length) return
    stop()
    resolve()
  })
})
let recovered = reloaded.box.ent('precious-write')?.doc
reloaded.box.close()

test('a page durably scopes its write and replays the same intent after a lost response and reload', () => {
  equal(failure.outcome, 'unknown')
  match(parked, [{ key: attempts[0].key, sent: intent, state: 'pending' }])
  equal(
    scopes,
    Array(2).fill(
      JSON.stringify(['https://box.test/web/apply', 'notes', 'alice']),
    ),
  )
  equal(attempts, [attempts[0], attempts[0]])
  equal(recovered, { title: 'Keep this' })
  equal([...saved.values()].flatMap((rows) => [...rows.values()]), [])
})
