// T-125710: a page sends {entity: order.entity, ...} after reading the order.
// Exercise the actual graph pipeline, not only pure component admission.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { archetypeDoc, archetypes, eidOf } from '@yaks/archetype'
import { ram } from '@yaks/ram'
import { type Bundle, dead } from './bundle.ts'
import { graph } from './graph.ts'
import { Refused } from './admit.ts'
import { comp, slow } from './testing.ts'

let vocab = loadVocab([archetypeDoc, {
  $defs: {
    entity: {
      component: true,
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    note: { component: true, properties: { text: { type: 'string' } } },
    other: { component: true, properties: {} },
    created: {
      component: true,
      properties: { at: { type: 'string', stamped: true } },
    },
  },
}])

let fixture = async (async: boolean) => {
  let storage = ram(vocab)
  let admitted: Bundle[] = []
  let g = graph({
    vocab,
    storage: async ? slow(storage) : storage,
    plugins: [archetypes(), {
      name: 'observe-admission',
      hooks: {
        // Normalization must not be able to hide a non-identity stamp.
        normalize: (bs) => bs.map(({ created: _created, ...b }) => b),
        admit: (bs) => (admitted = bs, bs),
      },
    }],
  })
  await g.apply([{ entity: { eid: 'row' }, note: { text: 'before' } }])
  let [read] = await g.get(['row'])
  assert(read.entity.archetype)
  assert(comp(read, 'created').at)
  return { g, read, admitted: () => admitted }
}

for (let async of [false, true]) {
  for (let remove of [false, true]) {
    for (let changed of [false, true]) {
      for (let check of [false, true]) {
        let { g, read, admitted } = await fixture(async)
        let original = structuredClone(read)
        test(`read identity permits ${remove ? 'tombstone' : 'write'} (async=${async}, changed=${changed}, check=${check})`, async () => {
          // Identity equality is deliberately not required. These are ignored
          // address metadata, never authority to set the number or shape.
          let entity = changed
            ? { ...read.entity, num: 999999, archetype: 'not-the-stored-shape' }
            : read.entity
          let sent: Bundle = {
            entity,
            ...(remove
              ? { $delete: true }
              : { note: { text: 'after' }, other: {} }),
          }
          let before = structuredClone(sent)
          let [out] = await g.apply([sent], { check })
          assertEquals(sent, before, 'admission must not mutate the caller')
          assertEquals(read, original, 'a cached read must remain intact')
          assertEquals(admitted()[0].entity, { eid: 'row' })
          assertEquals(dead(out), remove)
          assertEquals(out.entity.num, original.entity.num)
          assertEquals(
            out.entity.archetype,
            eidOf(remove ? ['tombstone'] : ['created', 'note', 'other']),
          )
          let [stored] = await g.get(['row'])
          if (check) assertEquals(stored, original)
          else {
            assertEquals(dead(stored), remove)
            assertEquals(stored.entity, out.entity)
            if (!remove) assertEquals(comp(stored, 'note').text, 'after')
          }
        })
      }
    }
    for (let at of ['forged', null]) {
      let { g, read } = await fixture(async)
      test(`non-identity stamp ${at} refuses ${remove ? 'tombstone' : 'write'} before normalization (async=${async})`, async () => {
        for (let check of [false, true]) {
          await assertRejects(
            async () =>
              await g.apply([
                {
                  entity: { eid: 'innocent' },
                  note: { text: 'must not land' },
                },
                {
                  entity: read.entity,
                  ...(remove
                    ? { $delete: true }
                    : { note: { text: 'forged' } }),
                  created: { at },
                },
              ], { check }),
            Refused,
            'created.at is server-owned',
          )
          assertEquals(await g.get(['row', 'innocent']), [read])
        }
      })
    }
  }
}
