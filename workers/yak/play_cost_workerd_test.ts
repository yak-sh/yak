// T-65275: this budget is EXPECTED TO FAIL until play's storage costs are fixed.
// Baseline after ee46a358f: 2 players, 79k synthetic history entities;
// 15,521 reads / 234 writes per player-minute. Opening: 8,366 reads/player.
// Inclusive index writes are counted by workerd's cursor, not estimated.
// Source reads/writes per player: live queries 6302.5/0, saves 4603/8,
// relays 3623.5/15.5, gathering 485/105.5, fighting 334.5/74.5,
// chatting 144/30.5, effects 28.5/0. Attribution is exclusive SQL-table
// and operation context; joined rows cannot be decomposed by cursor counters.
// Keep measuring with real workerd counters, not returned rows or SQL estimates.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { Report } from './play_cost_fixture.ts'

test('Vale play reads and writes at most 99 rows per player-minute (expected to fail until fix)', async () => {
  let k = workerd()
  let res = await fetch(`${k.base}/__play_cost/?players=2`)
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
    report.total.read / report.players <= 99 &&
      report.total.written / report.players <= 99,
    `rows/player-minute: ${report.total.read / report.players} read, ${
      report.total.written / report.players
    } written (expected failure until T-65275 fix)`,
  )
})
