import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { workerd } from './probe.ts'
test('a projected latest entry page reads only its selected owners', async () => {
  let k = workerd(), r = await fetch(`${k.base}/__play_cost/?entrypage=1`)
  assertEquals(r.status, 200, await r.clone().text())
  let report = await r.json()
  console.log('ENTRY_PAGE_COST', JSON.stringify(report))
  assertEquals(report.rows[0]['entry.seq'], 20000)
  assert(report.total.read < 100, `latest projection read ${report.total.read}`)
})
