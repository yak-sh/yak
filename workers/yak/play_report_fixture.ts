// The same played minute supplies both the row-cost and embedding assertions.
// Its environment and stored history belong to the platform run, so execute
// it once and let both consumers inspect its complete immutable report.
import { assertEquals } from '@std/assert'
import { workerd } from './probe.ts'
import type { Report } from './play_cost_fixture.ts'

let minute: Promise<Report> | undefined
export let playReport = (): Promise<Report> =>
  minute ??= (async () => {
    let res = await fetch(`${workerd().base}/__play_cost/?players=2&minutes=1`)
    assertEquals(res.status, 200, await res.clone().text())
    return await res.json() as Report
  })()
