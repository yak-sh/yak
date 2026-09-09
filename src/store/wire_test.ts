// The production shape seam: preserve ordered patches and guards on the way
// in, and lower only committed components and identity on the way out.
import { assertEquals } from '@std/assert'
import type { Change } from '../types.ts'
import { asBundle, asChanges } from './wire.ts'

Deno.test('wire: lift ordered patches, component drops and guards', () => {
  let changes: Change[] = [
    { eid: 'a', name: 'doc', comp: { title: 'first' } },
    {
      eid: 'a',
      name: 'doc',
      comp: { title: null },
      was: { title: 'sha256', body: null },
    },
    { eid: 'a', name: 'task', comp: null },
  ]
  assertEquals(changes.map(asBundle), [
    { entity: { eid: 'a' }, doc: { title: 'first' } },
    {
      entity: { eid: 'a' },
      doc: { title: null },
      $was: { doc: { title: 'sha256', body: null } },
    },
    { entity: { eid: 'a' }, task: null },
  ])
})

Deno.test('wire: entity deletion lifts and both death spellings lower', () => {
  let death: Change = { eid: 'a', name: 'entity', comp: null }
  assertEquals(asBundle(death), { entity: { eid: 'a' }, $delete: true })
  assertEquals(asChanges(asBundle(death)), [death])
  assertEquals(
    asChanges({ entity: { eid: 'a', num: 3 }, tombstone: {}, doc: null }),
    [death],
  )
})

Deno.test('wire: lower minted identity and components, not pipeline metadata', () => {
  assertEquals(
    asChanges({
      entity: { eid: 'a', num: 0 },
      doc: { title: 'committed' },
      task: null,
      $actor: { via: 'writer' },
      $was: { doc: { title: null } },
    }),
    [
      { eid: 'a', name: 'entity', comp: { eid: 'a', num: 0 } },
      { eid: 'a', name: 'doc', comp: { title: 'committed' } },
      { eid: 'a', name: 'task', comp: null },
    ],
  )
  assertEquals(asChanges({ entity: { eid: 'a' } }), [])
})
