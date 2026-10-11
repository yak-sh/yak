// Permission declarations survive schema and graph representations, and reject
// companions or references that cannot support the declared grant.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { schemaOf } from '@yaks/graph'
import {
  extendMeta,
  fromBundles,
  loadVocab,
  toBundles,
  type VocabDoc,
} from '@yaks/vocab'
import { toolCheck } from '../vocab/tools.ts'
import { memberKeywords, permitsIn, permitted } from './keywords.ts'

let declaration: VocabDoc = {
  package: '@test/requests',
  $defs: {
    entity: { component: true, type: 'object', properties: {} },
    request: {
      component: true,
      type: 'object',
      floor: 'owner',
      permit: { completed: 'target' },
      properties: {
        target: { type: 'string', ref: 'entity', death: 'keep' },
        text: { type: 'string' },
      },
    },
    completed: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
        via: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}
let load = (d = declaration) => loadVocab(d, [memberKeywords])
let changing = (permit: unknown): VocabDoc => ({
  ...declaration,
  $defs: {
    ...declaration.$defs,
    request: { ...declaration.$defs!.request, permit },
  },
})

test('permit survives published schemas and vocabulary entity roundtrips', () => {
  let v = load()
  let expected = { request: { completed: 'target' } }
  assertEquals(permitted(v), [])
  assertEquals(permitsIn(v), expected)
  assertEquals(permitsIn(load(schemaOf(v, { comps: v.all }))), expected)
  let rows = toBundles(
    declaration,
    (comp, props) => `${comp}:${JSON.stringify(props)}`,
  )
  assertEquals(
    permitsIn(loadVocab(fromBundles(rows), [memberKeywords])),
    expected,
  )
})

test('the member meta-schema validates the permit map shape', () => {
  let check = toolCheck(extendMeta([memberKeywords]))
  assertEquals(check(declaration), [])
  for (
    let permit of [null, 'target', ['target'], { completed: 1 }, {
      completed: 'request.target',
    }, { 'bad.name': 'target' }]
  ) {
    assert(check(changing(permit)).length)
  }
})

let invalidPermits = [
  null,
  [],
  { missing: 'target' },
  { completed: 'missing' },
  {
    completed: 'text',
  },
  { request: 'target' },
  { created: 'target' },
].map((permit) => load(changing(permit)))

let invalidMarks = [
  {
    ...declaration.$defs!.completed,
    properties: {
      ...declaration.$defs!.completed.properties,
      note: { type: 'string' },
    },
  },
  { ...declaration.$defs!.completed, wire: false },
].map((altered) =>
  load({
    ...declaration,
    $defs: { ...declaration.$defs, completed: altered },
  })
)

let invalidTargets = [
  { type: 'string', ref: 'missing', death: 'keep' },
  { type: 'string', ref: 'entity', death: 'keep', computed: true },
].map((target) =>
  load({
    ...declaration,
    $defs: {
      ...declaration.$defs,
      request: {
        ...declaration.$defs!.request,
        properties: { target },
      },
    },
  })
)

test('permit requires a declared stamp-only mark and a stored reference', () => {
  for (let v of invalidPermits) {
    assert(permitted(v).length)
    assertThrows(() => permitsIn(v))
  }
  for (let v of [...invalidMarks, ...invalidTargets]) {
    assert(permitted(v).length)
  }
})
