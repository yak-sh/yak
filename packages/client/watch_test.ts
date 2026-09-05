/// <reference lib="deno.ns" />
// A query as a value: it answers at once, it answers again when a local write
// moves it, it answers again when the server pushes one, and it stops when it
// is closed.

import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { boxClient, server, titles } from './harness.ts'
import type { Hold, Make } from './watch.ts'

let dal = (eid = 'r1', serves = 4): Bundle => ({
  entity: { eid },
  doc: { title: 'Dal' },
  recipe: { serves, course: 'dinner' },
})

Deno.test('a watch answers now, and again on a local apply', () => {
  let c = boxClient()
  c.mutate([dal()])

  let dinners = c.watch('.course=dinner')
  assertEquals(titles(dinners.value), ['Dal'])

  let heard: string[][] = []
  dinners.subscribe((bundles) => heard.push(titles(bundles)))

  c.mutate([{
    entity: { eid: 'r2' },
    doc: { title: 'Pie' },
    recipe: { serves: 6, course: 'dinner' },
  }])
  assertEquals(titles(dinners.value), ['Dal', 'Pie'])
  assertEquals(heard, [['Dal', 'Pie']])
  c.close()
})

Deno.test('an entity that stops matching leaves the answer', () => {
  let c = boxClient()
  c.mutate([dal()])
  let dinners = c.watch('.course=dinner')

  c.mutate([{ entity: { eid: 'r1' }, recipe: { course: 'pudding' } }])
  assertEquals(dinners.value, [])
  c.close()
})

Deno.test('a deleted entity leaves the answer', () => {
  let c = boxClient()
  c.mutate([dal()])
  let dinners = c.watch('.course=dinner')

  c.mutate([{ entity: { eid: 'r1' }, $delete: true }])
  assertEquals(dinners.value, [])
  c.close()
})

Deno.test('an unrelated write does not wake a watch', () => {
  let c = boxClient()
  c.mutate([dal()])
  let dinners = c.watch('.course=dinner')
  let heard = 0
  dinners.subscribe(() => heard++)

  c.mutate([{ entity: { eid: 'n1' }, note: { stars: 5, recipe: 'r1' } }])
  assertEquals(heard, 0)
  c.close()
})

Deno.test('an ordered query re-reads, and comes back in order', () => {
  let c = boxClient()
  c.mutate([dal('r1', 4), { ...dal('r2', 9), doc: { title: 'Pie' } }])

  let most = c.watch('.course=dinner&.order=-serves')
  assertEquals(titles(most.value), ['Pie', 'Dal'])

  c.mutate([{ entity: { eid: 'r1' }, recipe: { serves: 20 } }])
  assertEquals(titles(most.value), ['Dal', 'Pie'])
  c.close()
})

Deno.test('a watch stops after close', () => {
  let c = boxClient()
  let dinners = c.watch('.course=dinner')
  let heard = 0
  dinners.subscribe(() => heard++)

  dinners.close()
  c.mutate([dal()])
  assertEquals(heard, 0)
  assertEquals(dinners.value, [])
  assertEquals(c.watches.size(), 0)
  c.close()
})

Deno.test('one listener stops without stopping the watch', () => {
  let c = boxClient()
  let dinners = c.watch('.course=dinner')
  let heard = 0
  let stop = dinners.subscribe(() => heard++)
  stop()

  c.mutate([dal()])
  assertEquals(heard, 0)
  assertEquals(titles(dinners.value), ['Dal'])
  c.close()
})

Deno.test('a watch hears a frame the server pushed', async () => {
  let srv = server()
  let a = boxClient(srv)
  let b = boxClient(srv)

  let dinners = b.watch('.course=dinner')
  let heard: string[][] = []
  dinners.subscribe((bundles) => heard.push(titles(bundles)))
  await b.idle()

  a.mutate([dal()])
  await a.idle()
  assertEquals(titles(dinners.value), ['Dal'])
  assertEquals(heard.at(-1), ['Dal'])

  // And the departure the client could not have worked out for itself.
  a.mutate([{ entity: { eid: 'r1' }, recipe: { course: 'pudding' } }])
  await a.idle()
  assertEquals(dinners.value, [])
  a.close()
  b.close()
})

Deno.test('a closed watch drops the server subscription', async () => {
  let srv = server()
  let c = boxClient(srv)
  let dinners = c.watch('.course=dinner')
  await c.idle()

  assertEquals(c.socket()?.sent, [
    { subscribe: '.course=dinner', id: 's1' },
  ])
  dinners.close()
  assertEquals(c.socket()?.sent.at(-1), { unsubscribe: 's1' })
  c.close()
})

Deno.test('a signal factory backs the value', () => {
  let made: Hold<unknown>[] = []
  let signal: Make = <T>(value: T) => {
    let held = { value }
    made.push(held)
    return held
  }
  let c = boxClient(undefined, { signal })
  let dinners = c.watch('.course=dinner')
  assertEquals(made.length, 1)

  c.mutate([dal()])
  // The page reads the signal; the watch wrote to it.
  assertEquals(titles(made[0].value as Bundle[]), ['Dal'])
  assertEquals(dinners.value, made[0].value)
  c.close()
})
