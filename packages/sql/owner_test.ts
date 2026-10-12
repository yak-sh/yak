// A named owner read does not transfer an unrelated archetype catalog.
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { driver } from '../sqlite/native.ts'
import { reader } from '@yaks/sqlite/reader'
import {
  orderedOwners,
  ownerCases,
  ownerVocab,
  seedOwners,
} from './owner_fixture_test.ts'
import type { Row } from './core.ts'

let db = new Database(':memory:'), base = driver(db)
let hot = seedOwners(base)
for (let example of ownerCases) {
  // A new reader/driver identity starts with a cold catalog for each case.
  let read = 0
  let d = {
    ...base,
    query: (q: Parameters<typeof base.query>[0]) => {
      let rows = base.query(q)
      read += rows.length
      return rows
    },
  }
  let door = reader(d, ownerVocab, example.hot ? { archetypes: hot } : {})
  // This case pins OR membership, not cold-catalog cost; the Worker fixture
  // measures its cold path. Prepare its schema snapshot outside the case.
  if (!example.bounded) door.rows(example.query, example.opts)
  test(`finite owners: ${example.name}`, () => {
    let rows = door.rows(example.query, example.opts)
    assertEquals(orderedOwners(rows as Row[]), orderedOwners(example.rows))
    if (example.bounded) assert(read < 20, `${read} transferred rows`)
  })
}
