/// <reference lib="deno.ns" />
// The promises the registry makes: a birth fires once, a change fires only for
// the properties that moved, a death fires for the component and for every
// casualty it took with it, a failing handler is reported and its neighbours
// still run, a write-back lands, and a refused batch fires nothing.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle, Tx } from '@yaks/graph'
import { isPromise } from '@yaks/graph'
import { effects, type Run } from './registry.ts'
import type { Event } from './trace.ts'
import { blog, blogGraph } from './harness.ts'

let sync = <T>(out: T | Promise<T>): T => {
  assert(!isPromise(out), 'apply() went async over a Map')
  return out as T
}

// A registry, a graph with it registered, and the log the handlers write to.
let fixture = () => {
  let seen: string[] = []
  let oops: Run[] = []
  let fx = effects(blog, { report: (_e, run) => oops.push(run) })
  let g = blogGraph([fx])
  let apply = (change: Bundle[]) => sync(g.apply(change))
  return { fx, g, seen, oops, apply }
}

let post = (eid: string, comp: Record<string, unknown> = { title: 'One' }) => ({
  entity: { eid },
  post: comp,
})

Deno.test('a created handler fires once per new component', () => {
  let { fx, seen, apply } = fixture()
  fx.created(
    'post',
    (e) => seen.push(`created ${e.entity.eid} ${e.comp?.title}`),
  )
  apply([post('p1')])
  assertEquals(seen, ['created p1 One'])
  // a patch to the same component is not a second birth
  apply([post('p1', { title: 'Two' })])
  assertEquals(seen.length, 1)
})

Deno.test('a birth patched again in the same batch is one birth', () => {
  let { fx, seen, apply } = fixture()
  fx.created('post', (e) => seen.push(`created ${e.entity.eid}`))
  fx.changed('post', (e) => seen.push(`changed ${e.entity.eid}`))
  apply([post('p1'), post('p1', { published: true })])
  assertEquals(seen, ['created p1', 'changed p1'])
})

Deno.test('a created handler sees the num storage minted', () => {
  let { fx, seen, apply } = fixture()
  fx.created('post', (e) => seen.push(String(e.entity.num)))
  apply([post('p1')])
  assertEquals(seen, ['1'])
})

Deno.test('changed fires only for the properties that moved', () => {
  let { fx, seen, apply } = fixture()
  fx.changed('post', 'published', (e) => seen.push(`published ${e.entity.eid}`))
  fx.changed('post', 'title', () => seen.push('retitled'))
  apply([post('p1')])
  assertEquals(seen, [], 'a birth is not a change')
  apply([post('p1', { published: true })])
  assertEquals(seen, ['published p1'])
  apply([post('p1', { title: 'Two' })])
  assertEquals(seen, ['published p1', 'retitled'])
})

Deno.test('a property-less changed handler fires for any patch', () => {
  let { fx, seen, apply } = fixture()
  fx.changed('post', (e) => seen.push(Object.keys(e.comp ?? {}).join(',')))
  apply([post('p1')])
  apply([post('p1', { title: 'Two', published: true })])
  assertEquals(seen, ['title,published'])
})

Deno.test('a changed event carries only the patch, not the whole row', () => {
  let { fx, seen, apply } = fixture()
  fx.changed('post', (e) => seen.push(JSON.stringify(e.comp)))
  apply([post('p1', { title: 'One', body: 'text' })])
  apply([post('p1', { published: true })])
  assertEquals(seen, ['{"published":true}'])
})

Deno.test('removed fires when a component is dropped', () => {
  let { fx, seen, apply } = fixture()
  fx.removed('post', (e) => seen.push(`gone ${e.entity.eid}`))
  apply([post('p1')])
  apply([{ entity: { eid: 'p1' }, post: null }])
  assertEquals(seen, ['gone p1'])
  // and not again: there is nothing left to drop
  apply([{ entity: { eid: 'p1' }, post: null }])
  assertEquals(seen.length, 1)
})

