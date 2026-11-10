// A reader that polls the bugs is told nothing moved while nothing did, by
// the instance it asked or the one the object woke as after hibernating.
import { equal, ok, test } from '@yaks/testing'
import { ram } from '@yaks/ram'
import { token } from '@yaks/graph'
import { type Kept, options, platform, store, vocab } from './core.ts'
import { sign } from './auth.ts'
import { door } from './door.ts'

let secret = 'scratch-tracker-secret'
let storage = ram(vocab, options), facts = new Map<string, string>()
let kept: Kept = { get: (k) => facts.get(k), set: (k, v) => facts.set(k, v) }
let instance = () => store(storage, { sink: () => {}, kept })
let g = instance()
let auth = await sign({
  scope: platform,
  person: 'box',
  admin: true,
  mark: true,
  exp: Date.now() / 1000 + 60,
}, secret)
let bug = '00000000-0000-4000-8000-0000000000b1'
await g.graph.apply([{ entity: { eid: bug }, bug: { fault: 'one' } }], {
  trusted: true,
})
let read = async (tag?: string, from = g, since = '') => {
  let r = await door(from, platform, secret)(
    new Request(`https://tracker.test/bugs?query=.bug${since}`, {
      headers: {
        authorization: `Bearer ${auth}`,
        ...tag ? { 'if-none-match': tag } : {},
      },
    }),
  )
  return { status: r.status, tag: r.headers.get('etag')!, body: await r.text() }
}
let first = await read()
let again = await read(first.tag)
// The tag as a reader holds it once Cloudflare compressed the answer.
let weak = await read(`W/${first.tag}`)
// The pool's own bookkeeping is no news to a reader: a run written, and
// deleted under its guard once done.
let run = '00000000-0000-4000-8000-0000000000e1'
await g.graph.apply([{
  entity: { eid: run },
  effect: { handler: 'nothing', state: 'pending' },
}], { trusted: true })
await g.graph.apply([{
  entity: { eid: run },
  $delete: true,
  $was: { effect: { state: token('pending') } },
}], { trusted: true })
// Nor is a trace, which has doors of its own.
await g.graph.apply([{
  entity: { eid: '00000000-0000-4000-8000-0000000000f1' },
  trace: { op: 'http', name: 'GET /', at: '2026-10-27T12:00:00Z' },
  during: { app: '00000000-0000-4000-8000-0000000000a1' },
}], { trusted: true })
let quiet = await read(first.tag)
await door(g, platform, secret)(
  new Request('https://tracker.test/archive', {
    method: 'POST',
    headers: { authorization: `Bearer ${auth}` },
    body: JSON.stringify({ bug }),
  }),
)
let moved = await read(first.tag)
let woke = await read(moved.tag, instance())
// A reader holding an older tag asks what moved since it: the archived bug,
// and the bug an occurrence was grouped into, never the pool's bookkeeping
// or a trace.
let since = (tag: string, from = g) =>
  read(tag, from, `&since=${encodeURIComponent(tag)}`)
let archived = await since(first.tag)
await g.graph.apply([{
  entity: { eid: '00000000-0000-4000-8000-0000000000c1' },
  error: { bug, at: '2026-10-27T12:00:00Z', message: 'again' },
}], { trusted: true })
let grouped = await since(moved.tag, instance())
let both = await since(first.tag)
let other = await since('"elsewhen.1"')

test('a reader holding an older tag is told which bugs moved since', () => {
  equal(JSON.parse(archived.body), { moved: [bug] })
  equal(archived.tag, moved.tag)
  equal(JSON.parse(grouped.body), { moved: [bug] })
  equal(JSON.parse(both.body), { moved: [bug] })
})

test('a tag of another era is answered with no moves, to be read whole', () => {
  equal(JSON.parse(other.body), { moved: null })
})

test('a reader holding the current tag is answered 304 with no body', () => {
  equal(first.status, 200)
  ok(JSON.parse(first.body).length == 1)
  equal([again.status, again.tag, again.body], [304, first.tag, ''])
  equal([weak.status, quiet.status], [304, 304])
})

test('a mark moves the tag, and the reader is answered in full', () => {
  equal(moved.status, 200)
  ok(moved.tag != first.tag)
  ok(JSON.parse(moved.body)[0].archived)
})

test('the instance woken after hibernation answers the tag it kept', () => {
  equal([woke.status, woke.tag], [304, moved.tag])
})
