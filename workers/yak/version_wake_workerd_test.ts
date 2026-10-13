// Every commit on main is a new Worker version, and the request that first
// wakes a Store under it is somebody's. It pays what an ordinary wake pays;
// what the deploy owes the Store (its deployment pass, planner statistics)
// is the alarm's, and costs rows in proportion to what changed, not to what
// the Store holds (version_wake_fixture.ts).
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { Cost } from './release_cost_fixture.ts'
import type { appWake, directoryWake } from './version_wake_fixture.ts'

type Report = Awaited<ReturnType<typeof directoryWake | typeof appWake>>

let probe = async (kind: string, history: number): Promise<Report> => {
  let res = await fetch(
    `${workerd().base}/__play_cost/?version-wake=${kind}&history=${history}`,
  )
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as Report
  console.log('VERSION_WAKE', kind, JSON.stringify(report))
  return report
}

let near = (what: string, cost: Cost, ordinary: Cost) =>
  assert(
    cost.read <= ordinary.read + 10 && cost.written <= 2,
    `${what}: ${JSON.stringify(cost)} beside ${JSON.stringify(ordinary)}`,
  )

let flat = (what: string, small: Cost, large: Cost) =>
  assert(
    large.read <= small.read + 50 && large.written <= small.written + 10,
    `${what}: ${JSON.stringify(small)} → ${JSON.stringify(large)}`,
  )

test('the first wake after a deploy costs an ordinary wake, and the alarm what changed', async () => {
  for (let kind of ['directory', 'app']) {
    let [small, large] = [await probe(kind, 100), await probe(kind, 1000)]
    for (let { steps } of [small, large]) {
      let ordinary = steps['same version']
      near('new version', steps['new version'], ordinary)
      if (steps.populated) near('populated', steps.populated, ordinary)
    }
    for (let step of Object.keys(small.steps)) {
      flat(`${kind} ${step}`, small.steps[step], large.steps[step])
    }
  }
})
