import { equal, test } from '@yaks/testing'
import {
  type Budget,
  failing,
  fastest,
  judge,
  listed,
  own,
  retracted,
  shrunk,
  type Times,
  unchanged,
} from './test-budget.ts'
import { fenceName, fences } from '../packages/testing/examples.ts'

// A list holding `a_test.ts` › `slow` at 50ms, and a deno run at 1s whose
// tests in `file` took what `took` says (a negative time fails the test), the
// file remembered as passed under its own name.
let list: Budget = {
  budget: 1,
  leave: 0.5,
  slack: { times: 2, ms: 10 },
  tests: { 'a_test.ts': { slow: 50, gone: 30 } },
}
let deno = (
  took: Record<string, number>,
  wall = 1000,
  file = 'a_test.ts',
): Times => ({
  wall,
  tests: Object.entries(took).map(([name, ms]) => ({
    file,
    name,
    ms: Math.abs(ms),
    ok: ms >= 0,
  })),
  remembered: { [file]: file },
})
let ran = (took: Record<string, number>, wall = 1000) =>
  judge(list, { deno: deno(took, wall) })
let names = (rows: { key: string }[]) => rows.map((r) => r.key)

// A runtime that loaded its files once for each of `loads`.
let loaded = (...loads: Record<string, number>[]): Times => ({
  wall: 1000,
  tests: loads.flatMap((took) => deno(took).tests),
})

test('measured again, a test is held to the fastest time it passed with', () => {
  let runs = fastest(
    { deno: deno({ over: 3, still: 2, slow: 120, quick: 0.2, late: 4 }) },
    {
      deno: loaded(
        { over: 0.8, still: 1.5, slow: -1, quick: 0.9, late: 3 },
        { over: 1.4, still: 1.1, slow: 130, quick: 0.3, late: 2 },
        { over: 1.2, still: 1.3, slow: -1, quick: 0.4, late: 0.6 },
      ),
    },
  )
  let j = judge(list, runs)
  equal([names(j.over), names(j.slower)], [['still'], ['slow']])
  equal(runs.deno.tests.map((t) => t.ms), [0.8, 1.1, 120, 0.2, 0.6])
})

test('a test is held to its own time, not what it waited for a CPU', () => {
  let waits = (took: Record<string, [number, number]>): Times => ({
    wall: 1000,
    tests: Object.entries(took).map(([name, [ms, waited]]) => ({
      file: 'a_test.ts',
      name,
      ms,
      waited,
      ok: true,
    })),
  })
  let j = judge(list, {
    deno: waits({
      bare: [4, 3.5],
      over: [4, 2],
      slow: [400, 300],
      quick: [9, 0],
    }),
  })
  equal([names(j.over), names(j.slower)], [['over', 'quick'], []])
  let slowed = judge(list, { deno: waits({ slow: [400, 200] }) })
  equal(names(slowed.slower), ['slow'])
  let again = fastest(
    { deno: waits({ over: [3, 0] }) },
    { deno: waits({ over: [9, 8.5] }) },
  )
  equal(own(again.deno.tests[0]), 0.5)
  equal(judge(list, again).over, [])
})

test('listed and unlisted regressions fail the same run', () => {
  let j = ran({ over: 3, slow: 200, quick: 0.2 })
  equal(names(failing(j)), ['over', 'slow'])
})

test('a file holding a test the run fails has its pass taken back', () => {
  let runs = {
    deno: deno({ over: 3, quick: 0.2 }),
    browser: deno({ fine: 0.4 }, 1000, 'b_test.ts'),
  }
  equal(retracted(runs, failing(judge(list, runs))), ['a_test.ts'])
  let slower = { deno: deno({ slow: 200 }) }
  equal(retracted(slower, failing(judge(list, slower))), ['a_test.ts'])
})

test('a file unchanged since it passed is spared, one changed is held', () => {
  let runs = {
    deno: deno({ over: 3, slow: 200, quick: 0.2 }),
    browser: deno({ new: 2 }, 1000, 'b_test.ts'),
  }
  let j = judge(list, runs, unchanged(runs, { 'a_test.ts': 1 }))
  equal([names(j.over), names(j.slower), names(j.spared)], [
    ['new'],
    [],
    ['over', 'slow'],
  ])
  equal(retracted(runs, failing(j)), ['b_test.ts'])
})

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
  equal(shrunk(list, j).tests, {})
  equal(shrunk(list, ran({ slow: 0.9, gone: 30 })).tests, {
    'a_test.ts': { slow: 0.9, gone: 30 },
  })
  let faster = ran({ slow: 19.91, gone: 40, new: 3 })
  equal(shrunk(list, faster), {
    ...list,
    tests: { 'a_test.ts': { slow: 20, gone: 30 } },
  })
})

test('a record lowers only past the slack, not on one lucky run', () => {
  equal(shrunk(list, ran({ slow: 20.01, gone: 30 })), list)
})

test('a failed test is neither timed nor gone', () => {
  let j = ran({ slow: -500, gone: -0.1, other: -9 })
  equal([j.over, j.slower, j.within, j.gone], [[], [], [], []])
})

test("a platform's wall clock is said, never held, and workerd's tests are not held", () => {
  let j = judge(list, {
    deno: deno({ quick: 0.2 }, 9e9),
    workerd: { wall: 5, tests: [{ file: 'w.ts', name: 'w', ms: 9, ok: true }] },
  })
  equal(failing(j), [])
  equal(j.walls, [
    { platform: 'deno', ms: 9e9 },
    { platform: 'workerd', ms: 5 },
  ])
})

test('a doctest is listed by its code, not its line', () => {
  let at = (name: string) => ({ file: 'a.ts', name })
  equal(
    listed([
      at('a.ts:12 f(1) -> 2'),
      at('a.ts:30 f(1) -> 2'),
      at('a.ts:40 abcdef012345'),
      at('x'),
    ]),
    ['a.ts: f(1) -> 2', 'a.ts: f(1) -> 2', 'a.ts: abcdef012345', 'x'],
  )
})

test('a fenced listing survives blocks inserted or removed above it', async () => {
  let page = 'a.md'
  let block = (code: string) => `\`\`\`ts\n${code}\n\`\`\`\n`
  let keys = async (source: string) =>
    listed(
      await Promise.all(
        fences(source).map(async (f) => ({
          file: page,
          name: await fenceName(page, f),
        })),
      ),
    )
  let original = await keys(block('first()') + block('views()'))
  let inserted = await keys(
    block('new()') + block('first()') + block('views()'),
  )
  let removed = await keys(block('views()'))
  equal(inserted.slice(1), original)
  equal(removed, original.slice(1))
  equal((await keys(block('changed()')))[0] == removed[0], false)
  let b = { ...list, tests: { [page]: { [original[1]]: 17 } } }
  let name = await fenceName(page, fences(block('new()') + block('views()'))[1])
  let j = judge(b, {
    deno: { wall: 1, tests: [{ file: page, name, ms: 17, ok: true }] },
  })
  equal([j.over, j.slower, j.gone], [[], [], []])
})
