import { choose } from './choose.ts'
import { survey } from './deps.ts'
import { equal, test } from './mod.ts'

let unchanged = await choose(['missing_test.ts'], { changed: [] })

test('no changed paths selects no tests without needing a dependency graph or cache', () => {
  equal(unchanged.run, [])
  equal(unchanged.keys.size, 0)
  equal(unchanged.reaches(['missing_test.ts']), false)
})

// A survey of test files that each import a.ts, and a.ts.
let importing = async (tests: string[]) => {
  let url = (f: string) => new URL(f, `file://${Deno.cwd()}/`).href
  return (await survey([...tests, 'a.ts'], () =>
    Promise.resolve({
      modules: [
        ...tests.map((f) => ({
          specifier: url(f),
          dependencies: [{ code: { specifier: url('a.ts') } }],
        })),
        { specifier: url('a.ts'), dependencies: [] },
      ],
      redirects: {},
    })))!
}

test('selection uses the supplied command snapshot and retains dependency keys', async () => {
  let s = await importing(['a_test.ts'])
  let asked: string[][] = []
  let selected = await choose(['a_test.ts'], {
    changed: ['a.ts'],
    all: true,
    inspect: (paths) => {
      asked.push(paths)
      return Promise.resolve(s)
    },
  })
  equal(asked, [['a_test.ts']])
  equal(selected.run, ['a_test.ts'])
  equal(selected.reaches(['a.ts']), true)
  equal(selected.keys.size, 1)
})

test('a workspace-wide change keeps its own tests within the local budget', async () => {
  let { within } = await import('./choose.ts')
  equal(within(['a', 'b', 'c'], () => 0, () => 10, 20), ['a', 'b'])
})

test('a test file the change edits runs whatever it costs, and what is left of the budget holds the rest', async () => {
  let s = await importing(['slow_test.ts', 'b_test.ts', 'c_test.ts'])
  let cost = (f: string) => ({ 'slow_test.ts': 50 })[f] ?? 10
  let selected = await choose(['slow_test.ts', 'b_test.ts', 'c_test.ts'], {
    changed: ['a.ts', 'slow_test.ts'],
    all: true,
    budget: 65,
    cost,
    inspect: () => Promise.resolve(s),
  })
  equal(selected.run, ['slow_test.ts', 'b_test.ts'])
  equal(selected.beyond, 1)
})
