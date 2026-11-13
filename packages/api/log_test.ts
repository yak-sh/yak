/// <reference lib="deno.ns" />
// The write log's door (receipts.ts `door`) over a host that stands in for a
// stopped object: a ram graph, its log in SQLite, and a window the case ends.
import { equal, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { open } from '@yaks/sqlite/db'
import { IDEMPOTENCY, raise } from './log.ts'
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
    arm: (t) => void armed.push(t),
    report: (e) => console.error(e),
  })
  g.use(log.plugin)
  let write = (title: string, key?: string) =>
    log.write(
      new Request('http://store/apply', {
        method: 'POST',
        headers: key ? { [IDEMPOTENCY]: key } : {},
        body: JSON.stringify([{ entity: { eid: title }, doc: { title } }]),
      }),
    )
  let titles = async () =>
    (await g.read('.doc')).map((b) => (b.doc as { title: string }).title)
  return { at, armed, applied, log, write, titles }
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
