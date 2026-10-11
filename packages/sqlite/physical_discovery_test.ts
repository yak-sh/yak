import { equal, test } from '@yaks/testing'
import { componentTables } from './physical.ts'
import { heldBy } from './archetype.ts'
import { by, insert, val } from '@yaks/sql'
import { mem } from './testing.ts'

test('component discovery reads only tables the caller has not accounted for', () => {
  let driver = mem()
  for (let name of ['known', 'hidden']) {
    driver.query({
      t: 'create table',
      name,
      cols: [{ name: 'entity', type: 'integer', pk: true }],
    })
  }
  driver.query({
    t: 'create table',
    name: 'infrastructure',
    cols: [{ name: 'id', type: 'integer', pk: true }],
  })
  let query = driver.query.bind(driver)
  let rows = 0
  driver.query = (statement) => {
    let found = query(statement)
    if (statement.t == 'pragma' && statement.name == 'table_info') {
      rows += found.length
    }
    return found
  }
  equal(componentTables(driver, ['known']), ['hidden'])
  equal(rows, 2)
  equal(componentTables(driver, ['hidden']), ['known'])
  equal(rows, 3)
  equal(componentTables(driver), ['hidden', 'known'])
  equal(rows, 3)
})

test('removal discovers the physical tables its descriptor names, with a fallback for unknown owners', () => {
  let driver = mem()
  driver.query({
    t: 'create table',
    name: 'entity',
    cols: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'eid', type: 'text' },
      { name: 'archetype', type: 'integer' },
    ],
  })
  for (let name of ['archetype', 'doc', 'hidden', 'unused']) {
    driver.query({
      t: 'create table',
      name,
      cols: [
        { name: 'entity', type: 'integer', pk: true },
        ...name == 'archetype' ? [{ name: 'tables', type: 'text' }] : [],
      ],
    })
  }
  driver.query({
    t: 'create table',
    name: 'infrastructure',
    cols: [{ name: 'id', type: 'integer', pk: true }],
  })
  driver.query(insert('entity', { id: 1, eid: 'descriptor' }))
  driver.query(insert('entity', { id: 2, eid: 'owner', archetype: 1 }))
  driver.query(insert('archetype', {
    entity: 1,
    tables: JSON.stringify(['doc', 'hidden', 'infrastructure', 'missing']),
  }))
  let query = driver.query.bind(driver)
  let rows = 0
  driver.query = (statement) => {
    let found = query(statement)
    if (statement.t == 'pragma' && statement.name == 'table_info') {
      rows += found.length
    }
    return found
  }
  equal(heldBy(driver, ['owner']), ['doc', 'hidden'])
  equal(rows, 3)
  driver.query({
    t: 'update',
    table: 'entity',
    set: { archetype: val(null) },
    where: by({ eid: 'owner' }),
  })
  equal(heldBy(driver, ['owner']), ['archetype', 'doc', 'hidden', 'unused'])
  equal(rows, 6)
})
