import { equal, test } from '@yaks/testing'
import { type Budget, judge, listed, shrunk } from './test-budget.ts'

// A list holding `a_test.ts` › `slow` at 50ms, and a deno run at 1s whose
// tests in a_test.ts took what `took` says (a negative time fails the test).
let list: Budget = {
  budget: 1,
  leave: 0.5,
  slack: { tests: { times: 2, ms: 10 }, walls: { times: 1.2, ms: 0 } },
  platforms: { deno: 1000 },
  tests: { 'a_test.ts': { slow: 50, gone: 30 } },
}
let ran = (took: Record<string, number>, wall = 1000) =>
  judge(list, {
    deno: {
      wall,
      tests: Object.entries(took).map(([name, ms]) => ({
        file: 'a_test.ts',
        name,
        ms: Math.abs(ms),
        ok: ms >= 0,
      })),
    },
  })
let names = (rows: { key: string }[]) => rows.map((r) => r.key)

test('a test the list does not name is held to the budget', () => {
  let j = ran({ quick: 0.4, bare: 1, over: 1.2, slow: 60 })
  equal(names(j.over), ['over'])
  equal(names(j.slower), [])
})

test('a listed test is held to its record and the slack', () => {
  equal(names(ran({ slow: 110 }).slower), [])
  equal(names(ran({ slow: 110.1 }).slower), ['slow'])
})

test('the list only shrinks: well within budget, gone, faster', () => {
  let j = ran({ slow: 0.5 })
  equal([names(j.within), names(j.gone)], [['slow'], ['gone']])
  equal(shrunk(list, j, true).tests, {})
  equal(shrunk(list, ran({ slow: 0.9, gone: 30 }), true).tests, {
    'a_test.ts': { slow: 0.9, gone: 30 },
  })
  let faster = ran({ slow: 19.91, gone: 40, new: 3 }, 830)
  equal(shrunk(list, faster, true), {
    ...list,
    platforms: { deno: 830 },
    tests: { 'a_test.ts': { slow: 20, gone: 30 } },
  })
  equal(shrunk(list, faster, false).platforms, list.platforms)
})

test('a record lowers only past the slack, not on one lucky run', () => {
  equal(shrunk(list, ran({ slow: 20.01, gone: 30 }, 840), true), list)
})

test('a failed test is neither timed nor gone', () => {
  let j = ran({ slow: -500, gone: -0.1, other: -9 })
  equal([j.over, j.slower, j.within, j.gone], [[], [], [], []])
})

test('workerd is held by its wall alone', () => {
  let j = judge(list, {
    workerd: { wall: 5, tests: [{ file: 'w.ts', name: 'w', ms: 9, ok: true }] },
  })
  equal(j.over, [])
  equal(j.walls, [{ platform: 'workerd', ms: 5, record: undefined }])
})

test('an example is listed by its code or its place, not its line', () => {
  let at = (name: string) => ({ file: 'a.ts', name })
  equal(
    listed([at('a.ts:12 f(1) -> 2'), at('a.ts:30'), at('a.ts:41'), at('x')]),
    ['a.ts: f(1) -> 2', 'a.ts block 1', 'a.ts block 2', 'x'],
  )
})
