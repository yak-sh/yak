/// <reference lib="deno.ns" />
// A query as a value: it answers at once, it answers again when a local write
// moves it, it answers again when the server pushes one, and it stops when it
// is closed.

import { assertEquals } from '@std/assert'
import { type Bundle, transient } from '@yaks/graph'
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
  assertEquals(made.length, 2)

  c.mutate([dal()])
  // The page reads the signal; the watch wrote to it.
  assertEquals(titles(made[0].value as Bundle[]), ['Dal'])
  assertEquals(dinners.value, made[0].value)
  c.close()
})

Deno.test('closing during an asynchronous first read cannot resurrect a watch', async () => {
  let c = boxClient()
  let initial = c.graph.read.bind(c.graph)
  let release!: (rows: Bundle[]) => void
  c.graph.read = () => new Promise<Bundle[]>((resolve) => release = resolve)
  let watch = c.watch('.recipe')
  watch.close()
  release([])
  await Promise.resolve()
  assertEquals(c.watches.size(), 0)
  c.graph.read = initial
  c.close()
})

Deno.test('closing a client during an asynchronous read closes its pending watches', async () => {
  let c = boxClient()
  let release!: (rows: Bundle[]) => void
  c.graph.read = () => new Promise<Bundle[]>((resolve) => release = resolve)
  c.watch('.recipe')
  c.close()
  release([])
  await Promise.resolve()
  assertEquals(c.watches.size(), 0)
})

Deno.test('local ready is reactive and an empty asynchronous answer notifies', async () => {
  let c = boxClient()
  let release!: (rows: Bundle[]) => void
  c.graph.read = () => new Promise<Bundle[]>((resolve) => release = resolve)
  let w = c.watch('.recipe')
  let heard: boolean[] = []
  w.subscribe(() => heard.push(w.ready))
  assertEquals(w.ready, false)
  release([])
  await Promise.resolve()
  assertEquals(w.ready, true)
  assertEquals(heard, [true])
  c.close()
})

Deno.test('identical local watches share evaluation but not listener ownership', () => {
  let c = boxClient()
  let a = c.watch('.recipe')
  let b = c.watch('.recipe', { remote: false })
  assertEquals(c.watches.size(), 1)
  assertEquals(a.ready, true)
  let heard = 0
  let same = () => heard++
  a.subscribe(same)
  b.subscribe(same)
  a.close()
  a.close()
  a.subscribe(same) // a closed handle cannot acquire another listener
  c.mutate([dal()])
  assertEquals(heard, 1)
  assertEquals(titles(b.value), ['Dal'])
  assertEquals(c.watches.size(), 1)
  b.close()
  assertEquals(c.watches.size(), 0)
  c.close()
})

Deno.test('remote watches share one sub until the last independent close', async () => {
  let c = boxClient(server())
  let a = c.watch('.course=dinner')
  let b = c.watch('.course=dinner', { remote: true })
  assertEquals(a.ready, false)
  assertEquals(b.ready, false)
  assertEquals(c.watches.size(), 1)
  let heard: boolean[] = []
  b.subscribe(() => heard.push(b.ready))
  await c.idle()
  assertEquals(a.ready, true)
  assertEquals(b.ready, true)
  assertEquals(heard, [true]) // an empty answer is still an answer
  assertEquals(c.socket()?.sent, [{ subscribe: '.course=dinner', id: 's1' }])
  a.close()
  a.close()
  assertEquals(c.socket()?.sent.length, 1)
  b.close()
  assertEquals(c.socket()?.sent.at(-1), { unsubscribe: 's1' })
  assertEquals(c.watches.size(), 0)
  let again = c.watch('.course=dinner')
  await c.idle()
  assertEquals(c.socket()?.sent.at(-1), {
    subscribe: '.course=dinner',
    id: 's2',
  })
  assertEquals(again.ready, true)
  c.close()
  assertEquals(c.socket()?.sent.at(-1), { unsubscribe: 's2' })
})

Deno.test('different options and query text never collapse into one watch', async () => {
  let c = boxClient(server())
  c.watch('.recipe')
  c.watch('.recipe', { remote: false })
  c.watch('.recipe', { now: 1 })
  c.watch('.recipe', { now: 2 })
  c.watch('.course=dinner')
  assertEquals(c.watches.size(), 5)
  await c.idle()
  assertEquals(c.socket()?.sent.length, 4)
  c.close()
  assertEquals(c.watches.size(), 0)
})

Deno.test('cached results do not make a new or disconnected remote watch ready', async () => {
  let srv = server()
  let c = boxClient(srv)
  c.mutate([dal()])
  await c.idle()
  let w = c.watch('.recipe')
  assertEquals(titles(w.value), ['Dal'])
  assertEquals(w.ready, false)
  await c.idle()
  assertEquals(w.ready, true)
  let heard: boolean[] = []
  w.subscribe(() => heard.push(w.ready))
  let old = c.socket()!
  old.close()
  assertEquals(w.ready, false)
  assertEquals(titles(w.value), ['Dal'])
  c.fire()
  await c.idle()
  assertEquals(w.ready, true)
  assertEquals(heard[0], false)
  assertEquals(heard.at(-1), true)
  old.emit('message', JSON.stringify({ id: 's1', bundles: [dal('late')] }))
  assertEquals(c.ent('late'), undefined)
  c.close()
})

Deno.test('late frames after unsubscribe cannot refill the graph', async () => {
  let c = boxClient(server())
  let w = c.watch('.recipe')
  await c.idle()
  w.close()
  c.socket()!.emit(
    'message',
    JSON.stringify({ id: 's1', bundles: [dal('late')] }),
  )
  assertEquals(c.ent('late'), undefined)
  assertEquals(c.wire!.ready('s1'), false)
  c.close()
})

Deno.test('a refused remote subscription is never ready', async () => {
  let c = boxClient(server())
  let w = c.watch('.recipe')
  await c.idle()
  c.socket()!.emit(
    'message',
    JSON.stringify({
      id: 's1',
      refused: { error: 'Refused', message: 'permission changed' },
    }),
  )
  assertEquals(w.ready, false)
  assertEquals(c.trouble.length, 1)
  c.close()
})

Deno.test('closing one watch does not disconnect other transient observers', async () => {
  const { client } = await import('./client.ts')
  const { loadVocab } = await import('@yaks/vocab')
  const c = client(
    loadVocab([{
      $defs: { text: { properties: { body: { type: 'string' } } } },
    }]),
    [],
    { vault: false },
  )
  try {
    c.mutate([{ entity: { eid: 'd' }, text: { body: '' } }])
    const first = c.watch('.text'), second = c.watch('.text.body=')
    first.close()
    const live = await transient(c.graph).begin('d', 'text', 'body', 's')
    live.append('visible')
    assertEquals(second.value[0].text, { body: 'visible' })
    live.discard()
    assertEquals(second.value[0].text, { body: '' })
  } finally {
    c.close()
  }
})
