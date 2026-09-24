/// <reference lib="deno.ns" />
// What `history` answers: one bundle per committed batch, newest first,
// shaped like the write that made it and stamped with who made it. Plus the
// two things only a log can say — a death comes back as `$delete`, and an
// entity nothing ever touched has no history rather than an error.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { NOW, sync, wikiGraph } from './harness.ts'
import { journalDoc } from './vocab.ts'
import { runs } from './tools.ts'

let fixture = () => {
  let { g, j, sql } = wikiGraph()
  return {
    g,
    j,
    tools: runs({ sql }),
    apply: (change: Bundle[]) => sync(g.apply(change)),
  }
}

// What a host hands a run: the call, and a graph that says what an id
// addresses. `P-1` stands for a human id nothing else resolves.
let asked = (
  args: Record<string, unknown>,
  at: Record<string, string> = {},
): [Bundle, Graph] => [
  { entity: { eid: 'c1' }, call: { args } },
  {
    address: (ids: string[]) =>
      new Map(ids.filter((i) => at[i]).map((i) => [i, at[i]])),
  } as unknown as Graph,
]

let history = async (
  tools: ReturnType<typeof runs>,
  args: Record<string, unknown>,
  at: Record<string, string> = {},
) => await tools.history!(...asked(args, at)) as Bundle[]

let comp = (b: Bundle, name: string) => b[name] as Comp

Deno.test('the journal declares one tool and implements it', () => {
  assertEquals(
    loadTools(journalDoc, runs({ sql: null as never })).map((t) => [
      t.name,
      t.noun,
      t.verb,
    ]),
    [['history', 'history', undefined]],
  )
})

Deno.test('a history is the batches that touched it, newest first', async () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{
    entity: { eid: 'p1' },
    page: { title: 'Retro' },
    $actor: { by: 'ada', via: 'cli' },
  }])
  let said = await history(f.tools, { entity: 'p1' })
  assertEquals(said.map((b) => comp(b, 'page')), [
    { title: 'Retro' },
    { title: 'Kickoff' },
  ])
  assertEquals(said.map((b) => b.entity.eid), ['p1', 'p1'])
  // Who wrote it, when, and through what — the unowned batch says the moment
  // alone rather than an actor nobody was.
  assertEquals(comp(said[0], 'updated'), { at: NOW, by: 'ada', via: 'cli' })
  assertEquals(comp(said[1], 'updated'), { at: NOW })
})

Deno.test('a limit counts back from the newest', async () => {
  let f = fixture()
  for (let title of ['one', 'two', 'three']) {
    f.apply([{ entity: { eid: 'p1' }, page: { title } }])
  }
  let said = await history(f.tools, { entity: 'p1', limit: 2 })
  assertEquals(said.map((b) => comp(b, 'page').title), ['three', 'two'])
})

Deno.test('a death answers as the death it was', async () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  f.apply([{ entity: { eid: 'p1' }, $delete: true }])
  let [said] = await history(f.tools, { entity: 'p1' })
  assertEquals(said.$delete, true)
  assert(!said.page, 'a death carries no properties forward')
})

Deno.test('an id is whatever the graph says it addresses', async () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' } }])
  let said = await history(f.tools, { entity: 'P-1' }, { 'P-1': 'p1' })
  assertEquals(said.map((b) => comp(b, 'page')), [{ title: 'Kickoff' }])
})

Deno.test('nothing ever written about has no history, and no entity is a refusal', async () => {
  let f = fixture()
  assertEquals(await history(f.tools, { entity: 'nobody' }), [])
  let refused = await history(f.tools, { entity: '  ' }).catch((e) => e)
  assertEquals((refused as Error).name, 'Refused')
})
