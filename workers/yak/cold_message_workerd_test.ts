// Billed rows, not SQL text or returned-row cardinality: retained catalogs must
// not be reread every time a signed peer-only socket wakes its Store.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { workerd } from './probe.ts'
import type { coldMessages } from './cold_message_fixture.ts'

for (let outputs of [10, 500]) {
  test(`six cold signed messages do not replay ${outputs} retained outputs`, async () => {
    let k = workerd(),
      res = await fetch(
        `${k.base}/__play_cost/?coldmessages=1&outputs=${outputs}`,
      )
    assertEquals(res.status, 200, await res.clone().text())
    let report = await res.json() as Awaited<ReturnType<typeof coldMessages>>
    console.log('COLD_CATALOG_COST', JSON.stringify(report))
    assertEquals(report.messages, 6)
    assertEquals(report.total.written, 0)
    assert(
      report.total.read < 1500,
      `${outputs} outputs: ${report.total.read} billed rows for six messages`,
    )
  })
}
