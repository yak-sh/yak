import { equal, test } from '@yaks/testing'
import { componentTables } from './physical.ts'
import { heldBy } from './archetype.ts'
import { by, type Driver, insert, val } from '@yaks/sql'
import { mem } from './testing.ts'

// A database of these tables: `entity` and `infrastructure` keyed by `id`,
// the rest by `entity`, as a component's table is.
let file = (tables: Record<string, { name: string; type: string }[]>) => {
  let driver = mem()
  for (let [name, cols] of Object.entries(tables)) {
    let key = name == 'entity' || name == 'infrastructure' ? 'id' : 'entity'
    driver.query({
      t: 'create table',
      name,
      cols: [{ name: key, type: 'integer', pk: true }, ...cols],
    })
  }
  return driver
}
// How many column rows the driver's table_info pragmas have read since.
let counted = (driver: Driver) => {
  let query = driver.query.bind(driver), rows = 0
  driver.query = (statement) => {
    let found = query(statement)
    if (statement.t == 'pragma' && statement.name == 'table_info') {
      rows += found.length
    }
    return found
  }
  return () => rows
}

let known = file({ known: [], hidden: [], infrastructure: [] })
let knownRows = counted(known)
test('component discovery reads only tables the caller has not accounted for', () => {
  equal(componentTables(known, ['known']), ['hidden'])
  equal(knownRows(), 2)
  equal(componentTables(known, ['hidden']), ['known'])
  equal(knownRows(), 3)
  equal(componentTables(known), ['hidden', 'known'])
  equal(knownRows(), 3)
})

let held = file({
  entity: [
    { name: 'eid', type: 'text' },
    { name: 'archetype', type: 'integer' },
  ],
  archetype: [{ name: 'tables', type: 'text' }],
  doc: [],
  hidden: [],
  unused: [],
  infrastructure: [],
})
held.query(insert('entity', { id: 1, eid: 'descriptor' }))
held.query(insert('entity', { id: 2, eid: 'owner', archetype: 1 }))
held.query(insert('archetype', {
  entity: 1,
  tables: JSON.stringify(['doc', 'hidden', 'infrastructure', 'missing']),
}))
let heldRows = counted(held)
test('removal discovers the physical tables its descriptor names, with a fallback for unknown owners', () => {
  equal(heldBy(held, ['owner']), ['doc', 'hidden'])
  equal(heldRows(), 3)
  held.query({
    t: 'update',
    table: 'entity',
    set: { archetype: val(null) },
    where: by({ eid: 'owner' }),
  })
  equal(heldBy(held, ['owner']), ['archetype', 'doc', 'hidden', 'unused'])
  equal(heldRows(), 6)
})
