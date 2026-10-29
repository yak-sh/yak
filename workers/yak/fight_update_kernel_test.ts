import { assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { state } from './testing.ts'
import { fightUpdate } from './fight_update_fixture.ts'

test('legacy fight text moves losslessly through the guarded owner cutover', async () => {
  let r = await fightUpdate(state('probe/fight-update').storage)
  assertEquals(r.status, 400)
  assertStringIncludes(r.refusal.message, 'fight.dealt is already text')
  assertEquals(r.afterCheck, r.original)
  assertEquals(r.afterRestoreCheck, r.missing)
  assertEquals(r.after.length, r.original.length)
  for (let old of r.original) {
    let row = r.after.find((b) => b.entity.eid == old.entity.eid)!
    let fight = old.fight as { dealt: string }
    assertEquals(row.fight, { ...fight, dealt: JSON.parse(fight.dealt) })
    assertEquals(row.doc, old.doc)
    assertEquals(row.person, old.person)
  }
  assertEquals(r.again, [])
})
