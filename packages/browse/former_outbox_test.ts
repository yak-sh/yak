import './testing.ts'
import { equal, match, test } from '@yaks/testing'
import { type Bundle, graph, token } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { api } from '@yaks/api'
import type { OutboxStore, Pending } from '@yaks/sync'
import { liveClient, quiet } from './live_client.ts'
import { scopedOutbox } from './outbox.ts'
import { vocab } from './types.ts'

// Before T-133002 a box page queued its writes under @yaks/sync's default
// scope, the API and no person. A page opened today adopts what is left there.
let FORMER = JSON.stringify(['https://box.test', {}])
let OWNED = JSON.stringify(['https://box.test/web/apply', '', 'alice'])
let saved = new Map<string, Map<string, Pending<Bundle[]>>>()
let rows = (scope: string) => [...saved.get(scope)?.values() ?? []]
let open = (scope: string): OutboxStore<Bundle[]> => {
  let kept = saved.get(scope) ?? new Map<string, Pending<Bundle[]>>()
  saved.set(scope, kept)
  return {
    load: () => Promise.resolve(structuredClone([...kept.values()])),
    put: (entry) => {
      kept.set(entry.key, structuredClone(entry))
      return Promise.resolve()
    },
    remove: (key) => {
      kept.delete(key)
      return Promise.resolve()
    },
  }
}
let keep = (key: string, at: number, sent: Bundle[]) =>
  open(FORMER).put({ key, sent, state: 'pending', at })

let g = graph({ vocab, storage: ram(vocab) })
let server = api({ graph: g })
let moved = crypto.randomUUID()
await g.apply([{ entity: { eid: moved }, doc: { title: 'Since edited' } }])
let unsent = [{ entity: { eid: '$new' }, doc: { title: 'Typed, never sent' } }]
let answered = [{
  entity: { eid: '$new' },
  doc: { title: 'Sent, answer lost' },
}]
let stale = [{
  entity: { eid: moved },
  doc: { title: 'Over an old title' },
  $was: { doc: { title: token('Before') } },
}]
await keep('outbox:unsent', 1, unsent)
await keep('outbox:answered', 2, answered)
await keep('outbox:stale', 3, stale)
// The server took this one, and the page never heard.
let post = (key: string, sent: Bundle[]) =>
  server(
    new Request('https://box.test/apply', {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify(sent),
    }),
  )
await post('outbox:answered', answered)

let attempts: { key: string | null; sent: Bundle[] }[] = []
let page = liveClient({
  url: 'https://box.test',
  fetch: async (request) => {
    attempts.push({
      key: request.headers.get('idempotency-key'),
      sent: await request.clone().json(),
    })
    return server(request)
  },
  connect: quiet,
  report: () => {},
  changed: () => {},
  ready: () => {},
  frame: () => {},
  outbox: scopedOutbox({
    endpoint: 'https://box.test/web/apply',
    owner: () => Promise.resolve('alice'),
    former: FORMER,
    open,
  }),
})
let wire = page.box.wire!
await new Promise<void>((resolve) => {
  let settled = () =>
    wire.pending().length == 1 && wire.pending()[0].state == 'refused'
  let stop = wire.onPending(() => {
    if (!settled()) return
    stop()
    resolve()
  })
})
let refusal = wire.pending()
let left = { former: rows(FORMER), owned: rows(OWNED) }
await wire.forget('outbox:stale')
let docs = (await g.read('.doc')).map((b) => (b.doc as { title: string }).title)
  .sort()
page.box.close()

test('a box page replays the writes its former outbox kept, each once, under its own key', () => {
  equal(attempts, [
    { key: 'outbox:unsent', sent: unsent },
    { key: 'outbox:answered', sent: answered },
    { key: 'outbox:stale', sent: stale },
  ])
  equal(docs, ['Sent, answer lost', 'Since edited', 'Typed, never sent'])
})

test('a refused former write stays kept until the person dismisses it', () => {
  match(refusal, [{ key: 'outbox:stale', sent: stale, state: 'refused' }])
  match(left.former, [{ key: 'outbox:stale', sent: stale, state: 'pending' }])
  match(left.owned, [{ key: 'outbox:stale', state: 'refused' }])
  equal([rows(FORMER), rows(OWNED)], [[], []])
})

test('a page that names no person leaves the former outbox unread', async () => {
  await keep('outbox:nobody', 4, unsent)
  let opened: string[] = []
  let queue = scopedOutbox({
    endpoint: 'https://box.test/web/apply',
    owner: () => Promise.resolve(undefined),
    former: FORMER,
    open: (scope) => {
      opened.push(scope)
      return open(scope)
    },
  })
  equal(await queue.load(), [])
  equal(opened, [])
  match(rows(FORMER), [{ key: 'outbox:nobody', sent: unsent }])
})
