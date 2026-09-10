import { assert, assertEquals, assertThrows } from '@std/assert'
import { type Bundle, type Comp, detached, token } from '@yaks/graph'
import { apply, fleetGraphOf, readComp } from '../db.ts'
import { bareDb } from '../testdb.ts'
import { asChanges } from './wire.ts'
import { normalizeFleet } from './fleet_normalize.ts'

let ids = Object.fromEntries(
  ['d', 'actor', 'setting', 'old', 'targeted', 'new'].map((
    k,
  ) => [k, crypto.randomUUID()]),
)
let edit = (old: string, fresh: string) => ({ $edit: { old, new: fresh } })

// Keep both paths covered until the live mutation flip. Their normalization
// hooks are identical now, but their admission/stamping/mutation paths are not.
for (let mode of ['live', 'core']) {
  Deno.test(`${mode} normalize: ordered edits and explicit $was use FOUND state`, () => {
    let db = bareDb()
    let write = (bundles: Bundle[]) =>
      mode == 'core' ? fleetGraphOf(db).apply(bundles) : apply(
        db,
        bundles.flatMap((b) =>
          asChanges(b).map((c) => ({
            ...c,
            ...(b.$was?.[c.name] ? { was: b.$was[c.name] } : {}),
          }))
        ),
      )
    write([{ entity: { eid: ids.d }, doc: { body: 'stored' } }])
    write([
      { entity: { eid: ids.d }, doc: { body: 'literal' } },
      { entity: { eid: ids.d }, doc: { body: edit('literal', 'first') } },
      {
        entity: { eid: ids.d },
        doc: { body: edit('first', 'second') },
        $was: { doc: { body: token('stored') } },
      },
    ])
    assertEquals(readComp(db, ids.d, 'doc')?.body, 'second')
    assertThrows(() =>
      write([
        { entity: { eid: ids.d }, doc: { body: 'literal' } },
        {
          entity: { eid: ids.d },
          doc: { body: edit('literal', 'bad') },
          $was: { doc: { body: token('literal') } },
        },
      ])
    )
    assertEquals(readComp(db, ids.d, 'doc')?.body, 'second')
    write([
      { entity: { eid: ids.d }, doc: { body: 'pending' } },
      { entity: { eid: ids.d }, doc: null },
      { entity: { eid: ids.d }, doc: { body: edit('second', 'after drop') } },
    ])
    assertEquals(readComp(db, ids.d, 'doc')?.body, 'after drop')
    assertThrows(
      () =>
        write([
          { entity: { eid: ids.d }, doc: { body: null } },
          { entity: { eid: ids.d }, doc: { body: edit('after drop', 'bad') } },
        ]),
      Error,
      'has no text value to edit',
    )
    assertEquals(readComp(db, ids.d, 'doc')?.body, 'after drop')
    db.close()
  })

  Deno.test(`${mode} normalize: edit → wake replacement → settings, atomically`, () => {
    let db = bareDb()
    let g = fleetGraphOf(db)
    let write = (bundles: Bundle[]) =>
      mode == 'core' ? g.apply(bundles) : apply(db, bundles.flatMap(asChanges))
    write([
      { entity: { eid: ids.actor }, doc: { title: 'actor' } },
      {
        entity: { eid: ids.setting },
        setting: { key: 'OLLAMA_BASE_URL', value: 'https://one/' },
      },
      {
        entity: { eid: ids.old },
        wake: { at: '2030-01-01T00:00:00Z' },
        deliver: { to: ids.actor },
      },
      {
        entity: { eid: ids.targeted },
        wake: { at: '2030-01-01T00:00:00Z', target: ids.actor },
        deliver: { to: ids.actor },
      },
    ])
    let replacement: Bundle = {
      entity: { eid: ids.new },
      wake: { at: '2030-01-02T00:00:00Z' },
      deliver: { to: ids.actor },
    }
    assertThrows(() =>
      write([
        replacement,
        {
          entity: { eid: ids.setting },
          setting: { value: edit('https://one', 'ftp://bad') },
        },
      ])
    )
    assert(readComp(db, ids.old, 'wake'))
    assertEquals(readComp(db, ids.new, 'wake'), undefined)
    assertEquals(readComp(db, ids.setting, 'setting')?.value, 'https://one')
    let seen = false
    g.use({
      name: 'assert-normalized',
      hooks: {
        normalize: (b) => {
          assert(db.inTransaction)
          assert(b.some((b) => b.entity.eid == ids.old && b.$delete))
          assertEquals(
            (b.find((b) => b.setting)?.setting as Comp).value,
            'https://two',
          )
          seen = true
          return b
        },
      },
    })
    write([
      replacement,
      { entity: { eid: ids.setting }, setting: { value: edit('one', 'two/') } },
    ])
    assert(seen)
    assertEquals(readComp(db, ids.old, 'wake'), undefined)
    assert(readComp(db, ids.targeted, 'wake'))
    assertEquals(readComp(db, ids.setting, 'setting')?.value, 'https://two')
    db.close()
  })
}

