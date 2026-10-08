// T-65275, the owner's bar, verbatim: "while playing, i'd expect double digit
// read/writes max per player per minute." Two heroes play a minute the way
// Vale's page does (play_cost_fixture.ts); this is expected to fail until
// playing costs that little. Rows are workerd's SQL cursor counts, index rows
// included, never returned rows or estimates, and each is attributed to one
// source: relays, walking (the watches a page opens and closes as it moves),
// live queries, saves, gathering, fighting, chatting or effects.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { Report } from './play_cost_fixture.ts'

test('Vale play reads and writes at most 99 rows per player-minute (expected to fail until fix)', async () => {
  let k = workerd()
  let res = await fetch(`${k.base}/__play_cost/?players=2&minutes=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as Report
  console.log('PLAY_COST', JSON.stringify(report))
  for (let metric of ['read', 'written', 'calls'] as const) {
    assertEquals(
      Object.values(report.sources).reduce((n, c) => n + c[metric], 0),
      report.total[metric],
    )
    assertEquals(
      Object.values(report.components).reduce((n, c) => n + c[metric], 0),
      report.total[metric],
    )
  }
  assert(
    report.total.read / (report.players * report.minutes) <= 99 &&
      report.total.written / (report.players * report.minutes) <= 99,
    `rows/player-minute: ${
      report.total.read / (report.players * report.minutes)
    } read, ${
      report.total.written / (report.players * report.minutes)
    } written (expected failure until T-65275 fix)`,
  )
})

test('joining Vale reads a bounded number of rows independent of retained history', async () => {
  let k = workerd()
  let reports: Report[] = []
  for (let history of [100, 79000]) {
    let res = await fetch(
      `${k.base}/__play_cost/?players=1&join=1&history=${history}`,
    )
    assertEquals(res.status, 200, await res.clone().text())
    let r = await res.json() as Report
    console.log('JOIN_COST', JSON.stringify(r))
    reports.push(r)
  }
  assert(
    reports[1].opening.read <= reports[0].opening.read + 20,
    `joining: ${reports.map((r) => r.opening.read)} rows as history grows`,
  )
})
