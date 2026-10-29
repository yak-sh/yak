import { equal, test, throws } from '@yaks/testing'
import {
  type Budget,
  judge,
  listed,
  measure,
  own,
  shrunk,
  type Times,
} from './test-budget.ts'
import { fenceName, fences } from '../packages/testing/examples.ts'

// A list holding `a_test.ts` › `slow` at 50ms, and a deno run at 1s whose
// tests in `file` took what `took` says (a negative time fails the test).
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
    cpu: Math.abs(ms),
    ok: ms >= 0,
  })),
})
let ran = (took: Record<string, number>, wall = 1000) =>
  judge(list, { deno: deno(took, wall) })
let names = (rows: { key: string }[]) => rows.map((r) => r.key)

test('CPU observations ignore wall time and waiting', () => {
  let waits = (took: Record<string, [number, number]>): Times => ({
    wall: 1000,
    tests: Object.entries(took).map(([name, [ms, cpu]]) => ({
      file: 'a_test.ts',
      name,
      ms,
      cpu,
      ok: true,
    })),
  })
  let j = judge(list, {
    deno: waits({
      bare: [4, 0.5],
      over: [4, 2],
      slow: [400, 100],
      quick: [9, 9],
    }),
  })
  equal([names(j.over), names(j.slower)], [['over', 'quick'], []])
  let slowed = judge(list, { deno: waits({ slow: [400, 200] }) })
  equal(names(slowed.slower), ['slow'])
})

test('old artifacts cannot substitute wall time for missing CPU time', () => {
  let old = { file: 'a', name: 'x', ms: 9, waited: 8, ok: true }
  throws(() => own(old as unknown as Parameters<typeof own>[0]))
})

test('listed and unlisted regressions are said by the same run', () => {
  let j = ran({ over: 3, slow: 200, quick: 0.2 })
  equal([names(j.over), names(j.slower)], [['over'], ['slow']])
})

test('a test the list does not name is said over the budget', () => {
  let j = ran({ quick: 0.4, bare: 1, over: 1.2, slow: 60 })
  equal(names(j.over), ['over'])
  equal(names(j.slower), [])
})

test('a listed test is said over its record and the slack', () => {
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

test("a platform's wall clock is said, never compared", () => {
  let j = judge(list, {
    deno: deno({ quick: 0.2 }, 9e9),
  })
  equal([j.over, j.slower], [[], []])
  equal(j.walls, [
    { platform: 'deno', ms: 9e9 },
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
    deno: { wall: 1, tests: [{ file: page, name, ms: 17, cpu: 17, ok: true }] },
  })
  equal([j.over, j.slower, j.gone], [[], [], []])
})

test('a local slow test reports after one run without warming retries', async () => {
  let calls = 0
  let measured = await measure((flags) => {
    calls++
    let dir = flags.find((f) => f.startsWith('--times='))!.slice(8)
    Deno.writeTextFileSync(
      `${dir}/deno.json`,
      JSON.stringify(deno({ over: 3 })),
    )
    return Promise.resolve({ code: 0 })
  }, false)
  equal(calls, 1)
  equal(names(judge(list, measured.runs).over), ['over'])
})