Deno.test('removed fires for every component a dead entity carried', () => {
  let { fx, seen, apply } = fixture()
  fx.removed('post', () => seen.push('post'))
  fx.removed('created', () => seen.push('created'))
  apply([post('p1')])
  apply([{ entity: { eid: 'p1' }, $delete: true }])
  assertEquals(seen.sort(), ['created', 'post'])
})

Deno.test('removed fires for every casualty of a cascade', () => {
  let { fx, seen, apply } = fixture()
  fx.removed('comment', (e) => seen.push(e.entity.eid))
  apply([
    post('p1'),
    { entity: { eid: 'c1' }, comment: { text: 'nice', post: 'p1' } },
    { entity: { eid: 'c2' }, comment: { text: 'also', post: 'p1' } },
  ])
  assertEquals(seen, [])
  apply([{ entity: { eid: 'p1' }, $delete: true }])
  assertEquals(seen.sort(), ['c1', 'c2'])
})

Deno.test('a throwing handler is reported and the others still run', () => {
  let { fx, seen, oops, apply } = fixture()
  fx.created('post', () => {
    throw new Error('boom')
  })
  fx.created('post', () => seen.push('second'))
  apply([post('p1')])
  assertEquals(seen, ['second'])
  assertEquals(oops.map((o) => o.handler), ['post.created'])
})

Deno.test('a rejecting handler is reported, and the batch still returns', async () => {
  let { fx, seen, oops, g } = fixture()
  fx.created('post', () => Promise.reject(new Error('boom')))
  fx.created('post', () => seen.push('second'))
  let out = await g.apply([post('p1')])
  assertEquals(out.filter((b) => b.post).length, 1)
  assertEquals(seen, ['second'])
  assertEquals(oops.map((o) => o.handler), ['post.created'])
})

Deno.test("a handler's write-back commits and is visible", () => {
  let { fx, g, apply } = fixture()
  fx.changed('post', 'published', (e, tx: Tx) => {
    tx.patch([{ entity: { eid: 's1' }, subscriber: { email: e.entity.eid } }])
  })
  apply([post('p1')])
  apply([post('p1', { published: true })])
  let [sub] = g.read('.subscriber!') as Bundle[]
  assertEquals((sub.subscriber as Record<string, unknown>).email, 'p1')
})

Deno.test('a handler may write back through the graph itself', () => {
  let { fx, g, apply } = fixture()
  fx.created('post', (e) =>
    sync(g.apply([{
      entity: { eid: 's1' },
      subscriber: { email: `${e.entity.eid}@blog` },
    }])))
  apply([post('p1')])
  assertEquals((g.read('.subscriber!') as Bundle[]).length, 1)
})

Deno.test('nothing fires when the batch is refused', () => {
  let { fx, seen, oops, apply } = fixture()
  fx.created('post', () => seen.push('fired'))
  fx.removed('post', () => seen.push('fired'))
  assertThrows(() => apply([{ entity: { eid: 'p1' }, post: { nope: 1 } }]))
  assertEquals(seen, [])
  assertEquals(oops, [])
})

Deno.test('nothing fires when a hook refuses inside the transaction', () => {
  let seen: string[] = []
  let fx = effects(blog)
  let doorman = {
    name: 'doorman',
    hooks: {
      commit: (): never => {
        throw new Error('refused at commit')
      },
    },
  }
  let g = blogGraph([fx, doorman])
  fx.created('post', () => seen.push('fired'))
  assertThrows(() => sync(g.apply([post('p1')])))
  assertEquals(seen, [])
})

Deno.test('the batch a caller gets back carries no pipeline keys', () => {
  let { fx, apply } = fixture()
  fx.created('post', () => {})
  let out = apply([post('p1')])
  for (let b of out) {
    assertEquals(Object.keys(b).filter((k) => k.startsWith('$')), [])
  }
})

Deno.test('an unwatched batch costs nothing and still returns its bundles', () => {
  let { apply } = fixture()
  let out = apply([post('p1')])
  assertEquals(out.filter((b) => b.post).length, 1)
})

