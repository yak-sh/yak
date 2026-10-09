// A release costs the Stores it reaches rows in proportion to what changed,
// and a small app's first release rows in proportion to the app: measured
// with the runtime's billed cursor counters (release_cost_fixture.ts).
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type {
  Cost,
  gitCost,
  releaseCost,
  wakeCost,
} from './release_cost_fixture.ts'

let probe = async <T>(query: string, body?: unknown): Promise<T> => {
  let res = await fetch(`${workerd().base}/__play_cost/?${query}`, {
    ...(body === undefined ? {} : {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  })
  assertEquals(res.status, 200, await res.clone().text())
  return await res.json()
}

let within = (what: string, cost: Cost, read: number, written: number) =>
  assert(
    cost.read <= read && cost.written <= written,
    `${what}: ${cost.read} read, ${cost.written} written`,
  )

test("a small app's release costs rows in proportion to the app", async () => {
  let { first, again } = await probe<
    Awaited<ReturnType<typeof releaseCost>>
  >('release=1')
  console.log('RELEASE_COST', JSON.stringify({ first, again }))
  // Its schema is most of it: a table for each of the platform's components.
  within('first release', first.total, 8000, 1000)
  within('a release changing no word', again.total, 100, 50)
})

test('a Store waking on new code rebuilds nothing it holds', async () => {
  let totals: Cost[] = []
  for (let history of [100, 2000]) {
    let r = await probe<Awaited<ReturnType<typeof wakeCost>>>(`wake=${history}`)
    console.log('WAKE_COST', JSON.stringify(r))
    within(`wake beside ${history}`, r.total, 1000, 10)
    totals.push(r.total)
  }
  let [small, large] = totals
  assert(large.read <= small.read + 50, `${small.read} → ${large.read} reads`)
})

test('a release changing six files writes their objects into yak/git', async () => {
  // Shaped like Vale: most files at the root, the rest in a few directories.
  let paths = Array.from(
    { length: 530 },
    (_, i) => i < 310 ? `file${i}.ts` : `dir${i % 11}/file${i}.ts`,
  )
  for (let others of [0, 2000]) {
    let r = await probe<Awaited<ReturnType<typeof gitCost>>>(
      `git=1&others=${others}`,
      paths,
    )
    console.log('GIT_COST', JSON.stringify(r))
    // What is left is the changed root's own entries, a row each.
    within(
      `six files beside ${others} objects`,
      r.steps['six files changed'].total,
      12000,
      7000,
    )
  }
})
