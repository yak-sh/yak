import { equal, test } from '@yaks/testing'
import { capture } from './report.ts'
import { comp } from './model.ts'
import { fixture } from './fixture_test.ts'

test('declared effects group intake and retain occurrences downstream', async () => {
  let at = '2026-10-02T00:00:10Z'
  let g = fixture(
    { to: crypto.randomUUID(), store: 'box', retain: 1 },
    () => at,
  )
  for (let i = 1; i <= 3; i++) {
    await g.apply(
      capture('broken', {
        sink: () => {},
        eid: String(i),
        fault: 'one',
        version: 1,
        at: `2026-10-02T00:00:0${i}Z`,
      }),
      { trusted: true },
    )
  }
  let [bug] = await g.read('.bug *')
  equal(comp(bug, 'bug').hits, 3)
  equal((await g.read('.error')).length, 2)
  let hit = (id: string, version: number) =>
    g.apply(
      capture('broken', {
        sink: () => {},
        eid: id,
        fault: 'one',
        version,
        at,
      }),
      { trusted: true },
    )
  let [first] = await g.read('.mail *')
  for (let version of [2, 3]) {
    await g.apply([{ entity: bug.entity, resolved: {} }], { trusted: true })
    // Opening and regression are different occasions even if their clocks match.
    at = version == 2 ? '2026-10-02T00:00:10Z' : '2026-10-02T00:00:30Z'
    await hit(`back-${version}`, version)
    let [back] = await g.get([bug.entity.eid])
    equal(comp(back, 'regressed').at, at)
    let letters = await g.read('.mail *')
    equal(letters.length, version)
    let letter = letters.find((b) =>
      b.entity.eid != first.entity.eid && comp(b, 'mail').at == at
    )!
    equal(comp(letter, 'mail').target, bug.entity.eid)
    await g.apply([{ entity: letter.entity, delivered: {} }], { trusted: true })
    equal((await g.read('.bug .notified')).length, 1)
  }
  equal(comp(first, 'mail').at, '2026-10-02T00:00:10Z')
})