Deno.test('slots list what a graph will do about a write', () => {
  let { fx } = fixture()
  let noop = (_e: Event) => {}
  fx.created('post', noop).changed('post', 'published', noop)
    .changed('post', noop).removed('post', noop).created('post', noop)
  assertEquals(fx.slots().map((s) => s.id), [
    'post.created',
    'post.changed.published',
    'post.changed',
    'post.removed',
    'post.created#2',
  ])
})

Deno.test('an async handler makes that one apply a promise', async () => {
  let { fx, seen, g } = fixture()
  fx.created('post', () => Promise.resolve().then(() => seen.push('late')))
  let out = g.apply([post('p1')])
  assert(isPromise(out), 'an async effect should defer the answer')
  await out
  assertEquals(seen, ['late'])
})

// A pattern registration: any query over what the batch committed, with
// nothing derived into the graph to trigger it.

Deno.test('a pattern fires where this batch made it hold', () => {
  let { fx, seen, apply } = fixture()
  fx.on('.post, !comments', (e) => seen.push(e.entity.eid))
  apply([post('p1')])
  assertEquals(seen, ['p1'])
  // p1 still has no comments, but this batch is not about p1.
  apply([post('p2')])
  assertEquals(seen, ['p1', 'p2'])
  // and now it has one, so it is not what the pattern is about any more
  apply([{ entity: { eid: 'c1' }, comment: { text: 'hi', post: 'p1' } }])
  apply([post('p1', { title: 'Again' })])
  assertEquals(seen, ['p1', 'p2'])
})

Deno.test('a pattern is a query, not a property subscription', () => {
  let { fx, seen, apply } = fixture()
  fx.on('.post.title=Ready', (e) => seen.push(e.entity.eid))
  apply([post('p1', { title: 'Draft' })])
  assertEquals(seen, [])
  apply([post('p1', { title: 'Ready' })])
  assertEquals(seen, ['p1'])
})

Deno.test('a removal is the same registration said in the grammar', () => {
  let { fx, seen, apply } = fixture()
  fx.on('-post', (e) => seen.push(`gone ${e.entity.eid}`))
  apply([post('p1')])
  assertEquals(seen, [])
  apply([{ entity: { eid: 'p1' }, post: null }])
  assertEquals(seen, ['gone p1'])
  // `-post` alone is what an event already says, so it is the slot
  // `fx.removed('post')` always made: one name, one kind, one line of docs —
  // and a store that answers no bindings is never asked anything.
  assertEquals(fx.slots().map((s) => s.id), ['post.removed'])
  assertEquals(fx.docs().map((d) => d.hooks), [['removed']])
})

Deno.test('a pattern names its component, and lists beside the rest', () => {
  let { fx } = fixture()
  fx.on('.post, !comments', () => {})
  fx.created('post', () => {})
  assertEquals(fx.slots().map((s) => s.id), ['post.matched', 'post.created'])
  assertEquals(fx.docs().map((d) => d.hooks), [['matched'], ['created']])
})

Deno.test('a word this vocabulary has no entry for says nothing, or nothing at all', () => {
  let { fx, seen, apply } = fixture()
  // Nothing here can wear `archived`, so requiring its absence is no
  // constraint — one sentence, right in a graph that has the word and in one
  // that does not.
  fx.on('.post, !archived', (e) => seen.push(`open ${e.entity.eid}`))
  // Requiring its presence can never hold: registered, listed, never woken.
  fx.on('.post, .archived', (e) => seen.push(`gone ${e.entity.eid}`))
  apply([post('p1')])
  assertEquals(seen, ['open p1'])
  assertEquals(fx.slots().length, 2)
})

Deno.test('a pattern over two entities needs a storage that answers bindings', () => {
  let { fx, oops, apply } = fixture()
  fx.on('$p .post; .comment, comment.post=$p', () => {})
  // The batch committed; a question this storage cannot answer is telemetry.
  apply([post('p1')])
  assertEquals(oops.map((j) => j.handler), ['post.matched'])
})
