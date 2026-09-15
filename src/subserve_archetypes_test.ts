import { assertEquals } from '@std/assert'
import { bareDb } from './testdb.ts'
import { apply } from './db.ts'
import { subserve } from './subserve.ts'
import { routeName, ROW } from './live.ts'
import type { Change } from './types.ts'

type Rider = {
  changes?: Change[]
  snapshot?: { changes: Change[] }
  archetypes?: Change[]
}
let tablesIn = (f: Rider) =>
  f.archetypes?.map((c) => (c.comp as { tables: string }).tables)

Deno.test("a row's archetype descriptor rides its first frame, once per socket", () => {
  let db = bareDb()
  let eid = crypto.randomUUID()
  try {
    apply(db, [
      { eid, name: 'task', comp: {} },
      { eid, name: 'doc', comp: { title: 'Face', body: 'b' } },
    ])
    let frames: Rider[] = []
    let server = subserve(db, (f) => {
      if (!Array.isArray(f)) frames.push(f as Rider)
    })
    server.frame({ since: 0, seed: eid })
    let seed = frames.at(-1)!
    let wearing = seed.snapshot!.changes.find((c) => c.name == 'entity')!
    let archetype = (wearing.comp as { archetype: string }).archetype
    assertEquals(seed.archetypes?.map((c) => c.eid), [archetype])
    assertEquals(tablesIn(seed)?.[0].includes('doc'), true)
    server.frame({ sub: routeName(eid, ROW), q: `id=${eid}` })
    assertEquals(frames.at(-1)!.archetypes, undefined)
  } finally {
    db.close()
  }
})
