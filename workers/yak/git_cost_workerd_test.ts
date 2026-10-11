import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { gitPushCost } from './git_cost_fixture.ts'
import type { Cost } from './release_cost_fixture.ts'

let within = (name: string, cost: Cost, read: number, written: number) =>
  assert(
    cost.read <= read && cost.written <= written,
    `${name}: ${cost.read} read, ${cost.written} written`,
  )

test('a git push costs rows in proportion to changed files', async () => {
  let reports: Awaited<ReturnType<typeof gitPushCost>>[] = []
  for (let count of [100, 530]) {
    let res = await fetch(
      `${workerd().base}/__play_cost/?git-push=1&files=${count}`,
    )
    assertEquals(res.status, 200, await res.clone().text())
    let report = await res.json() as Awaited<ReturnType<typeof gitPushCost>>
    console.log('GIT_PUSH_COST', JSON.stringify(report))
    reports.push(report)
    let { steps, heads, commits } = report
    assertEquals(new Set(heads).size, 4, 'each push moved the branch')
    assertEquals(commits[0].parent, null)
    assertEquals(commits.slice(1).map((c) => c.parent), heads.slice(0, 3))
    assert(commits[0].tree != commits[1].tree, 'changed files changed the tree')
    assertEquals(commits[2].tree, commits[1].tree)
    assertEquals(commits[3].tree, commits[0].tree)
    assert(steps['first push'].total.written > count, 'SQL metering is active')
    within(
      'first push',
      steps['first push'].total,
      count * 40 + 1000,
      count * 30 + 1000,
    )
    within('six files changed', steps['six files changed'].total, 500, 400)
    within('unchanged push', steps['unchanged push'].total, 100, 50)
    within('revert six files', steps['revert six files'].total, 220, 50)
    // Reuse writes only the new commit. Existing blobs and trees remain
    // content-addressed objects rather than rows rewritten on every deploy.
    for (let name of ['unchanged push', 'revert six files']) {
      assertEquals(steps[name].by.gitobj.written, 1, name)
    }
  }
  for (
    let name of ['six files changed', 'unchanged push', 'revert six files']
  ) {
    let [small, large] = reports.map((r) => r.steps[name].total)
    assert(
      large.read <= small.read + 10,
      `${name}: ${small.read} → ${large.read} reads`,
    )
    assert(
      large.written <= small.written + 10,
      `${name}: ${small.written} → ${large.written} writes`,
    )
  }
})
