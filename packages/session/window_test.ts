import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
let tracked = () => {
  let vocab = loadVocab([sessionDoc, toolsDoc, {
    $defs: {
      entity: {
        component: true,
        wire: false,
        properties: { eid: { type: 'string' } },
      },
    },
  }])
  return graph({ storage: ram(vocab), vocab })
}
import { transcriptBack, transcriptPlan, transcriptWindow } from './window.ts'
test('transcript windows bound bodies, support both edges and entry anchors', async () => {
  let g = tracked()
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    ...Array.from({ length: 100 }, (_, i) => ({
      entity: { eid: 'e' + i },
      entry: { session: 's', seq: i + 1 },
      content: { body: 'x'.repeat(10000) },
    })),
  ])
  let calls: string[] = [], read = g.read.bind(g)
  g.read = ((q: string, ...args: unknown[]) => {
    calls.push(q)
    return read(q, ...args as [])
  }) as typeof g.read
  let tail = await transcriptWindow(g, 's', { limit: 10 })
  assertEquals(
    tail.entries.map((b) => b.entity.eid),
    Array.from({ length: 10 }, (_, i) => 'e' + (90 + i)),
  )
  assertEquals([tail.before, tail.after], [true, false])
  assert(calls.every((q) => q.includes('.fields=') || q.includes('.limit=10')))
  let head = await transcriptWindow(g, 's', { limit: 10, edge: 'start' })
  assertEquals(head.entries[0].entity.eid, 'e0')
  assertEquals([head.before, head.after], [false, true])
  let middle = await transcriptWindow(g, 's', { limit: 10, anchor: 'e50' })
  assertEquals(
    middle.entries.map((b) => b.entity.eid),
    Array.from({ length: 10 }, (_, i) => 'e' + (45 + i)),
  )
  assertEquals([middle.before, middle.after], [true, true])
  let back = async (before: string) => {
    let page = await transcriptWindow(g, 's', { limit: 10, before })
    return [page.entries[0]?.entity.eid, page.entries.length, page.before]
  }
  assertEquals(await back('e90'), ['e80', 10, true])
  assertEquals(await back('e5'), ['e0', 5, false])
})
test('nested fork page crosses stable ancestor boundaries without newer parent output', async () => {
  let g = tracked()
  await g.apply([
    { entity: { eid: 'p' }, session: {} },
    ...Array.from(
      { length: 10 },
      (_, i) => ({
        entity: { eid: 'p' + i },
        entry: { session: 'p', seq: i + 1 },
        content: { body: String(i) },
      }),
    ),
  ])
  await g.apply([{ entity: { eid: 'c' }, session: {}, fork: { from: 'p5' } }, {
    entity: { eid: 'c0' },
    entry: { session: 'c', seq: 7 },
    content: { body: 'child' },
  }])
  await g.apply([{ entity: { eid: 'd' }, session: {}, fork: { from: 'c0' } }, {
    entity: { eid: 'd0' },
    entry: { session: 'd', seq: 8 },
    content: { body: 'deep' },
  }])
  let page = await transcriptWindow(g, 'd', { limit: 5 })
  assertEquals(page.entries.map((b) => b.entity.eid), [
    'p3',
    'p4',
    'p5',
    'c0',
    'd0',
  ])
  assertEquals([page.before, page.after], [true, false])
  let empty = await transcriptPlan(g, 'd', { anchor: 'not-present', limit: 1 })
  assertEquals(empty.queries.length, 1)
})
test('a transcript is read back only as far as a reading needs, through its forks', async () => {
  let g = tracked()
  let line = (session: string, i: number) => ({
    entity: { eid: session + i },
    entry: { session, seq: i + 1 },
    content: { body: String(i) },
  })
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    ...Array.from({ length: 100 }, (_, i) => line('s', i)),
    { entity: { eid: 'p' }, session: {} },
    ...Array.from({ length: 10 }, (_, i) => line('p', i)),
    { entity: { eid: 'c' }, session: {}, fork: { from: 'p5' } },
    { entity: { eid: 'c0' }, entry: { session: 'c', seq: 7 } },
  ])
  let back = async (session: string, eid?: string) => {
    let { entries, whole } = await transcriptBack(
      g,
      session,
      (read) => read.some((b) => b.entity.eid == eid),
    )
    return [entries[0].entity.eid, entries.length, whole]
  }
  assertEquals(await back('s', 's90'), ['s68', 32, false])
  assertEquals(await back('s', 's10'), ['s4', 96, false])
  assertEquals(await back('s', 's1'), ['s0', 100, true])
  assertEquals(await back('c', 'c0'), ['c0', 1, false])
  assertEquals(await back('c', 'p4'), ['p0', 7, true])
  assertEquals(await back('c'), ['p0', 7, true])
})
