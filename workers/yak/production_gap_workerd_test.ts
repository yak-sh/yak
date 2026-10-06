// Diagnostic reproduction: retained app declarations are not replaced by a
// platform deploy. Names costs missing from latest-source warm fixtures.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { workerd } from './probe.ts'
for (let history of [100, 79000]) {
  test(`retained Vale schedules include transcript history ${history} in workerd profile`, async () => {
    let k = workerd()
    let r = await fetch(
      `${k.base}/__play_cost/?production=1&history=${history}&villagers=6&turns=32`,
    )
    assertEquals(r.status, 200, await r.clone().text())
    let report = await r.json()
    console.log('PRODUCTION_GAP', JSON.stringify(report))
    assert(
      report.total.read < 130000,
      `retained release alarm scans history: ${report.total.read}`,
    )
  })
}
