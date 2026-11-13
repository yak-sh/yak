/// <reference lib="deno.ns" />
// The write log's door (receipts.ts `door`) over a host that stands in for a
// stopped object: a ram graph, its log in SQLite, and a window the case ends.
import { equal, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { open } from '@yaks/sqlite/db'
import { IDEMPOTENCY, keep, raise, rekey } from './log.ts'
import { type Door, door } from './receipts.ts'

let vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
  },
})

class Stopped extends Error {
  override name = 'Stopped'
  constructor(public retry: { after: number }) {
    super('stopped')
  }
}

// A host stopped until `at.until` on the case's clock `at.t`, the alarms its
// door armed, and the titles its commits applied, in turn.
let host = () => {
  let db = open(':memory:')
  raise(db)
  let at = { t: 0, until: 0 }
  let armed: number[] = [], applied: string[] = []
  let g = graph({ vocab, storage: ram(vocab) })
  let log: Door = door({
    db,
    vocab,
    now: () => at.t,
    window: {
      refusal: () =>
        at.t < at.until ? new Stopped({ after: at.until - at.t }) : null,
      free: (body) => body(),
      stops: (e): e is Stopped => e instanceof Stopped,
    },
    ready: () => Promise.resolve(null),
    serve: () => Promise.reject(new Error('every write here is kept')),
    commit: async (request, mark) => {
      let body = JSON.parse(await request.text()) as Bundle[]
      applied.push((body[0].doc as { title: string }).title)
      let out = log.applying(request, mark, () => g.apply(body))
      return out instanceof Response ? out : Response.json(await out)
    },
    authorize: () => Promise.resolve(),
    keeps: () => true,
    answer: (_request, answer) => Promise.resolve(answer),
    refused: () => null,
    writer: (r) => ({ by: r.headers.get('x-by') ?? 'ada' }),
    arm: (t) => void armed.push(t),
    report: (e) => console.error(e),
  })
  g.use(log.plugin)
  let sent = (title: string, key?: string, by = 'ada') =>
    new Request('http://store/apply', {
      method: 'POST',
      headers: { 'x-by': by, ...key ? { [IDEMPOTENCY]: key } : {} },
      body: JSON.stringify([{ entity: { eid: title }, doc: { title } }]),
    })
  let write = (title: string, key?: string, by?: string) =>
    log.write(sent(title, key, by))
  let titles = async () =>
    (await g.read('.doc')).map((b) => (b.doc as { title: string }).title)
  return { db, at, armed, applied, log, sent, write, titles }
}

let told = async (r: Response) => [r.status, (await r.json()).pending]

test('a write sent while stopped is kept, told when to look again, and lands once the window ends', async () => {
  let h = host()
  h.at.until = 30_000
  let kept = await h.write('a', 'k')
  equal(kept.headers.get('retry-after'), '30')
  equal(await told(kept), [202, 1])
  equal([h.armed, await h.titles()], [[30_000], []])
  // A resend while it waits is the write it repeats.
  equal(await told(await h.write('a', 'k')), [202, 1])
  h.at.t = 30_000
  await h.log.settle()
  equal(await h.titles(), ['a'])
  // Once it landed, a resend hears what it was, and lands nothing again.
  let again = await h.write('a', 'k')
  equal(again.status, 200)
  equal((await again.json())[0].doc.title, 'a')
  equal(await h.titles(), ['a'])
})

test('writes kept while stopped land in the order they were sent', async () => {
  let h = host()
  h.at.until = 1_000
  for (let title of ['z', 'x', 'y']) await h.write(title)
  h.at.t = 1_000
  await h.log.mend()
  equal(h.applied, ['z', 'x', 'y'])
})

test('a live keyed write commits once and a resend hears the same answer', async () => {
  let h = host()
  let first = await (await h.write('b', 'live')).text()
  let second = await (await h.write('b', 'live')).text()
  equal([second, await h.titles()], [first, ['b']])
})

test("two writers' same key are two writes, each resend told its own", async () => {
  let h = host()
  let ada = await (await h.write('a', 'k')).json()
  let bob = await (await h.write('b', 'k', 'bob')).json()
  equal([ada[0].doc.title, bob[0].doc.title], ['a', 'b'])
  equal((await (await h.write('b', 'k', 'bob')).json())[0].doc.title, 'b')
  equal(h.applied, ['a', 'b'])
})

test('a receipt under an outbox key is kept for good, any other for the resend window', async () => {
  let h = host()
  for (let key of ['k', 'outbox:k']) await h.write(key, key)
  h.at.t = 11 * 60_000
  // A later write expires what the window let go.
  await h.write('later', 'later')
  for (let key of ['k', 'outbox:k']) await (await h.write(key, key)).text()
  equal(h.applied, ['k', 'outbox:k', 'later', 'k'])
})

test('a key kept as its sender said it is named by its writer, and its resend is the write it repeats', async () => {
  let h = host()
  h.at.until = 1_000
  // Kept by code that took a key as it came.
  let seq = keep(h.db, h.sent('a', 'k'), '[]')
  equal([
    rekey(h.db, (r) => ({ by: r.headers.get('x-by')! })),
    rekey(h.db, () => null),
  ], [1, 0])
  equal(await told(await h.write('a', 'k')), [202, seq])
})
