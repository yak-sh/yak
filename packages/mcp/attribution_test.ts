/// <reference lib="deno.ns" />
// Connection attribution keeps the actor a transcript works as, and its run.

import { assertEquals } from '@std/assert'
import { type Actor, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { sessionDoc, speaking } from '@yaks/session'
import { test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { writer } from './mount.ts'

let vocab = loadVocab([sessionDoc, {
  $defs: {
    person: { component: true, properties: {} },
    persona: { component: true, properties: {} },
    project: { component: true, properties: {} },
    filed: {
      component: true,
      properties: { project: { type: 'string', ref: 'project' } },
    },
  },
}])
let g = graph({ storage: ram(vocab), vocab })
await g.apply([
  { entity: { eid: 'person' }, person: {} },
  { entity: { eid: 'agent' }, persona: {} },
  { entity: { eid: 'project' }, project: {} },
  {
    entity: { eid: 'worn' },
    session: { actor: 'person', persona: 'agent' },
  },
  { entity: { eid: 'filed' }, session: {}, filed: { project: 'project' } },
  { entity: { eid: 'human' }, session: { actor: 'person' } },
  { entity: { eid: 'empty' }, session: {} },
])

for (
  let [run, by] of [['worn', 'agent'], ['filed', 'project'], [
    'human',
    'person',
  ]]
) {
  let session = await speaking(g, (await g.get([run]))[0])
  test(`a connection writes by ${by} through ${run}, preserving its own actor`, () => {
    assertEquals(writer(session, { by: 'person' }), { by, via: run })
  })
}

let empty = await speaking(g, (await g.get(['empty']))[0])
for (
  let [login, expected] of [
    [{ by: 'external' }, { by: 'external', via: 'empty' }],
    [{ by: 'process', via: 'process' }, { via: 'empty' }],
    [null, { via: 'empty' }],
  ] as [Actor | null, Actor][]
) {
  test(`an unnamed connection keeps its run with login ${login?.by ?? 'none'}`, () => {
    assertEquals(writer(empty, login), expected)
  })
}
