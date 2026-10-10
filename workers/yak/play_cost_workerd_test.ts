// T-65275, the owner's bar, verbatim: "while playing, i'd expect double digit
// read/writes max per player per minute." Two heroes play a minute the way
// Vale's page does (play_cost_fixture.ts). Until playing costs that little,
// the test holds what the cuts so far have won (`HELD`), so a change that
// costs more is red while the gate stays green; lower it as cuts land. Rows are workerd's SQL cursor counts, index rows
// included, never returned rows or estimates, and each is attributed to one
// source: relays, walking (the watches a page opens and closes as it moves),
// live queries, saves, gathering, fighting, chatting or effects.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { Report } from './play_cost_fixture.ts'

/** Rows per player-minute: the owner's bar, and what is held until then. The
 * same play measures one peer save more on some runs (T-121700), so the held
 * numbers are the higher of the two. */
let BAR = 99
let HELD = { read: 251, written: 188.5 }

test('Vale play costs no more rows per player-minute than it has been cut to', async () => {
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
  let per = (n: number) => n / (report.players * report.minutes)
  let read = per(report.total.read), written = per(report.total.written)
  console.log(
    `rows/player-minute: ${read} read, ${written} written (bar ${BAR})`,
  )
  assert(
    read <= HELD.read && written <= HELD.written,
    `rows/player-minute: ${read} read, ${written} written, over the held ` +
      `${HELD.read} read, ${HELD.written} written (T-65275)`,
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
