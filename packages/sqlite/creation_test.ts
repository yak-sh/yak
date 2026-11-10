// Stable client ids are created through the graph's transactional guard,
// against both storage adapters and the existing private-row authority.
import { cleanup, test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, graph, Refused, Stale, token } from '@yaks/graph'
import type { Was } from '@yaks/graph/bundle'
import { Denied, personal } from '@yaks/member'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { open } from './db.ts'

let vocab = loadVocab({
  $defs: {
    note: { component: true, properties: { title: { type: 'string' } } },
    other: { component: true, properties: {} },
    secret: {
      component: true,
      properties: {
        by: { type: 'string', ref: 'entity', death: 'keep' },
        text: { type: 'string' },
      },
    },
  },
})
let create = (eid: string): Bundle => ({
  entity: { eid },
  note: { title: 'Saved draft' },
  $was: { entity: { eid: null } },
})
let makers = {
  RAM: () => ram(vocab),
  SQLite: () => {
    let db = open(':memory:')
    cleanup(() => db.close())
    let store = storage(db, vocab)
    store.install()
    return store
  },
}

for (let [name, store] of Object.entries(makers)) {
  let fresh = () => graph({ vocab, storage: store() })
  let saved = fresh()
  test(`${name} creates a stable id once, then reports its retained identity on retry`, async () => {
    let id = 'd3c11c00-395f-4dbb-a301-66bd5e81e082'
    await saved.apply([create(id)])
    assertEquals((await saved.get([id]))[0].note, { title: 'Saved draft' })
    let error = assertThrows(() => saved.apply([create(id)]), Stale)
    assertEquals(error.current, id)
    assertEquals(error.comp, 'entity')
    assertEquals(error.prop, 'eid')
    // A recovered row can be edited under ordinary value guards.
    await saved.apply([{
      entity: { eid: id },
      note: { title: 'Recovered draft' },
      $was: { note: { title: token('Saved draft') } },
    }])
    assertEquals((await saved.get([id]))[0].note, { title: 'Recovered draft' })
  })

  for (let kind of ['unrelated', 'identity', 'tombstone']) {
    let g = fresh()
    let id = crypto.randomUUID()
    await g.apply([{
      entity: { eid: id },
      ...kind == 'identity' ? {} : { other: {} },
    }])
    if (kind == 'tombstone') {
      await g.apply([{ entity: { eid: id }, $delete: true }])
    }
    let before = await g.get([id])
    test(`${name} first creation collides with an existing ${kind} and rolls back its batch`, async () => {
      assertThrows(() =>
        g.apply([
          { entity: { eid: 'prefix' }, note: { title: 'Must not commit' } },
          create(id),
        ]), Stale)
      assertEquals(await g.get([id]), before)
      assertEquals(await g.get(['prefix']), [])
    })
  }

  let buried = fresh()
  await buried.apply([{
    entity: { eid: 'buried' },
    note: { title: 'Deleted' },
  }])
  await buried.apply([{ entity: { eid: 'buried' }, $delete: true }])
  test(`${name} existence and property guards retain delete-race and revival semantics`, async () => {
    for (
      let was of [
        { entity: { eid: token('buried') } },
        { note: { title: token('Deleted') } },
      ] as Was[]
    ) {
      await buried.apply([{
        entity: { eid: 'buried' },
        note: { title: 'Raced deletion' },
        $was: was,
      }])
      assertEquals((await buried.get(['buried']))[0].tombstone, {})
    }
    await buried.apply([{
      entity: { eid: 'buried' },
      note: { title: 'Revived' },
      $was: { note: { title: null } },
    }])
    assertEquals((await buried.get(['buried']))[0].note, { title: 'Revived' })
  })

  let hidden = fresh()
  await hidden.apply([
    { entity: { eid: 'alice' }, other: {} },
    { entity: { eid: 'bob' }, other: {} },
    {
      entity: { eid: 'private' },
      secret: { by: 'alice', text: 'Private draft' },
    },
  ])
  hidden.use(personal(vocab, { secret: 'by' }))
  test(`${name} a hidden identity is never treated as absent or disclosed by its guard`, async () => {
    assertEquals(
      await hidden.get(['private'], undefined, { person: 'bob' }),
      [],
    )
    let error = assertThrows(() =>
      hidden.apply([{
        ...create('private'),
        $actor: { by: 'bob' },
      }]), Denied)
    assertEquals('current' in error, false)
    assertEquals((await hidden.get(['private']))[0].secret, {
      by: 'alice',
      text: 'Private draft',
    })
  })

  let malformed = fresh()
  test(`${name} identity metadata guards still refuse unknown properties`, () => {
    assertThrows(
      () =>
        malformed.apply([{
          ...create('bad'),
          $was: { entity: { eidd: null } },
        }]),
      Refused,
      'entity.eidd',
    )
    assertThrows(
      () =>
        malformed.apply([{
          ...create('bad'),
          $was: { unknown: { eid: null } },
        }]),
      Refused,
      'unknown component',
    )
  })
}
