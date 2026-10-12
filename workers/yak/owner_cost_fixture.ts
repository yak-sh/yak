// Finite owner reads over many unrelated shapes, counted by workerd.
import { driver, type DurableStorage } from '@yaks/durable-object'
import { reader } from '@yaks/sqlite/reader'
import {
  ownerCases,
  ownerVocab,
  seedOwners,
} from '../../packages/sql/owner_fixture_test.ts'

export let ownerCost = (storage: DurableStorage) => {
  let hot = seedOwners(driver(storage))
  return ownerCases.map((example) => {
    let read = 0, written = 0
    let db = driver(storage, (s) => {
      read += s.rowsRead
      written += s.rowsWritten
    })
    let door = reader(db, ownerVocab, example.hot ? { archetypes: hot } : {})
    let rows = door.rows(example.query, example.opts)
    return { ...example, actual: rows, read, written }
  })
}
