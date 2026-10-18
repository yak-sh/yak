import { driver, type DurableStorage } from '@yaks/durable-object'
import { population } from '../../packages/sqlite/population.ts'
import { reader } from '@yaks/sqlite/reader'
import {
  seedTallies,
  tallyScope,
  tallyVocab,
} from '../../packages/sql/scoped_tally_fixture_test.ts'
export let scopedTallyCost = (storage: DurableStorage) => {
  let fixture = seedTallies(driver(storage), 2048)
  population(driver(storage))
  return [
    '.tally=entity.archetype',
    `.edge .edge.from.entity.archetype=${fixture.private} .tally=entity.archetype`,
    `.edge .edge.to.entity.archetype=${fixture.private} .tally=entity.archetype`,
  ].map((query) => {
    let read = 0, written = 0
    let db = driver(storage, (s) => {
      read += s.rowsRead
      written += s.rowsWritten
    })
    let door = reader(db, tallyVocab, { archetypes: fixture.catalog })
    let rows = door.rows(query, tallyScope)
    return { query, rows, read, written }
  })
}