Deno.test('fleet normalize hooks refuse detached unlocked use', () => {
  let db = bareDb()
  let g = fleetGraphOf(db)
  assertEquals(g.plugins.slice(0, 3).map((p) => p.name), [
    'graph/edits',
    'fleet/replace-wakes',
    'fleet/guard-settings',
  ])
  for (let p of g.plugins.slice(0, 3)) {
    assertThrows(
      () => p.hooks!.normalize!([], detached(g.storage)),
      Error,
      'requires the outer write transaction',
    )
  }
  db.close()
})

Deno.test('fleet edits reject numeric, enum, reference and boolean columns before mutation', () => {
  let db = bareDb()
  let eid = crypto.randomUUID()
  for (
    let [name, col] of [['pin', 'x'], ['role', 'state'], ['deliver', 'to'], [
      'repo',
      'push',
    ]]
  ) {
    for (let core of [false, true]) {
      let comp = { [col]: edit('x', 'y') }
      assertThrows(
        () =>
          core
            ? fleetGraphOf(db).apply([{ entity: { eid }, [name]: comp }])
            : apply(db, [{ eid, name, comp }]),
        Error,
        `.${name}.${col} is not a wire-writable text column`,
      )
    }
  }
  assertEquals(db.prepare('select count(*) as n from entity').get()?.n, 0)
  db.close()
})

Deno.test('fleet core late refusal rolls back wake replacement and normalized setting', () => {
  let db = bareDb()
  let g = fleetGraphOf(db)
  g.apply([
    { entity: { eid: ids.actor }, doc: { title: 'actor' } },
    {
      entity: { eid: ids.setting },
      setting: { key: 'OLLAMA_BASE_URL', value: 'https://one' },
    },
    {
      entity: { eid: ids.old },
      wake: { at: '2030-01-01T00:00:00Z' },
      deliver: { to: ids.actor },
    },
  ])
  g.use({
    name: 'late refusal',
    hooks: {
      commit: () => {
        throw new Error('refused after mutation')
      },
    },
  })
  assertThrows(
    () =>
      g.apply([
        {
          entity: { eid: ids.new },
          wake: { at: '2030-01-02T00:00:00Z' },
          deliver: { to: ids.actor },
        },
        {
          entity: { eid: ids.setting },
          setting: { value: edit('one', 'two/') },
        },
      ]),
    Error,
    'refused after mutation',
  )
  assert(readComp(db, ids.old, 'wake'))
  assertEquals(readComp(db, ids.new, 'wake'), undefined)
  assertEquals(readComp(db, ids.setting, 'setting')?.value, 'https://one')
  db.close()
})

Deno.test('live normalize bridge preserves explicit spines and their guards', () => {
  let db = bareDb()
  let eid = crypto.randomUUID()
  let changes = [{ eid, name: 'entity', comp: {}, was: { eid: null } }]
  assertEquals(
    db.transaction(() => normalizeFleet(db, fleetGraphOf(db), changes), true),
    changes,
  )
  db.close()
})
