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

test('retained Vale alarm restores retained outputs and active village readers', async () => {
  let k = workerd()
  let r = await fetch(
    `${k.base}/__play_cost/?production=1&history=79000&villagers=6&turns=32&outputs=50&cold=1`,
  )
  assertEquals(r.status, 200, await r.clone().text())
  console.log('RETAINED_COLD_ALARM', JSON.stringify(await r.json()))
})

test(
  'retained active villager legacy transcripts are included in the alarm',
  async () => {
    let k = workerd()
    let r = await fetch(
      `${k.base}/__play_cost/?production=1&history=100&villagers=6&turns=256&outputs=50&cold=1&unsequenced=1`,
    )
    assertEquals(r.status, 200, await r.clone().text())
    console.log('RETAINED_LEGACY_ALARM', JSON.stringify(await r.json()))
  },
  { tags: ['legacy'] },
)

test(
  'retained long villager transcripts count the real alarm readers',
  async () => {
    let k = workerd()
    let r = await fetch(
      `${k.base}/__play_cost/?production=1&history=100&villagers=6&turns=10240&outputs=50&cold=1&unsequenced=1`,
    )
    assertEquals(r.status, 200, await r.clone().text())
    console.log('RETAINED_LONG_ALARM', JSON.stringify(await r.json()))
  },
  { tags: ['long'] },
)
