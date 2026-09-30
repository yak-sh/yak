import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { signal } from '@preact/signals'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { parseHTML } from 'linkedom'
import { h, render } from 'preact'
import { boxClient, server } from '../client/testing.ts'
import type { Answer, Asks } from './host.ts'
import { docs } from './front.ts'
import { live } from './live.ts'

// A host over a recipe box served in this process, and a view that asks
// `asks` and keeps each answer it was drawn with, last first.
let hosted = async (asks: Asks) => {
  let srv = server()
  await srv.graph.apply([
    {
      entity: { eid: 'r1' },
      doc: { title: 'Dal' },
      recipe: { course: 'dinner' },
    },
    {
      entity: { eid: 'r2' },
      doc: { title: 'Soup' },
      recipe: { course: 'starter' },
    },
  ])
  let box = boxClient(srv, { signal })
  let front = client(loadVocab(docs), [], { vault: false })
  let host = live({ box, front, edits: true })
  let got: Record<string, Answer> = {}
  let View = () => {
    got = host.useAnswers(asks)
    return null
  }
  let { document } = parseHTML('<main></main>')
  let root = document.querySelector('main')!
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  render(h(View, null), root)
  let settle = async () => {
    await box.idle()
    await srv.flush()
    await box.idle()
  }
  await settle()
  return {
    host,
    srv,
    box,
    got: () => got,
    settle,
    [Symbol.dispose]: () => {
      render(null, root)
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      box.close()
    },
  }
}

test('a view is answered rows, counts and tallies, live, from the server', async () => {
  using t = await hosted({
    rows: '.recipe',
    count: '.recipe&.count',
    tally: '.recipe&.tally=recipe.course',
    once: { query: '.recipe&.count', once: true },
    first: { query: '.recipe&.order=doc.title&?doc', once: true },
  })
  await until(() => Object.values(t.got()).every((a) => a.ready))
  let read = () => {
    let g = t.got()
    return [
      g.rows.rows.map((b) => b.entity.eid).sort(),
      g.count.count,
      g.tally.tally,
      g.once.count,
      g.first.rows.map((b) => (b.doc as { title: string }).title),
    ]
  }
  assertEquals(read(), [
    ['r1', 'r2'],
    2,
    { dinner: 1, starter: 1 },
    2,
    ['Dal', 'Soup'],
  ])
  await t.host.apply([
    {
      entity: { eid: 'r3' },
      doc: { title: 'Bread' },
      recipe: { course: 'dinner' },
    },
  ])
  await until(() => t.got().count.count == 3)
  await t.settle()
  // A line asked once keeps its first answer.
  assertEquals(read(), [
    ['r1', 'r2', 'r3'],
    3,
    { dinner: 2, starter: 1 },
    2,
    ['Dal', 'Soup'],
  ])
})

test('a line the server refuses answers why', async () => {
  using t = await hosted({ nope: '.recipe.nope=1' })
  await until(() => t.got().nope.error)
  assertEquals(t.got().nope.ready, false)
})

test('a write the graph refuses rejects, saying why', async () => {
  using t = await hosted({})
  let why = await Promise.resolve(
    t.host.apply([{ entity: { eid: 'r1' }, recipe: { course: 'brunch' } }]),
  ).then(() => '', (e: Error) => e.message)
  assertEquals(why.includes('course'), true)
})
