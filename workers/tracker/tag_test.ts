// A reader that polls the bugs is told nothing moved while nothing did.
import { equal, ok, test } from '@yaks/testing'
import { ram } from '@yaks/ram'
import { options, platform, store, vocab } from './core.ts'
import { sign } from './auth.ts'
import { door } from './door.ts'

let secret = 'scratch-tracker-secret'
let g = store(ram(vocab, options), { sink: () => {} })
let route = door(g, platform, secret)
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
let read = async (tag?: string) => {
  let r = await route(
    new Request('https://tracker.test/bugs?query=.bug', {
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
// The pool's own bookkeeping is no news to a reader: a run written, and
// deleted once done.
let run = '00000000-0000-4000-8000-0000000000e1'
await g.graph.apply([{
  entity: { eid: run },
  effect: { handler: 'nothing', state: 'pending' },
}], { trusted: true })
await g.graph.apply([{ entity: { eid: run }, $delete: true }], {
  trusted: true,
})
let kept = await read(first.tag)
await route(
  new Request('https://tracker.test/archive', {
    method: 'POST',
    headers: { authorization: `Bearer ${auth}` },
    body: JSON.stringify({ bug }),
  }),
)
let moved = await read(first.tag)

test('a reader holding the current tag is answered 304 with no body', () => {
  equal(first.status, 200)
  ok(JSON.parse(first.body).length == 1)
  equal([again.status, again.tag, again.body], [304, first.tag, ''])
  equal(kept.status, 304)
})

test('a mark moves the tag, and the reader is answered in full', () => {
  equal(moved.status, 200)
  ok(moved.tag != first.tag)
  ok(JSON.parse(moved.body)[0].archived)
})
